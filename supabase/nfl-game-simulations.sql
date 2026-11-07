begin;

create table if not exists public.gamewire_simulation_jobs (
  event_id text primary key check(event_id ~ '^[0-9]{1,12}$'),
  payload jsonb,
  response jsonb,
  lease_token uuid,
  lease_until timestamptz not null default '-infinity',
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.gamewire_game_forecasts (
  event_id text not null check(event_id ~ '^[0-9]{1,12}$'),
  model_version text not null,
  event_start timestamptz not null,
  season integer not null check(season between 2000 and 2200),
  season_type integer not null check(season_type in (2,3)),
  forecast_at timestamptz not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  actuals jsonb,
  settled_at timestamptz,
  primary key(event_id,model_version),
  check(forecast_at < event_start),
  check((actuals is null and settled_at is null) or (jsonb_typeof(actuals)='object' and settled_at >= event_start))
);
create index if not exists gamewire_game_forecasts_pending on public.gamewire_game_forecasts(event_start) where settled_at is null;
alter table public.gamewire_simulation_jobs enable row level security;
alter table public.gamewire_game_forecasts enable row level security;
revoke all on public.gamewire_simulation_jobs,public.gamewire_game_forecasts from public,anon,authenticated;
grant all on public.gamewire_simulation_jobs,public.gamewire_game_forecasts to service_role;

create or replace function public.gamewire_claim_simulation(target_event text,target_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare claimed text;
begin
  insert into public.gamewire_simulation_jobs(event_id,lease_token,lease_until)
    values(target_event,target_token,clock_timestamp()+interval '2 minutes')
  on conflict(event_id) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until
    where public.gamewire_simulation_jobs.lease_until < clock_timestamp()
  returning event_id into claimed;
  return claimed is not null;
end $$;
revoke all on function public.gamewire_claim_simulation(text,uuid) from public,anon,authenticated;
grant execute on function public.gamewire_claim_simulation(text,uuid) to service_role;

create or replace function public.gamewire_save_game_simulation(target_token uuid,forecast jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare started timestamptz := (forecast->>'event_start')::timestamptz;
  recorded timestamptz; saved public.gamewire_game_forecasts; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('nfl-simulation:'||(forecast->>'event_id'),0));
  perform 1 from public.gamewire_simulation_jobs where event_id=forecast->>'event_id'
    and lease_token=target_token and lease_until>clock_timestamp() for update;
  if not found then return null; end if;
  select * into saved from public.gamewire_game_forecasts
    where event_id=forecast->>'event_id' and model_version=forecast->>'model_version';
  recorded := clock_timestamp();
  if started <= recorded or (saved.event_id is not null and (saved.event_start <= recorded or saved.settled_at is not null)) then return null; end if;
  if exists(select 1 from public.gamewire_game_forecasts where event_id=forecast->>'event_id' and event_start <= recorded) then return null; end if;
  if forecast->'payload'->>'status' is distinct from 'ready'
    or forecast->'payload'->>'eventId' is distinct from forecast->>'event_id'
    or forecast->'payload'->>'version' is distinct from forecast->>'model_version'
    or coalesce(forecast->>'model_version','') not in ('nfl-joint-bootstrap-v1','nfl-joint-bootstrap-v2','nfl-joint-bootstrap-v3','nfl-joint-bootstrap-v4','nfl-joint-bootstrap-v5')
    or coalesce((forecast->'payload'->'history'->>'home')::integer,-1) not between 8 and 100
    or coalesce((forecast->'payload'->'history'->>'away')::integer,-1) not between 8 and 100
    or (forecast->>'model_version' not in ('nfl-joint-bootstrap-v3','nfl-joint-bootstrap-v4','nfl-joint-bootstrap-v5') or forecast->'payload'->>'evidenceMode'='full')
      and ((forecast->'payload'->'history'->>'home')::integer <> 100 or (forecast->'payload'->'history'->>'away')::integer <> 100)
    or forecast->>'model_version' in ('nfl-joint-bootstrap-v3','nfl-joint-bootstrap-v4','nfl-joint-bootstrap-v5') and coalesce(forecast->'payload'->>'evidenceMode','') not in ('full','limited','team-only')
    or jsonb_typeof(forecast->'payload'->'scenarios') is distinct from 'array'
    or jsonb_array_length(forecast->'payload'->'scenarios')=0
    or forecast->>'model_version'='nfl-joint-bootstrap-v5' and exists(
      select 1 from jsonb_array_elements(forecast->'payload'->'scenarios') scenario
      where scenario->'overtime'->>'method' is distinct from 'empirical-possession-bootstrap-v1'
        or scenario->'overtime'->>'attribution' is distinct from 'score-only'
        or coalesce((scenario->'overtime'->'samples'->>'home')::integer,0)<24
        or coalesce((scenario->'overtime'->'samples'->>'away')::integer,0)<24
        or (forecast->>'season_type'='3' and (scenario->>'tieProbability')::numeric is distinct from 0))
    or forecast->>'model_version' in ('nfl-joint-bootstrap-v3','nfl-joint-bootstrap-v4','nfl-joint-bootstrap-v5') and exists(
      select 1 from jsonb_array_elements(forecast->'payload'->'scenarios') scenario
      where (forecast->'payload'->>'evidenceMode'='team-only' and (
        scenario->'home'->'teamOnly' is distinct from 'true'::jsonb or scenario->'away'->'teamOnly' is distinct from 'true'::jsonb
        or scenario->'home'->'totals' is distinct from 'null'::jsonb or scenario->'away'->'totals' is distinct from 'null'::jsonb
        or scenario->'home'->'players' is distinct from '[]'::jsonb or scenario->'away'->'players' is distinct from '[]'::jsonb))
      or (forecast->'payload'->>'evidenceMode'<>'team-only' and
        (scenario->'home'->'teamOnly'='true'::jsonb or scenario->'away'->'teamOnly'='true'::jsonb)))
    then raise exception 'Invalid verified NFL game simulation'; end if;
  result := jsonb_set(forecast->'payload','{forecastAt}',to_jsonb(recorded));
  insert into public.gamewire_game_forecasts(event_id,model_version,event_start,season,season_type,forecast_at,payload)
    values(forecast->>'event_id',forecast->>'model_version',started,(forecast->>'season')::integer,
      (forecast->>'season_type')::integer,recorded,result)
  on conflict(event_id,model_version) do update set event_start=excluded.event_start,forecast_at=excluded.forecast_at,payload=excluded.payload;
  return result;
end $$;
revoke all on function public.gamewire_save_game_simulation(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gamewire_save_game_simulation(uuid,jsonb) to service_role;

create or replace function public.gamewire_lock_game_simulation() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.event_start <= clock_timestamp() and
    (to_jsonb(new)-'actuals'-'settled_at') is distinct from (to_jsonb(old)-'actuals'-'settled_at')
    then raise exception 'NFL pregame simulations are immutable after kickoff'; end if;
  return new;
end $$;
revoke all on function public.gamewire_lock_game_simulation() from public,anon,authenticated;
drop trigger if exists gamewire_lock_game_simulation on public.gamewire_game_forecasts;
create trigger gamewire_lock_game_simulation before update on public.gamewire_game_forecasts
  for each row execute function public.gamewire_lock_game_simulation();

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
alter table public.gamewire_simulation_jobs
  add column if not exists event_start timestamptz,
  add column if not exists model_version text,
  add column if not exists discovered boolean not null default false,
  add column if not exists next_run_at timestamptz not null default clock_timestamp(),
  add column if not exists dispatched_at timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error text;
create index if not exists gamewire_simulation_jobs_queue on public.gamewire_simulation_jobs(next_run_at,event_start);

create or replace function public.gamewire_request_simulation(target_event text,requested_start timestamptz,requested_version text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if target_event is null or target_event !~ '^[0-9]{1,12}$' or requested_start is null or requested_start <= clock_timestamp()
    or requested_start > clock_timestamp()+interval '14 days' or requested_version is distinct from 'nfl-joint-bootstrap-v5'
    then raise exception 'Choose an upcoming NFL game within fourteen days'; end if;
  insert into public.gamewire_simulation_jobs(event_id,event_start,model_version)
    values(target_event,requested_start,requested_version)
  on conflict(event_id) do update
    set event_start=coalesce(public.gamewire_simulation_jobs.event_start,excluded.event_start),
      model_version=excluded.model_version,next_run_at=clock_timestamp()
    where public.gamewire_simulation_jobs.model_version is distinct from excluded.model_version;
end $$;

create or replace function public.gamewire_queue_simulations(games jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare item jsonb; started timestamptz;
begin
  if jsonb_typeof(games) is distinct from 'array' or jsonb_array_length(games)>64 then raise exception 'Invalid NFL simulation week'; end if;
  for item in select value from jsonb_array_elements(games) loop
    started := (item->>'event_start')::timestamptz;
    if item->>'event_id' is null or item->>'event_id' !~ '^[0-9]{1,12}$' or started is null or started <= clock_timestamp()
      or started > clock_timestamp()+interval '14 days' or item->>'model_version' is distinct from 'nfl-joint-bootstrap-v5'
      then raise exception 'Invalid upcoming NFL simulation game'; end if;
    insert into public.gamewire_simulation_jobs(event_id,event_start,model_version,discovered)
      values(item->>'event_id',started,item->>'model_version',true)
    on conflict(event_id) do update set event_start=excluded.event_start,model_version=excluded.model_version,discovered=true,
      next_run_at=case when public.gamewire_simulation_jobs.model_version is distinct from excluded.model_version
        or public.gamewire_simulation_jobs.event_start is distinct from excluded.event_start then clock_timestamp()
        else public.gamewire_simulation_jobs.next_run_at end,
      payload=case when public.gamewire_simulation_jobs.event_start is distinct from excluded.event_start
        then null else public.gamewire_simulation_jobs.payload end,
      response=case when public.gamewire_simulation_jobs.event_start is distinct from excluded.event_start
        then null else public.gamewire_simulation_jobs.response end;
  end loop;
end $$;

create or replace function public.gamewire_fail_simulation(target_event text,target_token uuid,failure text) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.gamewire_simulation_jobs set attempts=attempts+1,last_error=left(failure,1000),
    next_run_at=clock_timestamp()+make_interval(mins=>least(30,power(2,least(attempts,5))::integer)),
    updated_at=clock_timestamp()
    where event_id=target_event and lease_token=target_token;
end $$;

create or replace function public.gamewire_dispatch_simulations() returns integer
language plpgsql security definer set search_path='' as $$
declare job public.gamewire_simulation_jobs; dispatched integer:=0; available integer; endpoint text; secret text;
begin
  perform pg_advisory_xact_lock(hashtextextended('nfl-simulation-dispatch',0));
  select greatest(0,4-count(*))::integer into available from public.gamewire_simulation_jobs
    where dispatched_at > clock_timestamp()-interval '3 minutes' or lease_until > clock_timestamp();
  if available=0 then return 0; end if;
  select replace(decrypted_secret,'/poll-live-games','/gamewire-bot') into endpoint from vault.decrypted_secrets where name='gamewire-poll-url';
  select decrypted_secret into secret from vault.decrypted_secrets where name='gamewire-poll-secret';
  if endpoint is null or secret is null then raise exception 'NFL simulation cron secrets are not configured'; end if;
  for job in select * from public.gamewire_simulation_jobs
    where event_start > clock_timestamp() and event_start <= clock_timestamp()+interval '14 days'
      and next_run_at <= clock_timestamp() and lease_until < clock_timestamp()
      and (dispatched_at is null or dispatched_at <= clock_timestamp()-interval '3 minutes')
    order by discovered desc,
      case when response->>'version'=model_version and response->>'status' in ('ready','unavailable')
        and response->>'refreshing' is distinct from 'true' then 1 else 0 end,
      updated_at,event_id
    limit available for update skip locked
  loop
    perform net.http_post(url:=endpoint,
      headers:=jsonb_build_object('Content-Type','application/json','x-gamewire-cron-secret',secret),
      body:=jsonb_build_object('action','run-simulation','eventId',job.event_id),timeout_milliseconds:=180000);
    update public.gamewire_simulation_jobs set dispatched_at=clock_timestamp(),
      next_run_at=clock_timestamp()+interval '3 minutes',updated_at=clock_timestamp() where event_id=job.event_id;
    dispatched:=dispatched+1;
  end loop;
  return dispatched;
end $$;
revoke all on function public.gamewire_request_simulation(text,timestamptz,text),
  public.gamewire_queue_simulations(jsonb),public.gamewire_fail_simulation(text,uuid,text),public.gamewire_dispatch_simulations() from public,anon,authenticated;
grant execute on function public.gamewire_request_simulation(text,timestamptz,text),
  public.gamewire_queue_simulations(jsonb),public.gamewire_fail_simulation(text,uuid,text),public.gamewire_dispatch_simulations() to service_role;
select cron.unschedule(jobid) from cron.job where jobname='gamewire-warm-nfl-simulations';
select cron.schedule('gamewire-warm-nfl-simulations','*/5 * * * *',$job$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-url'),'/poll-live-games','/gamewire-bot'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-gamewire-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-secret')),
    body := '{"action":"warm-simulations"}'::jsonb,timeout_milliseconds := 180000
  );
$job$);
select cron.unschedule(jobid) from cron.job where jobname='gamewire-dispatch-nfl-simulations';
select cron.schedule('gamewire-dispatch-nfl-simulations','* * * * *','select public.gamewire_dispatch_simulations();');
notify pgrst,'reload schema';
commit;
