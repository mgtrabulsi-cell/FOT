begin;
-- One Angle post can be pinned to the top of the feed, opened by default.
alter table public.angles add column if not exists pinned_at timestamptz;
grant update (pinned_at) on public.angles to authenticated;
-- At most one pinned post at a time.
drop index if exists angles_single_pin;
create unique index angles_single_pin on public.angles ((true)) where pinned_at is not null;
-- Pin/unpin must not consume a content revision (the revision trigger otherwise blocks every pin).
create or replace function public.update_angle_revision() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.revision = old.revision then
    if new.pinned_at is distinct from old.pinned_at
      and to_jsonb(new) - 'pinned_at' - 'updated_at' = to_jsonb(old) - 'pinned_at' - 'updated_at' then
      new.updated_at := clock_timestamp();
      return new;
    end if;
    raise exception 'Reload this angle before saving another revision';
  end if;
  if new.revision <> old.revision + 1 then raise exception 'Reload this angle before saving another revision'; end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
notify pgrst, 'reload schema';
commit;
