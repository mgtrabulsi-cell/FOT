begin;

create table if not exists public.gamewire_nba_simulation_jobs (
  event_id text primary key check(event_id ~ '^[0-9]{1,12}$'),
  event_start timestamptz not null,
  payload jsonb, response jsonb,
  lease_token uuid, lease_until timestamptz not null default '-infinity',
  next_run_at timestamptz not null default clock_timestamp(), dispatched_at timestamptz,
  attempts integer not null default 0, last_error text,
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists gamewire_nba_simulation_queue on public.gamewire_nba_simulation_jobs(next_run_at,event_start);
create table if not exists public.gamewire_nba_forecasts (
  event_id text not null check(event_id ~ '^[0-9]{1,12}$'), model_version text not null,
  event_start timestamptz not null, forecast_at timestamptz not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  actuals jsonb, settled_at timestamptz,
  primary key(event_id,model_version), check(forecast_at < event_start),
  check((actuals is null and settled_at is null) or (jsonb_typeof(actuals)='object' and settled_at>=event_start))
);
create index if not exists gamewire_nba_forecasts_pending on public.gamewire_nba_forecasts(event_start) where settled_at is null;
create table if not exists public.gamewire_nba_simulation_revisions (
  event_id text not null, model_version text not null, forecast_at timestamptz not null,
  payload jsonb not null, primary key(event_id,model_version,forecast_at)
);
alter table public.gamewire_nba_simulation_jobs enable row level security;
alter table public.gamewire_nba_forecasts enable row level security;
alter table public.gamewire_nba_simulation_revisions enable row level security;
revoke all on public.gamewire_nba_simulation_jobs,public.gamewire_nba_forecasts,public.gamewire_nba_simulation_revisions from public,anon,authenticated;
grant all on public.gamewire_nba_simulation_jobs,public.gamewire_nba_forecasts,public.gamewire_nba_simulation_revisions to service_role;

create or replace function public.gamewire_queue_nba_simulations(games jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare item jsonb; started timestamptz;
begin
  if jsonb_typeof(games) is distinct from 'array' or jsonb_array_length(games)>256 then raise exception 'Invalid NBA simulation slate'; end if;
  for item in select value from jsonb_array_elements(games) loop
    started:=(item->>'event_start')::timestamptz;
    if item->>'event_id' is null or item->>'event_id' !~ '^[0-9]{1,12}$' or started is null
      or started<=clock_timestamp() or started>clock_timestamp()+interval '14 days' then raise exception 'Choose upcoming NBA games within fourteen days'; end if;
    if exists(select 1 from public.gamewire_nba_forecasts where event_id=item->>'event_id' and event_start<=clock_timestamp()) then continue; end if;
    insert into public.gamewire_nba_simulation_jobs(event_id,event_start) values(item->>'event_id',started)
    on conflict(event_id) do update set event_start=excluded.event_start,
      payload=case when public.gamewire_nba_simulation_jobs.event_start<>excluded.event_start then null else public.gamewire_nba_simulation_jobs.payload end,
      response=case when public.gamewire_nba_simulation_jobs.event_start<>excluded.event_start then null else public.gamewire_nba_simulation_jobs.response end,
      next_run_at=case when public.gamewire_nba_simulation_jobs.event_start<>excluded.event_start then clock_timestamp() else public.gamewire_nba_simulation_jobs.next_run_at end;
  end loop;
end $$;
create or replace function public.gamewire_claim_nba_simulation(target_event text,target_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare claimed text;
begin
  update public.gamewire_nba_simulation_jobs set lease_token=target_token,lease_until=clock_timestamp()+interval '2 minutes'
    where event_id=target_event and event_start>clock_timestamp() and lease_until<clock_timestamp() returning event_id into claimed;
  return claimed is not null;
end $$;
create or replace function public.gamewire_save_nba_simulation(target_token uuid,forecast jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.gamewire_nba_forecasts; started timestamptz; recorded timestamptz; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('nba-simulation:'||(forecast->>'eventId'),0));
  perform 1 from public.gamewire_nba_simulation_jobs where event_id=forecast->>'eventId'
    and lease_token=target_token and lease_until>clock_timestamp() for update;
  if not found then return null; end if;
  select * into saved from public.gamewire_nba_forecasts where event_id=forecast->>'eventId' and model_version='nba-joint-bootstrap-v1' for update;
  recorded:=clock_timestamp(); started:=(forecast->>'kickoff')::timestamptz;
  if started is null or started<=recorded or (saved.event_id is not null and (saved.event_start<=recorded or saved.settled_at is not null)) then return null; end if;
  if forecast->>'version' is distinct from 'nba-joint-bootstrap-v1' or forecast->>'status' is distinct from 'ready'
    or coalesce((forecast->'history'->>'home')::integer,0) not between 8 and 100 or coalesce((forecast->'history'->>'away')::integer,0) not between 8 and 100
    or coalesce((forecast->>'runs')::integer,0)<>1000 or forecast->'home'->>'id' is distinct from forecast->>'homeTeamId'
    or forecast->'away'->>'id' is distinct from forecast->>'awayTeamId' or forecast->>'homeTeamId'=forecast->>'awayTeamId'
    or coalesce(forecast->>'homeTeamId','') !~ '^[0-9]{1,12}$' or coalesce(forecast->>'awayTeamId','') !~ '^[0-9]{1,12}$'
    or jsonb_typeof(forecast->'home') is distinct from 'object' or jsonb_typeof(forecast->'away') is distinct from 'object'
    or jsonb_typeof(forecast->'home'->'players') is distinct from 'array' or jsonb_typeof(forecast->'away'->'players') is distinct from 'array'
    or jsonb_typeof(forecast->'baseline') is distinct from 'object' then raise exception 'Invalid NBA forecast'; end if;
  if saved.event_id is not null and saved.payload->>'lockedAt' is not null
    and saved.payload->>'availabilityKey'=forecast->>'availabilityKey' then return saved.payload; end if;
  result:=jsonb_set(forecast,'{forecastAt}',to_jsonb(recorded));
  if started<=recorded+interval '30 minutes' then
    result:=jsonb_set(result,'{lockedAt}',to_jsonb(recorded));
    result:=jsonb_set(result,'{refreshing}','false'::jsonb);
  end if;
  insert into public.gamewire_nba_forecasts(event_id,model_version,event_start,forecast_at,payload)
    values(forecast->>'eventId','nba-joint-bootstrap-v1',started,recorded,result)
    on conflict(event_id,model_version) do update set event_start=excluded.event_start,forecast_at=excluded.forecast_at,payload=excluded.payload;
  insert into public.gamewire_nba_simulation_revisions values(forecast->>'eventId','nba-joint-bootstrap-v1',recorded,result);
  return result;
end $$;
create or replace function public.gamewire_lock_nba_forecast() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.event_start<=clock_timestamp() and (to_jsonb(new)-'actuals'-'settled_at') is distinct from (to_jsonb(old)-'actuals'-'settled_at')
    then raise exception 'NBA pregame simulations are immutable after tipoff'; end if;
  return new;
end $$;
drop trigger if exists gamewire_lock_nba_forecast on public.gamewire_nba_forecasts;
create trigger gamewire_lock_nba_forecast before update on public.gamewire_nba_forecasts for each row execute function public.gamewire_lock_nba_forecast();
create or replace function public.gamewire_fail_nba_simulation(target_event text,target_token uuid,failure text) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.gamewire_nba_simulation_jobs set attempts=attempts+1,last_error=left(failure,1000),
    next_run_at=clock_timestamp()+make_interval(mins=>least(30,power(2,least(attempts,5))::integer)),updated_at=clock_timestamp()
    where event_id=target_event and lease_token=target_token;
end $$;
create or replace function public.gamewire_dispatch_nba_simulations() returns integer
language plpgsql security definer set search_path='' as $$
declare job public.gamewire_nba_simulation_jobs; available integer; dispatched integer:=0; endpoint text; secret text;
begin
  perform pg_advisory_xact_lock(hashtextextended('nba-simulation-dispatch',0));
  select greatest(0,4-count(*))::integer into available from public.gamewire_nba_simulation_jobs
    where dispatched_at>clock_timestamp()-interval '3 minutes' or lease_until>clock_timestamp();
  select replace(decrypted_secret,'/poll-live-games','/nba-simulation') into endpoint from vault.decrypted_secrets where name='gamewire-poll-url';
  select decrypted_secret into secret from vault.decrypted_secrets where name='gamewire-poll-secret';
  if endpoint is null or secret is null then raise exception 'NBA simulation cron secrets are not configured'; end if;
  for job in select * from public.gamewire_nba_simulation_jobs where event_start>clock_timestamp()
    and next_run_at<=clock_timestamp() and lease_until<clock_timestamp()
    and (dispatched_at is null or dispatched_at<=clock_timestamp()-interval '3 minutes')
    order by case when event_start<=clock_timestamp()+interval '35 minutes' then 0 else 1 end,
      case when response->>'status'='ready' and response->>'refreshing'='false' then 1 else 0 end,updated_at,event_id
    limit available for update skip locked
  loop
    perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-gamewire-cron-secret',secret),
      body:=jsonb_build_object('action','run','eventId',job.event_id),timeout_milliseconds:=180000);
    update public.gamewire_nba_simulation_jobs set dispatched_at=clock_timestamp(),next_run_at=clock_timestamp()+interval '3 minutes',
      updated_at=clock_timestamp() where event_id=job.event_id;
    dispatched:=dispatched+1;
  end loop;
  return dispatched;
end $$;
revoke all on function public.gamewire_queue_nba_simulations(jsonb),public.gamewire_claim_nba_simulation(text,uuid),
  public.gamewire_save_nba_simulation(uuid,jsonb),public.gamewire_fail_nba_simulation(text,uuid,text),
  public.gamewire_dispatch_nba_simulations(),public.gamewire_lock_nba_forecast() from public,anon,authenticated;
grant execute on function public.gamewire_queue_nba_simulations(jsonb),public.gamewire_claim_nba_simulation(text,uuid),
  public.gamewire_save_nba_simulation(uuid,jsonb),public.gamewire_fail_nba_simulation(text,uuid,text),
  public.gamewire_dispatch_nba_simulations() to service_role;
select cron.unschedule(jobid) from cron.job where jobname in ('gamewire-warm-nba-simulations','gamewire-dispatch-nba-simulations','gamewire-settle-nba-simulations');
select cron.schedule('gamewire-warm-nba-simulations','*/5 * * * *',$job$
  select net.http_post(url:=replace((select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-url'),'/poll-live-games','/nba-simulation'),
    headers:=jsonb_build_object('Content-Type','application/json','x-gamewire-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-secret')),
    body:='{"action":"warm"}'::jsonb,timeout_milliseconds:=180000);
$job$);
select cron.schedule('gamewire-dispatch-nba-simulations','* * * * *','select public.gamewire_dispatch_nba_simulations();');
select cron.schedule('gamewire-settle-nba-simulations','*/5 * * * *',$job$
  select net.http_post(url:=replace((select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-url'),'/poll-live-games','/nba-simulation'),
    headers:=jsonb_build_object('Content-Type','application/json','x-gamewire-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-secret')),
    body:='{"action":"settle"}'::jsonb,timeout_milliseconds:=180000);
$job$);
notify pgrst,'reload schema';
commit;
