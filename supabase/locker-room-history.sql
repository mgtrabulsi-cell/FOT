create table if not exists public.locker_room_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  season integer not null check (season between 2000 and 2200),
  week integer not null check (week between 1 and 18),
  entry_key text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  observed_at timestamptz not null,
  primary key (user_id, season, week, entry_key)
);

alter table public.locker_room_history enable row level security;

drop policy if exists "Users can read their weekly history" on public.locker_room_history;
create policy "Users can read their weekly history"
  on public.locker_room_history for select to authenticated
  using (auth.uid() = user_id);

drop function if exists public.save_locker_room_history(integer, integer, jsonb);
create or replace function public.save_locker_room_history(
  archive_season integer, archive_week integer, entries jsonb, archive_owner uuid default auth.uid()
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or auth.uid() is distinct from archive_owner then
    raise exception 'Sign in to save Locker Room history';
  end if;
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) > 500 then
    raise exception 'Expected at most 500 history entries';
  end if;
  insert into public.locker_room_history (user_id, season, week, entry_key, payload, observed_at)
  select auth.uid(), archive_season, archive_week, entry.key, entry.payload, entry.observed_at
  from jsonb_to_recordset(entries) as entry(key text, payload jsonb, observed_at timestamptz)
  on conflict (user_id, season, week, entry_key) do update
    set payload = excluded.payload, observed_at = excluded.observed_at
    where excluded.observed_at > locker_room_history.observed_at
      and not (
        locker_room_history.payload->>'kind' = 'player'
        and locker_room_history.payload->'game'->>'status' = 'FINAL'
        and excluded.payload->'game'->>'status' <> 'FINAL'
      );
end;
$$;

revoke all on function public.save_locker_room_history(integer, integer, jsonb, uuid) from public, anon;
grant execute on function public.save_locker_room_history(integer, integer, jsonb, uuid) to authenticated;
