begin;

create or replace function public.angle_visible_in_week(story public.angles, board_season integer, board_week integer)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select (story.season = board_season and story.week = board_week)
    or (story.section = 'angle' and story.status = 'published'
      and split_part(story.game_id, ':', 1) in ('NBA','NHL','UCL','SOCCER')
      and story.published_at <= now() and story.published_at > now() - interval '168 hours');
$$;
revoke all on function public.angle_visible_in_week(public.angles,integer,integer) from public;
grant execute on function public.angle_visible_in_week(public.angles,integer,integer) to anon, authenticated;

create or replace function public.angle_week_feed(board_season integer, board_week integer, board_section text)
returns setof public.angles language sql stable security invoker set search_path = ''
as $$
  select story.* from public.angles story
  where story.section = board_section and public.angle_visible_in_week(story, board_season, board_week);
$$;
revoke all on function public.angle_week_feed(integer,integer,text) from public;
grant execute on function public.angle_week_feed(integer,integer,text) to anon, authenticated;

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
  where board.season = board_season and board.week = board_week
    and not exists(select 1 from public.matchup_reads receipt where receipt.user_id = auth.uid()
      and receipt.season = board.season and receipt.week = board.week and receipt.revision = board.revision
      and receipt.player_id = target.player_id);
$$;

notify pgrst, 'reload schema';
commit;
