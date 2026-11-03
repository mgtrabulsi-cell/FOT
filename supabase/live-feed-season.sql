begin;
-- Season-long per-team game statistics from API-Sports, two rows per final.
-- Powers NFL Team Comparison season averages and league ranks without ESPN.
create table if not exists public.live_feed_team_games (
  sport text not null check (sport in ('NFL','NBA')),
  season integer not null check (season between 2000 and 2100),
  provider_game_id text not null check (length(provider_game_id) between 1 and 40),
  api_team_id text not null check (length(api_team_id) between 1 and 20),
  espn_team_id text check (espn_team_id is null or length(espn_team_id) between 1 and 20),
  team_name text not null check (length(team_name) between 1 and 80),
  game_date date not null,
  points_for integer check (points_for between 0 and 400),
  points_against integer check (points_against between 0 and 400),
  yards numeric, pass_yards numeric, rush_yards numeric,
  yards_against numeric, pass_yards_against numeric, rush_yards_against numeric,
  updated_at timestamptz not null default now(),
  primary key (sport, provider_game_id, api_team_id)
);
alter table public.live_feed_team_games enable row level security;
revoke all on public.live_feed_team_games from anon, authenticated;
grant select on public.live_feed_team_games to anon, authenticated;
grant all on public.live_feed_team_games to service_role;
drop policy if exists "Season team games are readable" on public.live_feed_team_games;
create policy "Season team games are readable" on public.live_feed_team_games for select to anon, authenticated using (true);

-- Completeness marker: clients only trust the season data when every final is synced.
create table if not exists public.live_feed_season_state (
  sport text not null check (sport in ('NFL','NBA')),
  season integer not null check (season between 2000 and 2100),
  finals_total integer not null default 0 check (finals_total >= 0),
  finals_synced integer not null default 0 check (finals_synced >= 0),
  updated_at timestamptz not null default now(),
  primary key (sport, season)
);
alter table public.live_feed_season_state enable row level security;
revoke all on public.live_feed_season_state from anon, authenticated;
grant select on public.live_feed_season_state to anon, authenticated;
grant all on public.live_feed_season_state to service_role;
drop policy if exists "Season sync state is readable" on public.live_feed_season_state;
create policy "Season sync state is readable" on public.live_feed_season_state for select to anon, authenticated using (true);
notify pgrst, 'reload schema';
commit;
