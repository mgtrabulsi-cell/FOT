begin;
-- Per-game API-Sports details (player box stats and team statistics) written by poll-sports-feed.
create table if not exists public.live_feed_game_details (
  sport text not null check (sport in ('NFL','NBA')),
  provider_game_id text not null check (length(provider_game_id) between 1 and 40),
  status text not null check (status in ('UPCOMING','LIVE','FINAL')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  fetched_at timestamptz not null default now(),
  primary key (sport, provider_game_id)
);
alter table public.live_feed_game_details enable row level security;
revoke all on public.live_feed_game_details from anon, authenticated;
grant select on public.live_feed_game_details to anon, authenticated;
grant all on public.live_feed_game_details to service_role;
drop policy if exists "Live feed game details are readable" on public.live_feed_game_details;
create policy "Live feed game details are readable" on public.live_feed_game_details for select to anon, authenticated using (true);
notify pgrst, 'reload schema';
commit;
