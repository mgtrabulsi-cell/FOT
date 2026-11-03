begin;
-- One Angle post can be pinned to the top of the feed, opened by default.
alter table public.angles add column if not exists pinned_at timestamptz;
grant update (pinned_at) on public.angles to authenticated;
-- At most one pinned post at a time.
drop index if exists angles_single_pin;
create unique index angles_single_pin on public.angles ((true)) where pinned_at is not null;
notify pgrst, 'reload schema';
commit;
