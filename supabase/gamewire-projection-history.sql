begin;
create table if not exists public.gamewire_player_forecasts (
  id uuid primary key default gen_random_uuid(),
  player_id text not null check(player_id ~ '^[0-9]{1,12}$'),
  team_id text not null check(team_id ~ '^[0-9]{1,2}$'),
  position text not null check(position in ('QB','RB','WR','TE')),
  season integer not null check(season between 2000 and 2200),
  week integer not null check(week between 1 and 18),
  format text not null check(format in ('ppr','half','standard')),
  event_id text not null check(event_id ~ '^[0-9]+$'),
  event_start timestamptz not null,
  opponent text not null,
  model_version text not null,
  forecast_at timestamptz not null default clock_timestamp(),
  projections jsonb not null check(jsonb_typeof(projections)='array'),
  actuals jsonb,
  settled_at timestamptz,
  unique(player_id,season,event_id,format),
  check(forecast_at < event_start),
  check((actuals is null and settled_at is null) or (jsonb_typeof(actuals)='object' and settled_at >= event_start))
);
create index if not exists gamewire_forecast_pending on public.gamewire_player_forecasts(event_start) where settled_at is null;
create index if not exists gamewire_forecast_learning on public.gamewire_player_forecasts(season,position,format) where settled_at is not null;
alter table public.gamewire_player_forecasts enable row level security;
revoke all on public.gamewire_player_forecasts from public,anon,authenticated;
grant all on public.gamewire_player_forecasts to service_role;

create or replace function public.gamewire_save_forecast(forecast jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare saved public.gamewire_player_forecasts; entry jsonb; started timestamptz; recorded timestamptz := clock_timestamp();
begin
  started := (forecast->>'event_start')::timestamptz;
  if started <= recorded then return false; end if;
  if jsonb_typeof(forecast->'projections') is distinct from 'array' or jsonb_array_length(forecast->'projections')=0
    then raise exception 'No verified pregame estimates to archive'; end if;
  for entry in select value from jsonb_array_elements(forecast->'projections') loop
    if coalesce(entry->>'market','') not in ('player_pass_yds','player_rush_yds','player_reception_yds','player_receptions')
      or jsonb_typeof(entry->'estimate') is distinct from 'number' or jsonb_typeof(entry->'base') is distinct from 'number'
      or (entry->>'estimate')::numeric < 0 or (entry->>'base')::numeric < 0
      or jsonb_typeof(entry->'label') is distinct from 'string'
      then raise exception 'Invalid archived stat projection'; end if;
  end loop;
  if (select count(distinct value->>'market') from jsonb_array_elements(forecast->'projections'))
    <> jsonb_array_length(forecast->'projections') then raise exception 'Duplicate archived stat market'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',forecast->>'player_id',forecast->>'season',forecast->>'event_id',forecast->>'format'),0));
  select * into saved from public.gamewire_player_forecasts where player_id=forecast->>'player_id'
    and season=(forecast->>'season')::integer and event_id=forecast->>'event_id' and format=forecast->>'format';
  -- Never alter a forecast after its original kickoff, even if a later feed changes the scheduled time.
  recorded := clock_timestamp();
  if started <= recorded or (saved.id is not null and (saved.event_start <= recorded or saved.settled_at is not null)) then return false; end if;
  insert into public.gamewire_player_forecasts(player_id,team_id,position,season,week,format,event_id,event_start,opponent,model_version,forecast_at,projections)
    values(forecast->>'player_id',forecast->>'team_id',forecast->>'position',(forecast->>'season')::integer,
      (forecast->>'week')::integer,forecast->>'format',forecast->>'event_id',started,forecast->>'opponent',
      forecast->>'model_version',recorded,forecast->'projections')
    on conflict(player_id,season,event_id,format) do update set
      forecast_at=excluded.forecast_at,projections=excluded.projections,model_version=excluded.model_version;
  return true;
end $$;
revoke all on function public.gamewire_save_forecast(jsonb) from public,anon,authenticated;
grant execute on function public.gamewire_save_forecast(jsonb) to service_role;

create or replace function public.gamewire_lock_forecast() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.event_start <= clock_timestamp() and
    (to_jsonb(new)-'actuals'-'settled_at') is distinct from (to_jsonb(old)-'actuals'-'settled_at')
    then raise exception 'Pregame forecasts are immutable after kickoff'; end if;
  return new;
end $$;
revoke all on function public.gamewire_lock_forecast() from public,anon,authenticated;
drop trigger if exists gamewire_lock_forecast on public.gamewire_player_forecasts;
create trigger gamewire_lock_forecast before update on public.gamewire_player_forecasts
  for each row execute function public.gamewire_lock_forecast();

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname='gamewire-settle-player-forecasts';
select cron.schedule('gamewire-settle-player-forecasts','*/15 * * * *',$job$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-url'),'/poll-live-games','/gamewire-bot'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-gamewire-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-secret')),
    body := '{"action":"settle-projections"}'::jsonb,timeout_milliseconds := 180000
  );
$job$);
notify pgrst,'reload schema';
commit;
