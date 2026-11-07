begin;

-- Apply after gamewaire-model-schedule.sql and gamewaire-soccer.sql.
alter table public.gamewaire_schedule_batches drop constraint if exists gamewaire_schedule_batches_sport_check;
alter table public.gamewaire_schedule_batches add constraint gamewaire_schedule_batches_sport_check
  check (sport in ('NBA','NFL','EPL','Serie A','La Liga','Bundesliga'));
alter table public.gamewaire_schedule_jobs drop constraint if exists gamewaire_schedule_jobs_sport_check;
alter table public.gamewaire_schedule_jobs add constraint gamewaire_schedule_jobs_sport_check
  check (sport in ('NBA','NFL','EPL','Serie A','La Liga','Bundesliga'));

create or replace function public.gamewaire_schedule_plan(
  target_sport text, target_date date, games jsonb, problem text, plan_note text, target_model text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare batch uuid; game jsonb; existing_run uuid;
begin
  if target_sport is null or target_sport not in ('NBA','NFL','EPL','Serie A','La Liga','Bundesliga') or target_date is null
    or target_model is null or target_model !~ '^[a-zA-Z0-9._+-]{1,80}$'
    or games is null or jsonb_typeof(games)<>'array'
    or jsonb_array_length(games)>(case when target_sport='NBA' then 15 when target_sport='NFL' then 16 else 100 end)
    or (target_sport='NFL' and extract(isodow from target_date)<>4)
    or (problem is not null and jsonb_array_length(games)>0)
    then raise exception 'Invalid model-aware analysis plan'; end if;
  perform pg_advisory_xact_lock(hashtext('gamewaire-scheduled-worker'));
  if exists(select 1 from public.gamewaire_schedule_jobs j
    join public.gamewaire_schedule_batches b on b.id=j.batch_id
    where b.sport=target_sport and b.game_date=target_date and j.status='running')
    then return null; end if;
  insert into public.gamewaire_schedule_batches as batches(sport,game_date,status,note,error,model_version)
    values(target_sport,target_date,case when problem is not null then 'error'
      when jsonb_array_length(games)=0 then 'no_games' else 'ready' end,plan_note,problem,target_model)
    on conflict(sport,game_date) do update set status=excluded.status,note=excluded.note,
      error=excluded.error,model_version=excluded.model_version
      where batches.model_version is distinct from excluded.model_version
    returning id into batch;
  if batch is null then return null; end if;
  for game in select value from jsonb_array_elements(games) loop
    if coalesce(game->>'event_id','') !~ '^[a-zA-Z0-9_-]{1,100}$'
      or game->>'matchup' is null or game->>'selection_note' is null or game->>'event_start' is null
      or (game->>'event_start')::timestamptz<=now()
      or ((game->>'event_start')::timestamptz at time zone 'America/New_York')::date<target_date
      or ((game->>'event_start')::timestamptz at time zone 'America/New_York')::date>target_date+(case when target_sport='NFL' then 6 else 0 end)
      then raise exception 'Invalid scheduled game'; end if;
    select case when payload->>'modelVersion'=target_model
      and status in ('completed','no_qualifying','insufficient_data','stale_odds') then id end
      into existing_run from public.gamewaire_runs
      where sport=target_sport and event_id=game->>'event_id'
        and event_start=(game->>'event_start')::timestamptz and created_at<event_start
      order by created_at desc,id limit 1;
    insert into public.gamewaire_schedule_jobs as jobs(batch_id,sport,event_id,event_start,matchup,selection_note,status,run_id,finished_at)
      values(batch,target_sport,game->>'event_id',(game->>'event_start')::timestamptz,game->>'matchup',game->>'selection_note',
        case when existing_run is null then 'pending' else 'completed' end,existing_run,
        case when existing_run is null then null else now() end)
      on conflict(batch_id,event_id) do update set event_start=excluded.event_start,matchup=excluded.matchup,
        selection_note=excluded.selection_note,status=excluded.status,run_id=excluded.run_id,
        started_at=null,finished_at=excluded.finished_at,error=null,provider_usage=null;
  end loop;
  return batch;
end $$;

-- Reservations survive model catch-up and failures; never refund an uncertain paid attempt.
create table if not exists public.gamewaire_soccer_schedule_budget (
  game_date date primary key,
  attempts integer not null check (attempts between 0 and 40)
);
alter table public.gamewaire_soccer_schedule_budget enable row level security;
revoke all on public.gamewaire_soccer_schedule_budget from public,anon,authenticated;
grant all on public.gamewaire_soccer_schedule_budget to service_role;

create or replace function public.gamewaire_schedule_claim()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.gamewaire_schedule_jobs; today date := (now() at time zone 'America/New_York')::date;
  reserved integer; remaining numeric;
begin
  perform pg_advisory_xact_lock(hashtext('gamewaire-scheduled-worker'));
  update public.gamewaire_schedule_jobs set status='failed',finished_at=now(),
    error='Scheduled analysis interrupted. No automatic retry to avoid duplicate credit use; review and refresh manually.'
    where status='running' and started_at < now()-interval '5 minutes';
  if exists(select 1 from public.gamewaire_schedule_jobs where status='running') then return null; end if;
  update public.gamewaire_schedule_jobs set status='skipped',finished_at=now(),error='Game started before scheduled analysis.'
    where status='pending' and event_start<=now();
  insert into public.gamewaire_soccer_schedule_budget(game_date,attempts) values(today,0)
    on conflict(game_date) do nothing;
  select attempts into reserved from public.gamewaire_soccer_schedule_budget where game_date=today;
  select (provider_usage->>'creditsRemaining')::numeric into remaining
    from public.gamewaire_schedule_jobs
    where provider_usage->>'creditsRemaining' ~ '^[0-9]+([.][0-9]+)?$'
    order by finished_at desc nulls last,id limit 1;
  update public.gamewaire_schedule_jobs set status='skipped',finished_at=now(),
    error=case when reserved>=40 then 'Shared soccer daily budget exhausted (40 attempts / 80 credits). No automatic paid retry.'
      else 'Last known provider balance is below 2 credits. No automatic paid retry.' end
    where status='pending' and sport in ('EPL','Serie A','La Liga','Bundesliga')
      and (reserved>=40 or remaining<2);
  select * into job from public.gamewaire_schedule_jobs where status='pending'
    order by event_start,id limit 1 for update;
  if not found then return null; end if;
  if job.sport in ('EPL','Serie A','La Liga','Bundesliga') then
    update public.gamewaire_soccer_schedule_budget set attempts=attempts+1 where game_date=today;
  end if;
  update public.gamewaire_schedule_jobs set status='running',started_at=now() where id=job.id returning * into job;
  return to_jsonb(job);
end $$;
revoke all on function public.gamewaire_schedule_plan(text,date,jsonb,text,text,text),public.gamewaire_schedule_claim() from public,anon,authenticated;
grant execute on function public.gamewaire_schedule_plan(text,date,jsonb,text,text,text),public.gamewaire_schedule_claim() to service_role;

-- Keep the existing every-minute cron; no second worker or automatic publication.
notify pgrst,'reload schema';
commit;
