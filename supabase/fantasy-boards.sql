begin;

alter table public.matchup_boards add column if not exists board_type text not null default 'top'
  check (board_type in ('top','hate'));
alter table public.matchup_reads add column if not exists board_type text not null default 'top'
  check (board_type in ('top','hate'));
alter table public.matchup_reads drop constraint if exists matchup_reads_season_week_fkey;
alter table public.matchup_boards drop constraint matchup_boards_pkey;
alter table public.matchup_boards add primary key (season,week,board_type);
alter table public.matchup_reads drop constraint matchup_reads_pkey;
alter table public.matchup_reads add primary key (user_id,season,week,revision,player_id,board_type);
alter table public.matchup_reads add constraint matchup_reads_season_week_fkey
  foreign key (season,week,board_type) references public.matchup_boards(season,week,board_type) on delete cascade;

drop policy if exists "Record current published pick read" on public.matchup_reads;
create policy "Record current published pick read" on public.matchup_reads for insert to authenticated
with check(user_id = auth.uid() and not public.account_deletion_in_progress()
  and exists(select 1 from public.matchup_boards board
    where board.season = matchup_reads.season and board.week = matchup_reads.week
      and board.board_type = matchup_reads.board_type and board.revision = matchup_reads.revision
      and ((player_id = 'empty' and jsonb_array_length(board.picks) = 0)
        or exists(select 1 from jsonb_array_elements(board.picks) pick where pick->>'id' = player_id))));

create or replace function public.publish_fantasy_board(
  board_season integer, board_week integer, board_picks jsonb, expected_revision integer, board_kind text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare current_revision integer; pick jsonb;
begin
  if public.livewire_role() is null then raise exception 'Admin access is required to publish matchups'; end if;
  if public.account_deletion_in_progress() then raise exception 'Account deletion is in progress'; end if;
  if board_kind is null or board_kind not in ('top','hate') then raise exception 'Choose a valid Fantasy board'; end if;
  if board_season is null or board_season not between 2000 and 2200
    or board_week is null or board_week not between 1 and 18 then
    raise exception 'Choose a valid NFL season and week';
  end if;
  if board_picks is null or jsonb_typeof(board_picks) <> 'array' then raise exception 'Players must be a list'; end if;
  if jsonb_array_length(board_picks) > 16 then raise exception 'Publish up to four players per position'; end if;
  for pick in select value from jsonb_array_elements(board_picks) loop
    if jsonb_typeof(pick) <> 'object'
      or coalesce(pick->>'position', '') not in ('QB','RB','WR','TE')
      or jsonb_typeof(pick->'id') is distinct from 'string'
      or jsonb_typeof(pick->'teamId') is distinct from 'string'
      or jsonb_typeof(pick->'gameId') is distinct from 'string'
      or coalesce(pick->>'id', '') !~ '^[0-9]{1,15}$'
      or coalesce(pick->>'teamId', '') !~ '^[0-9]{1,10}$'
      or coalesce(pick->>'gameId', '') !~ '^NFL:[0-9]{1,15}$'
      or coalesce(char_length(btrim(pick->>'name')), 0) not between 1 and 120
      or jsonb_typeof(pick->'name') is distinct from 'string'
      or jsonb_typeof(pick->'headshot') is distinct from 'string'
      or char_length(pick->>'headshot') > 2048
      or ((pick->>'headshot') <> '' and (pick->>'headshot') !~ '^https://a[.]espncdn[.]com/')
      or (select count(*) from jsonb_object_keys(pick)) <> 6 then
      raise exception 'Invalid player selection';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(board_picks) p group by p->>'position' having count(*) > 4) then
    raise exception 'Publish up to four players per position';
  end if;
  if exists(select 1 from jsonb_array_elements(board_picks) p group by p->>'id' having count(*) > 1) then
    raise exception 'A player can only be selected once';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(board_season, board_week);
  select revision into current_revision from public.matchup_boards
    where season = board_season and week = board_week and board_type = board_kind;
  if expected_revision is null or expected_revision <> coalesce(current_revision, 0) then
    raise exception 'Another admin updated this week. Reload the published board before publishing';
  end if;
  insert into public.matchup_boards(season,week,board_type,picks,revision,updated_by)
  values(board_season,board_week,board_kind,board_picks,1,auth.uid())
  on conflict(season,week,board_type) do update set picks=excluded.picks,
    revision=public.matchup_boards.revision+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  returning revision into current_revision;
  return current_revision;
end;
$$;
revoke all on function public.publish_fantasy_board(integer,integer,jsonb,integer,text) from public, anon;
grant execute on function public.publish_fantasy_board(integer,integer,jsonb,integer,text) to authenticated;

-- Keep the existing publishing API for older clients and Top Performers tests.
create or replace function public.publish_matchup_board(board_season integer, board_week integer, board_picks jsonb, expected_revision integer)
returns integer language sql security invoker set search_path = ''
as $$ select public.publish_fantasy_board(board_season,board_week,board_picks,expected_revision,'top'); $$;

create or replace function public.analyst_unread_items(board_season integer, board_week integer)
returns table(kind text, key text)
language sql stable security invoker set search_path = ''
as $$
  select case when story.section = 'news' then 'news' else 'angle' end, story.id::text from public.angles story
  where story.status = 'published' and public.angle_visible_in_week(story, board_season, board_week)
    and not exists(select 1 from public.angle_reads receipt where receipt.user_id = auth.uid() and receipt.angle_id = story.id)
  union all
  select 'picks'::text, board.season || ':' || board.week || ':' || board.revision || ':' || target.player_id
  from public.matchup_boards board
  cross join lateral (
    select pick->>'id' as player_id from jsonb_array_elements(board.picks) pick
    union all select 'empty' where jsonb_array_length(board.picks) = 0
  ) target
  where board.season = board_season and board.week = board_week and board.board_type='top'
    and not exists(select 1 from public.matchup_reads receipt where receipt.user_id = auth.uid()
      and receipt.season = board.season and receipt.week = board.week and receipt.revision = board.revision
      and receipt.board_type='top' and receipt.player_id = target.player_id);
$$;

create or replace function public.fantasy_unread_items(board_season integer, board_week integer)
returns table(kind text, key text)
language sql stable security invoker set search_path = ''
as $$
  select * from public.analyst_unread_items(board_season,board_week)
  union all
  select 'hate'::text, board.season || ':' || board.week || ':' || board.revision || ':' || target.player_id
  from public.matchup_boards board
  cross join lateral (
    select pick->>'id' as player_id from jsonb_array_elements(board.picks) pick
    union all select 'empty' where jsonb_array_length(board.picks) = 0
  ) target
  where board.season = board_season and board.week = board_week and board.board_type='hate'
    and not exists(select 1 from public.matchup_reads receipt where receipt.user_id = auth.uid()
      and receipt.season = board.season and receipt.week = board.week and receipt.revision = board.revision
      and receipt.board_type='hate' and receipt.player_id = target.player_id);
$$;
revoke all on function public.fantasy_unread_items(integer,integer) from public;
grant execute on function public.fantasy_unread_items(integer,integer) to anon, authenticated;

create or replace function public.mark_fantasy_read(item_kind text, item_key text) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to sync read status'; end if;
  if item_kind='hate' and item_key ~ '^[0-9]{4}:[0-9]{1,2}:[1-9][0-9]*:([0-9]{1,15}|empty)$' then
    insert into public.matchup_reads(user_id,season,week,revision,player_id,board_type)
    values(auth.uid(),split_part(item_key,':',1)::integer,split_part(item_key,':',2)::integer,
      split_part(item_key,':',3)::integer,split_part(item_key,':',4),'hate') on conflict do nothing;
  else perform public.mark_analyst_read(item_kind,item_key);
  end if;
end;
$$;
revoke all on function public.mark_fantasy_read(text,text) from public, anon;
grant execute on function public.mark_fantasy_read(text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
