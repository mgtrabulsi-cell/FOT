begin;
create table if not exists public.gamewaire_schedule_batches (
  id uuid primary key default gen_random_uuid(),
  sport text not null check (sport in ('NBA','NFL')),
  game_date date not null,
  status text not null check (status in ('ready','no_games','error')),
  note text not null,
  error text,
  created_at timestamptz not null default now(),
  unique(sport,game_date)
);
create table if not exists public.gamewaire_schedule_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.gamewaire_schedule_batches(id),
  sport text not null check (sport in ('NBA','NFL')),
  event_id text not null,
  event_start timestamptz not null,
  matchup text not null,
  selection_note text not null,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','skipped')),
  run_id uuid references public.gamewaire_runs(id),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  provider_usage jsonb,
  unique(batch_id,event_id)
);
alter table public.gamewaire_schedule_batches enable row level security;
alter table public.gamewaire_schedule_jobs enable row level security;
revoke all on public.gamewaire_schedule_batches, public.gamewaire_schedule_jobs from anon, authenticated;
grant select on public.gamewaire_schedule_batches, public.gamewaire_schedule_jobs to authenticated;
grant all on public.gamewaire_schedule_batches, public.gamewaire_schedule_jobs to service_role;
drop policy if exists "Admins read analysis schedules" on public.gamewaire_schedule_batches;
create policy "Admins read analysis schedules" on public.gamewaire_schedule_batches for select to authenticated using (
  exists(select 1 from public.livewire_roles where user_id=auth.uid() and role in ('admin','owner'))
);
drop policy if exists "Admins read scheduled analyses" on public.gamewaire_schedule_jobs;
create policy "Admins read scheduled analyses" on public.gamewaire_schedule_jobs for select to authenticated using (
  exists(select 1 from public.livewire_roles where user_id=auth.uid() and role in ('admin','owner'))
);
create or replace function public.gamewaire_schedule_plan(target_sport text, target_date date, games jsonb, problem text, plan_note text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare batch uuid; game jsonb;
begin
  if target_sport is null or target_sport not in ('NBA','NFL') or target_date is null or games is null or jsonb_typeof(games) <> 'array'
    or jsonb_array_length(games) > (case when target_sport='NBA' then 15 else 16 end)
    or (problem is not null and jsonb_array_length(games)>0)
    then raise exception 'Invalid scheduled analysis plan'; end if;
  insert into public.gamewaire_schedule_batches(sport,game_date,status,note,error)
    values(target_sport,target_date,case when problem is not null then 'error' when jsonb_array_length(games)=0 then 'no_games' else 'ready' end,plan_note,problem)
    on conflict(sport,game_date) do nothing returning id into batch;
  if batch is null then return null; end if;
  for game in select value from jsonb_array_elements(games) loop
    if coalesce(game->>'event_id','') !~ '^[a-zA-Z0-9_-]{1,100}$'
      or game->>'matchup' is null or game->>'selection_note' is null or game->>'event_start' is null
      or (game->>'event_start')::timestamptz <= now()
      or ((game->>'event_start')::timestamptz at time zone 'America/New_York')::date <> target_date
      then raise exception 'Invalid scheduled game'; end if;
    insert into public.gamewaire_schedule_jobs(batch_id,sport,event_id,event_start,matchup,selection_note)
      values(batch,target_sport,game->>'event_id',(game->>'event_start')::timestamptz,game->>'matchup',game->>'selection_note');
  end loop;
  return batch;
end $$;
create or replace function public.gamewaire_schedule_claim()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.gamewaire_schedule_jobs;
begin
  perform pg_advisory_xact_lock(hashtext('gamewaire-scheduled-worker'));
  update public.gamewaire_schedule_jobs set status='failed',finished_at=now(),
    error='Scheduled analysis interrupted. No automatic retry to avoid duplicate credit use; review and refresh manually.'
    where status='running' and started_at < now()-interval '5 minutes';
  if exists(select 1 from public.gamewaire_schedule_jobs where status='running') then return null; end if;
  update public.gamewaire_schedule_jobs set status='skipped',finished_at=now(),error='Game started before scheduled analysis.'
    where status='pending' and event_start<=now();
  select * into job from public.gamewaire_schedule_jobs where status='pending'
    order by event_start,id limit 1 for update;
  if not found then return null; end if;
  update public.gamewaire_schedule_jobs set status='running',started_at=now() where id=job.id returning * into job;
  return to_jsonb(job);
end $$;
revoke all on function public.gamewaire_schedule_plan(text,date,jsonb,text,text), public.gamewaire_schedule_claim() from public,anon,authenticated;
grant execute on function public.gamewaire_schedule_plan(text,date,jsonb,text,text), public.gamewaire_schedule_claim() to service_role;

create table if not exists public.gamewaire_analysis_locks (
  sport text not null check (sport in ('NBA','NFL')),
  event_id text not null,
  token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  primary key(sport,event_id)
);
alter table public.gamewaire_analysis_locks enable row level security;
revoke all on public.gamewaire_analysis_locks from anon,authenticated;
grant all on public.gamewaire_analysis_locks to service_role;
create or replace function public.gamewaire_analysis_lock(target_sport text,target_event text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare lease uuid;
begin
  insert into public.gamewaire_analysis_locks as locks(sport,event_id)
    values(target_sport,target_event)
    on conflict(sport,event_id) do update set token=gen_random_uuid(),claimed_at=now()
      where locks.claimed_at < now()-interval '3 minutes'
    returning token into lease;
  return lease;
end $$;
revoke all on function public.gamewaire_analysis_lock(text,text) from public,anon,authenticated;
grant execute on function public.gamewaire_analysis_lock(text,text) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname='gamewire-gamewaire-schedule';
-- Run in both possible Eastern 1 AM UTC hours; the handler checks Eastern time and deduplicates dates.
select cron.schedule('gamewire-gamewaire-schedule','* 5,6 * * *',$job$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-url'),'/poll-live-games','/gamewaire'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-gamewire-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-secret')),
    body := '{"action":"scheduled"}'::jsonb,timeout_milliseconds := 180000
  );
$job$);
notify pgrst,'reload schema';
commit;
