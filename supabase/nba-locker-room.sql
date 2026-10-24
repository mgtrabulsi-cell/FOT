begin;
create table if not exists public.locker_room_daily_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  entry_key text not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  observed_at timestamptz not null,
  primary key(user_id,activity_date,entry_key)
);
alter table public.locker_room_daily_history enable row level security;
revoke all on public.locker_room_daily_history from public,anon,authenticated;
grant select on public.locker_room_daily_history to authenticated;
drop policy if exists "Users read own daily activity" on public.locker_room_daily_history;
create policy "Users read own daily activity" on public.locker_room_daily_history
for select to authenticated using(auth.uid()=user_id);
create or replace function public.save_locker_room_daily_history(
  archive_date date, entries jsonb, archive_owner uuid default auth.uid()
) returns void language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is null or auth.uid() is distinct from archive_owner then
    raise exception 'Sign in to save Locker Room history';
  end if;
  if archive_date is null or archive_date < date '2000-01-01' or archive_date > date '2200-12-31' then
    raise exception 'Valid activity date is required';
  end if;
  if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries)>500 then
    raise exception 'Expected at most 500 history entries';
  end if;
  if exists(select 1 from jsonb_array_elements(entries) entry where
    coalesce(entry->'payload'->>'kind','') not in ('news','score','play','player')
    or (entry->'payload'->>'kind'='player' and entry->'payload'->'game'->>'league' is distinct from 'NBA')
    or (entry->'payload'->>'kind'='score' and entry->'payload'->>'league' is distinct from 'NBA')) then
    raise exception 'Expected NBA activity entries';
  end if;
  insert into public.locker_room_daily_history(user_id,activity_date,entry_key,payload,observed_at)
  select auth.uid(),archive_date,entry.key,entry.payload,entry.observed_at
  from jsonb_to_recordset(entries) entry(key text,payload jsonb,observed_at timestamptz)
  on conflict(user_id,activity_date,entry_key) do update set payload=excluded.payload,observed_at=excluded.observed_at
  where excluded.observed_at>locker_room_daily_history.observed_at
    and not (locker_room_daily_history.payload->>'kind'='player'
      and locker_room_daily_history.payload->'game'->>'status'='FINAL'
      and excluded.payload->'game'->>'status'<>'FINAL');
end;
$$;
revoke all on function public.save_locker_room_daily_history(date,jsonb,uuid) from public,anon;
grant execute on function public.save_locker_room_daily_history(date,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
