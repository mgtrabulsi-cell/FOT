begin;
-- NFL roster bridge: ESPN athletes matched to API-Sports player IDs per team.
create table if not exists public.live_feed_rosters (
  sport text not null check (sport in ('NFL','NBA')),
  season integer not null check (season between 2000 and 2100),
  espn_team_id text not null check (length(espn_team_id) between 1 and 20),
  api_team_id text not null check (length(api_team_id) between 1 and 20),
  espn_player_id text not null check (length(espn_player_id) between 1 and 20),
  api_player_id text check (api_player_id is null or length(api_player_id) between 1 and 20),
  name text not null check (length(name) between 1 and 80),
  position text not null check (length(position) <= 10),
  jersey text not null default '' check (length(jersey) <= 4),
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (sport, season, espn_team_id, espn_player_id)
);
alter table public.live_feed_rosters enable row level security;
revoke all on public.live_feed_rosters from anon, authenticated;
grant select on public.live_feed_rosters to anon, authenticated;
grant all on public.live_feed_rosters to service_role;
drop policy if exists "Roster bridge is readable" on public.live_feed_rosters;
create policy "Roster bridge is readable" on public.live_feed_rosters for select to anon, authenticated using (true);

create table if not exists public.live_feed_roster_state (
  sport text not null check (sport in ('NFL','NBA')),
  season integer not null check (season between 2000 and 2100),
  espn_team_id text not null check (length(espn_team_id) between 1 and 20),
  synced_at timestamptz not null default now(),
  primary key (sport, season, espn_team_id)
);
alter table public.live_feed_roster_state enable row level security;
revoke all on public.live_feed_roster_state from anon, authenticated;
grant select on public.live_feed_roster_state to anon, authenticated;
grant all on public.live_feed_roster_state to service_role;
drop policy if exists "Roster sync state is readable" on public.live_feed_roster_state;
create policy "Roster sync state is readable" on public.live_feed_roster_state for select to anon, authenticated using (true);
notify pgrst, 'reload schema';
commit;
