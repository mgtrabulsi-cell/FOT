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
  if forecast->'payload'->>'status' is distinct from 'ready'
    or forecast->'payload'->>'eventId' is distinct from forecast->>'event_id'
    or forecast->'payload'->>'version' is distinct from forecast->>'model_version'
    or (forecast->'payload'->'history'->>'home')::integer <> 100
    or (forecast->'payload'->'history'->>'away')::integer <> 100
    or jsonb_typeof(forecast->'payload'->'scenarios') is distinct from 'array'
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
select cron.unschedule(jobid) from cron.job where jobname='gamewire-warm-nfl-simulations';
select cron.schedule('gamewire-warm-nfl-simulations','*/2 * * * *',$job$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-url'),'/poll-live-games','/gamewire-bot'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-gamewire-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-secret')),
    body := '{"action":"warm-simulations"}'::jsonb,timeout_milliseconds := 180000
  );
$job$);
notify pgrst,'reload schema';
commit;
