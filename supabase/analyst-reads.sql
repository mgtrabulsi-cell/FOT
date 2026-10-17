begin;
create table if not exists public.angle_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  angle_id uuid not null references public.angles(id) on delete cascade,
  primary key(user_id, angle_id)
);
create table if not exists public.matchup_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  season integer not null,
  week integer not null,
  revision integer not null check (revision > 0),
  player_id text not null check (player_id ~ '^([0-9]{1,15}|empty)$'),
  primary key(user_id, season, week, revision, player_id),
  foreign key(season, week) references public.matchup_boards(season, week) on delete cascade
);
alter table public.angle_reads enable row level security;
alter table public.matchup_reads enable row level security;
revoke all on public.angle_reads, public.matchup_reads from public, anon, authenticated;
grant select on public.angle_reads, public.matchup_reads to anon, authenticated;
grant insert on public.angle_reads, public.matchup_reads to authenticated;
drop policy if exists "Own angle receipts" on public.angle_reads;
create policy "Own angle receipts" on public.angle_reads for select to authenticated using(user_id = auth.uid());
drop policy if exists "Record published angle read" on public.angle_reads;
create policy "Record published angle read" on public.angle_reads for insert to authenticated
with check(user_id = auth.uid() and not public.account_deletion_in_progress()
  and exists(select 1 from public.angles where id = angle_id and status = 'published'));
drop policy if exists "Own picks receipts" on public.matchup_reads;
create policy "Own picks receipts" on public.matchup_reads for select to authenticated using(user_id = auth.uid());
drop policy if exists "Record current published pick read" on public.matchup_reads;
create policy "Record current published pick read" on public.matchup_reads for insert to authenticated
with check(user_id = auth.uid() and not public.account_deletion_in_progress()
  and exists(select 1 from public.matchup_boards board
    where board.season = matchup_reads.season and board.week = matchup_reads.week and board.revision = matchup_reads.revision
      and ((player_id = 'empty' and jsonb_array_length(board.picks) = 0)
        or exists(select 1 from jsonb_array_elements(board.picks) pick where pick->>'id' = player_id))));

create or replace function public.analyst_unread_items(board_season integer, board_week integer)
returns table(kind text, key text)
language sql stable security invoker set search_path = ''
as $$
  select 'angle'::text, story.id::text from public.angles story
  where story.status = 'published' and story.season = board_season and story.week = board_week
    and not exists(select 1 from public.angle_reads receipt where receipt.user_id = auth.uid() and receipt.angle_id = story.id)
  union all
  select 'picks'::text, board.season || ':' || board.week || ':' || board.revision || ':' || target.player_id
  from public.matchup_boards board
  cross join lateral (
    select pick->>'id' as player_id from jsonb_array_elements(board.picks) pick
    union all select 'empty' where jsonb_array_length(board.picks) = 0
  ) target
  where board.season = board_season and board.week = board_week
    and not exists(select 1 from public.matchup_reads receipt where receipt.user_id = auth.uid()
      and receipt.season = board.season and receipt.week = board.week and receipt.revision = board.revision
      and receipt.player_id = target.player_id);
$$;
revoke all on function public.analyst_unread_items(integer,integer) from public;
grant execute on function public.analyst_unread_items(integer,integer) to anon, authenticated;

create or replace function public.mark_analyst_read(item_kind text, item_key text) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to sync read status'; end if;
  if item_kind = 'angle' and item_key ~* '^[0-9a-f-]{36}$' then
    insert into public.angle_reads(user_id, angle_id) values(auth.uid(), item_key::uuid) on conflict do nothing;
  elsif item_kind = 'picks' and item_key ~ '^[0-9]{4}:[0-9]{1,2}:[1-9][0-9]*:([0-9]{1,15}|empty)$' then
    insert into public.matchup_reads(user_id, season, week, revision, player_id)
    values(auth.uid(), split_part(item_key,':',1)::integer, split_part(item_key,':',2)::integer,
      split_part(item_key,':',3)::integer, split_part(item_key,':',4)) on conflict do nothing;
  else raise exception 'Invalid Analyst Desk receipt'; end if;
end;
$$;
revoke all on function public.mark_analyst_read(text,text) from public, anon;
grant execute on function public.mark_analyst_read(text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
