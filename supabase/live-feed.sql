begin;
-- Normalized API-Sports live scores written by the poll-sports-feed function.
create table if not exists public.live_feed_games (
  sport text not null check (sport in ('NFL','NBA')),
  provider_game_id text not null check (length(provider_game_id) between 1 and 40),
  start_time timestamptz not null,
  away_name text not null check (length(away_name) between 1 and 80),
  home_name text not null check (length(home_name) between 1 and 80),
  away_score integer check (away_score between 0 and 400),
  home_score integer check (home_score between 0 and 400),
  away_linescore jsonb not null default '[]'::jsonb check (jsonb_typeof(away_linescore) = 'array'),
  home_linescore jsonb not null default '[]'::jsonb check (jsonb_typeof(home_linescore) = 'array'),
  status text not null check (status in ('UPCOMING','LIVE','FINAL')),
  period integer check (period between 0 and 20),
  clock text check (clock is null or length(clock) <= 20),
  fetched_at timestamptz not null default now(),
  primary key (sport, provider_game_id)
);
alter table public.live_feed_games enable row level security;
revoke all on public.live_feed_games from anon, authenticated;
grant select on public.live_feed_games to anon, authenticated;
grant all on public.live_feed_games to service_role;
drop policy if exists "Live feed games are readable" on public.live_feed_games;
create policy "Live feed games are readable" on public.live_feed_games for select to anon, authenticated using (true);

-- Per-sport API-Sports request bookkeeping so free-plan budgets are never exceeded.
create table if not exists public.live_feed_state (
  sport text primary key check (sport in ('NFL','NBA')),
  day date not null,
  requests_used integer not null default 0 check (requests_used >= 0),
  last_polled_at timestamptz
);
alter table public.live_feed_state enable row level security;
revoke all on public.live_feed_state from anon, authenticated;
grant select on public.live_feed_state to anon, authenticated;
grant all on public.live_feed_state to service_role;
drop policy if exists "Live feed state is readable" on public.live_feed_state;
create policy "Live feed state is readable" on public.live_feed_state for select to anon, authenticated using (true);

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'gamewire-live-feed';
select cron.schedule('gamewire-live-feed', '* * * * *', $job$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-url'),
      '/poll-live-games', '/poll-sports-feed'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-gamewire-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  );
$job$);
notify pgrst, 'reload schema';
commit;
