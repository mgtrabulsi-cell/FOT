begin;

create table if not exists public.nba_push_states (
  event_id text primary key,
  revision integer not null default 1,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.nba_push_deliveries (
  id bigint generated always as identity primary key,
  event_id text not null references public.nba_push_states(event_id) on delete cascade,
  alert_key text not null,
  kind text not null check (kind in ('quarter', 'milestone', 'final-player', 'buzzer')),
  team_ids text[] not null default '{}',
  user_id uuid not null,
  endpoint text not null,
  body text not null,
  url text not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  delivered_at timestamptz,
  last_error text,
  unique(event_id, alert_key, endpoint),
  foreign key(user_id, endpoint) references public.user_push_subscriptions(user_id, endpoint) on delete cascade
);
alter table public.nba_push_states enable row level security;
alter table public.nba_push_deliveries enable row level security;
revoke all on public.nba_push_states, public.nba_push_deliveries from public, anon, authenticated;
grant all on public.nba_push_states, public.nba_push_deliveries to service_role;
grant usage, select on sequence public.nba_push_deliveries_id_seq to service_role;
create index if not exists nba_push_pending_idx on public.nba_push_deliveries(next_attempt_at) where delivered_at is null;

create or replace function public.save_nba_push_poll(game_id text, expected_revision integer, next_state jsonb, alerts jsonb, game_url text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare current_revision integer;
begin
  -- Serialize baseline/state changes and enqueue their alerts in one transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nba-push:' || game_id, 0));
  select revision into current_revision from public.nba_push_states where event_id = game_id;
  if coalesce(current_revision, 0) <> expected_revision then return false; end if;
  insert into public.nba_push_states(event_id, revision, state) values(game_id, 1, next_state)
  on conflict(event_id) do update set revision = nba_push_states.revision + 1, state = excluded.state, updated_at = now();
  insert into public.nba_push_deliveries(event_id, alert_key, kind, team_ids, user_id, endpoint, body, url)
  select game_id, alert->>'key', alert->>'kind',
    array(select jsonb_array_elements_text(alert->'teamIds')), subscription.user_id, subscription.endpoint, alert->>'body', game_url
  from jsonb_array_elements(alerts) alert
  cross join public.user_push_subscriptions subscription
  where subscription.notify_scores
    and (alert->>'kind' <> 'quarter' or exists(
      select 1 from public.user_favorites favorite, jsonb_array_elements(favorite.favorites) entry
      where favorite.user_id = subscription.user_id and entry->>'feedPath' = 'basketball/nba'
        and entry->>'type' = 'team' and (alert->'teamIds') ? (entry->>'id')
    ))
  on conflict(event_id, alert_key, endpoint) do nothing;
  return true;
end;
$$;
revoke all on function public.save_nba_push_poll(text, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_nba_push_poll(text, integer, jsonb, jsonb, text) to service_role;

create or replace function public.claim_nba_push()
returns setof public.nba_push_deliveries language sql security definer set search_path = ''
as $$
  update public.nba_push_deliveries delivery
  set attempts = delivery.attempts + 1, next_attempt_at = now() + interval '5 minutes'
  where delivery.id in (
    select id from public.nba_push_deliveries
    where delivered_at is null and next_attempt_at <= now() and expires_at > now()
    order by next_attempt_at, id for update skip locked limit 100
  ) returning delivery.*;
$$;
revoke all on function public.claim_nba_push() from public, anon, authenticated;
grant execute on function public.claim_nba_push() to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'gamewire-nba-push';
select cron.schedule('gamewire-nba-push', '* * * * *', $job$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-url'),
      '/poll-live-games', '/poll-nba-games'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-gamewire-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$job$);
-- Bound retained event state and delivery history without affecting active retries.
select cron.unschedule(jobid) from cron.job where jobname = 'gamewire-nba-push-cleanup';
select cron.schedule('gamewire-nba-push-cleanup', '15 8 * * *',
  $job$ delete from public.nba_push_states where updated_at < now() - interval '7 days'; $job$);
notify pgrst, 'reload schema';
commit;
