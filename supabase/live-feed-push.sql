begin;
-- Links API-Sports games to ESPN event IDs so the push poller can consume the
-- live feed directly while keeping its ESPN-keyed notification state.
alter table public.live_feed_games add column if not exists espn_event_id text
  check (espn_event_id is null or length(espn_event_id) between 1 and 30);
notify pgrst, 'reload schema';
commit;
