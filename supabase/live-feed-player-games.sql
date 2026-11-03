begin;
-- Per-player, per-game skill statistics from API-Sports (player game logs).
-- A sentinel row with api_player_id = 'game' marks each fully synced final.
create table if not exists public.live_feed_player_games (
  sport text not null check (sport in ('NFL','NBA')),
  season integer not null check (season between 2000 and 2100),
  provider_game_id text not null check (length(provider_game_id) between 1 and 40),
  api_player_id text not null check (length(api_player_id) between 1 and 20),
  api_team_id text not null check (length(api_team_id) between 1 and 20),
  name text not null check (length(name) between 1 and 80),
  game_date date not null,
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (sport, provider_game_id, api_player_id)
);
create index if not exists live_feed_player_games_player on public.live_feed_player_games (sport, season, api_player_id);
alter table public.live_feed_player_games enable row level security;
revoke all on public.live_feed_player_games from anon, authenticated;
grant select on public.live_feed_player_games to anon, authenticated;
grant all on public.live_feed_player_games to service_role;
drop policy if exists "Player game logs are readable" on public.live_feed_player_games;
create policy "Player game logs are readable" on public.live_feed_player_games for select to anon, authenticated using (true);

alter table public.live_feed_season_state add column if not exists players_synced integer not null default 0;
notify pgrst, 'reload schema';
commit;
