begin;

create table if not exists public.gamewaire_push_days (
  publication_date date primary key,
  queued_at timestamptz not null default now()
);
create table if not exists public.gamewaire_push_deliveries (
  id bigint generated always as identity primary key,
  publication_date date not null references public.gamewaire_push_days(publication_date) on delete cascade,
  user_id uuid not null,
  endpoint text not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz,
  last_error text,
  unique(publication_date, endpoint),
  foreign key(user_id, endpoint) references public.user_push_subscriptions(user_id, endpoint) on delete cascade
);
alter table public.gamewaire_push_days enable row level security;
alter table public.gamewaire_push_deliveries enable row level security;
revoke all on public.gamewaire_push_days, public.gamewaire_push_deliveries from public, anon, authenticated;
grant all on public.gamewaire_push_days, public.gamewaire_push_deliveries to service_role;
grant usage, select on sequence public.gamewaire_push_deliveries_id_seq to service_role;
create index if not exists gamewaire_push_pending_idx on public.gamewaire_push_deliveries(next_attempt_at)
  where delivered_at is null;

create or replace function public.queue_gamewaire_push() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
  start_at timestamptz := today::timestamp at time zone 'America/New_York';
  end_at timestamptz := (today + 1)::timestamp at time zone 'America/New_York';
  pick_count integer;
begin
  -- Serialize publications across different games before checking the daily threshold.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gamewaire-push:' || today::text, 0));
  if exists (select 1 from public.gamewaire_push_days where publication_date = today) then return null; end if;
  select count(*) into pick_count from (
    select distinct publication.sport, publication.event_id, pick->>'key'
    from public.gamewaire_publications publication
    cross join lateral jsonb_array_elements(publication.picks) pick
    where publication.published_at >= start_at and publication.published_at < end_at
      and nullif(pick->>'key', '') is not null
  ) selections;
  if pick_count < 5 then return null; end if;
  insert into public.gamewaire_push_days(publication_date) values(today) on conflict do nothing;
  if not found then return null; end if;
  insert into public.gamewaire_push_deliveries(publication_date, user_id, endpoint, expires_at)
    select today, user_id, endpoint, end_at from public.user_push_subscriptions
    on conflict(publication_date, endpoint) do nothing;
  return null;
end;
$$;
revoke all on function public.queue_gamewaire_push() from public, anon, authenticated;
drop trigger if exists gamewaire_published_push on public.gamewaire_publications;
create trigger gamewaire_published_push after insert or update on public.gamewaire_publications
  for each statement execute function public.queue_gamewaire_push();

create or replace function public.claim_gamewaire_push()
returns setof public.gamewaire_push_deliveries
language sql security definer set search_path = ''
as $$
  update public.gamewaire_push_deliveries as delivery
  set attempts = delivery.attempts + 1, next_attempt_at = now() + interval '5 minutes'
  where delivery.id in (
    select id from public.gamewaire_push_deliveries
    where delivered_at is null and next_attempt_at <= now() and expires_at > now()
    order by next_attempt_at, id
    for update skip locked limit 100
  )
  returning delivery.*;
$$;
revoke all on function public.claim_gamewaire_push() from public, anon, authenticated;
grant execute on function public.claim_gamewaire_push() to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'gamewire-gamewaire-push';
select cron.schedule(
  'gamewire-gamewaire-push',
  '* * * * *',
  $job$
    select net.http_post(
      url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-url'),
        '/poll-live-games', '/send-gamewaire-push'),
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-gamewire-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-secret')),
      body := '{}'::jsonb
    );
  $job$
);
notify pgrst, 'reload schema';
commit;
