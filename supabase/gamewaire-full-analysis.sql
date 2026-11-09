begin;

-- Apply after gamewaire-soccer-daily-schedule.sql.
alter table public.gamewaire_schedule_batches add column if not exists updated_at timestamptz not null default now();
alter table public.gamewaire_schedule_jobs add column if not exists phase text not null default 'initial' check (phase in ('initial','pregame'));
alter table public.gamewaire_schedule_jobs add column if not exists refresh_at timestamptz;
alter table public.gamewaire_schedule_jobs add column if not exists attempts integer not null default 0 check (attempts between 0 and 2);
alter table public.gamewaire_schedule_jobs add column if not exists next_attempt_at timestamptz not null default now();

create table if not exists public.gamewaire_credit_reservations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  cost integer not null check (cost between 1 and 7)
);
create index if not exists gamewaire_credit_reservations_created on public.gamewaire_credit_reservations(created_at);
alter table public.gamewaire_credit_reservations enable row level security;
revoke all on public.gamewaire_credit_reservations from public,anon,authenticated;
grant all on public.gamewaire_credit_reservations to service_role;

create or replace function public.gamewaire_reserve_credits(max_cost integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if max_cost is null or max_cost not between 1 and 7 then raise exception 'Invalid analysis credit reservation'; end if;
  perform pg_advisory_xact_lock(hashtext('gamewaire-provider-credit-budget'));
  if (select coalesce(sum(cost),0) from public.gamewaire_credit_reservations
      where created_at>now()-interval '31 days')+max_cost>20000 then return false; end if;
  insert into public.gamewaire_credit_reservations(cost) values(max_cost);
  return true;
end $$;
revoke all on function public.gamewaire_reserve_credits(integer) from public,anon,authenticated;
grant execute on function public.gamewaire_reserve_credits(integer) to service_role;

create or replace function public.gamewaire_schedule_refresh_time()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.sport in ('NBA','NFL') and new.phase='initial' and new.status='completed' then
    new.refresh_at := case when coalesce(new.started_at,now())<new.event_start-interval '60 minutes'
      then new.event_start-interval '60 minutes' else null end;
  elsif new.phase='pregame' then new.refresh_at := null;
  end if;
  return new;
end $$;
drop trigger if exists gamewaire_schedule_refresh_time on public.gamewaire_schedule_jobs;
create trigger gamewaire_schedule_refresh_time before insert or update on public.gamewaire_schedule_jobs
  for each row execute function public.gamewaire_schedule_refresh_time();

create or replace function public.gamewaire_schedule_plan(
  target_sport text, target_date date, games jsonb, problem text, plan_note text, target_model text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare batch uuid; game jsonb; existing_run public.gamewaire_runs; previous_model text;
begin
  if target_sport is null or target_sport not in ('NBA','NFL','EPL','Serie A','La Liga','Bundesliga') or target_date is null
    or target_model is null or target_model !~ '^[a-zA-Z0-9._+-]{1,80}$'
    or games is null or jsonb_typeof(games)<>'array'
    or jsonb_array_length(games)>(case when target_sport='NBA' then 15 when target_sport='NFL' then 16 else 100 end)
    or (target_sport='NFL' and extract(isodow from target_date)<>4)
    or (problem is not null and jsonb_array_length(games)>0)
    then raise exception 'Invalid full analysis plan'; end if;
  perform pg_advisory_xact_lock(hashtext('gamewaire-scheduled-worker'));
  if exists(select 1 from public.gamewaire_schedule_jobs j join public.gamewaire_schedule_batches b on b.id=j.batch_id
    where b.sport=target_sport and b.game_date=target_date and j.status='running') then return null; end if;
  select model_version into previous_model from public.gamewaire_schedule_batches where sport=target_sport and game_date=target_date;
  insert into public.gamewaire_schedule_batches as batches(sport,game_date,status,note,error,model_version)
    values(target_sport,target_date,case when problem is not null then 'error'
      when jsonb_array_length(games)=0 then 'no_games' else 'ready' end,plan_note,problem,target_model)
    on conflict(sport,game_date) do update set status=excluded.status,note=excluded.note,
      error=excluded.error,model_version=excluded.model_version,updated_at=now()
      where batches.model_version is distinct from excluded.model_version
        or (target_sport in ('NBA','NFL') and batches.updated_at<=now()-interval '1 hour')
    returning id into batch;
  if batch is null then return null; end if;
  for game in select value from jsonb_array_elements(games) loop
    if coalesce(game->>'event_id','') !~ '^[a-zA-Z0-9_-]{1,100}$'
      or game->>'matchup' is null or game->>'selection_note' is null or game->>'event_start' is null
      or (game->>'event_start')::timestamptz<=now()
      or ((game->>'event_start')::timestamptz at time zone 'America/New_York')::date<target_date
      or ((game->>'event_start')::timestamptz at time zone 'America/New_York')::date>target_date+(case when target_sport='NFL' then 6 else 0 end)
      then raise exception 'Invalid scheduled game'; end if;
    update public.gamewaire_schedule_jobs set event_start=(game->>'event_start')::timestamptz,
      status='pending',phase='initial',attempts=0,next_attempt_at=now(),run_id=null,
      started_at=null,finished_at=null,error=null,provider_usage=null,refresh_at=null
      where batch_id=batch and event_id=game->>'event_id'
        and event_start is distinct from (game->>'event_start')::timestamptz;
    select * into existing_run from public.gamewaire_runs
      where sport=target_sport and event_id=game->>'event_id' and event_start=(game->>'event_start')::timestamptz
        and created_at<event_start and payload->>'modelVersion'=target_model
        and (target_sport not in ('NBA','NFL') or payload->>'playerPropMinimum'='4')
        and status in ('completed','no_qualifying','insufficient_data','stale_odds')
      order by created_at desc,id limit 1;
    insert into public.gamewaire_schedule_jobs as jobs(batch_id,sport,event_id,event_start,matchup,selection_note,status,run_id,started_at,finished_at)
      values(batch,target_sport,game->>'event_id',(game->>'event_start')::timestamptz,game->>'matchup',game->>'selection_note',
        case when existing_run.id is null then 'pending' else 'completed' end,existing_run.id,existing_run.created_at,
        case when existing_run.id is null then null else now() end)
      on conflict(batch_id,event_id) do update set event_start=excluded.event_start,matchup=excluded.matchup,
        selection_note=excluded.selection_note,
        status=case when previous_model is distinct from target_model then excluded.status else jobs.status end,
        run_id=case when previous_model is distinct from target_model then excluded.run_id else jobs.run_id end,
        started_at=case when previous_model is distinct from target_model then excluded.started_at else jobs.started_at end,
        finished_at=case when previous_model is distinct from target_model then excluded.finished_at else jobs.finished_at end,
        error=case when previous_model is distinct from target_model then null else jobs.error end,
        provider_usage=case when previous_model is distinct from target_model then null else jobs.provider_usage end,
        phase=case when previous_model is distinct from target_model then 'initial' else jobs.phase end,
        attempts=case when previous_model is distinct from target_model then 0 else jobs.attempts end,
        next_attempt_at=case when previous_model is distinct from target_model then now() else jobs.next_attempt_at end;
  end loop;
  return batch;
end $$;

create or replace function public.gamewaire_schedule_claim()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job public.gamewaire_schedule_jobs; today date := (now() at time zone 'America/New_York')::date;
  reserved integer; remaining numeric;
begin
  perform pg_advisory_xact_lock(hashtext('gamewaire-scheduled-worker'));
  update public.gamewaire_schedule_jobs set status='failed',finished_at=now(),
    error='Scheduled analysis interrupted. Its uncertain credit reservation is retained.'
    where status='running' and started_at<now()-interval '5 minutes';
  if exists(select 1 from public.gamewaire_schedule_jobs where status='running') then return null; end if;
  update public.gamewaire_schedule_jobs set status='pending',phase='pregame',attempts=0,next_attempt_at=now(),
    run_id=null,started_at=null,finished_at=null,error=null,provider_usage=null
    where sport in ('NBA','NFL') and status='completed' and phase='initial' and refresh_at<=now() and event_start>now();
  update public.gamewaire_schedule_jobs set status='pending',next_attempt_at=now()
    where sport in ('NBA','NFL') and status='failed' and attempts<2
      and finished_at<=now()-interval '15 minutes' and event_start>now();
  update public.gamewaire_schedule_jobs set status='skipped',finished_at=now(),error='Game started before scheduled analysis.'
    where status='pending' and event_start<=now();
  insert into public.gamewaire_soccer_schedule_budget(game_date,attempts) values(today,0) on conflict(game_date) do nothing;
  select attempts into reserved from public.gamewaire_soccer_schedule_budget where game_date=today;
  select (provider_usage->>'creditsRemaining')::numeric into remaining from public.gamewaire_schedule_jobs
    where provider_usage->>'creditsRemaining' ~ '^[0-9]+([.][0-9]+)?$' order by finished_at desc nulls last,id limit 1;
  update public.gamewaire_schedule_jobs set status='skipped',finished_at=now(),
    error=case when reserved>=40 then 'Shared soccer daily budget exhausted (40 attempts / 80 credits). No automatic paid retry.'
      else 'Last known provider balance is below 2 credits. No automatic paid retry.' end
    where status='pending' and sport in ('EPL','Serie A','La Liga','Bundesliga') and (reserved>=40 or remaining<2);
  select * into job from public.gamewaire_schedule_jobs where status='pending' and next_attempt_at<=now()
    order by case when sport in ('NBA','NFL') and event_start<=now()+interval '60 minutes' then 0 else 1 end,event_start,id limit 1 for update;
  if not found then return null; end if;
  if job.sport in ('EPL','Serie A','La Liga','Bundesliga') then
    update public.gamewaire_soccer_schedule_budget set attempts=attempts+1 where game_date=today;
  end if;
  update public.gamewaire_schedule_jobs set status='running',started_at=now(),
    attempts=case when sport in ('NBA','NFL') then attempts+1 else attempts end where id=job.id returning * into job;
  return to_jsonb(job);
end $$;
revoke all on function public.gamewaire_schedule_plan(text,date,jsonb,text,text,text),public.gamewaire_schedule_claim() from public,anon,authenticated;
grant execute on function public.gamewaire_schedule_plan(text,date,jsonb,text,text,text),public.gamewaire_schedule_claim() to service_role;
notify pgrst,'reload schema';
commit;
