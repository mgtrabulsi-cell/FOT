begin;
alter table public.angles drop constraint if exists angles_game_id_check;
alter table public.angles add constraint angles_game_id_check
  check (game_id ~ '^(NFL:[0-9]{1,15}|(FANTASY|NBA|NHL|UCL|SOCCER|COMBO):0)$');

create or replace function public.angle_visible_in_week(story public.angles, board_season integer, board_week integer)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select (story.season = board_season and story.week = board_week)
    or (story.section = 'angle' and story.status = 'published'
      and split_part(story.game_id, ':', 1) in ('NBA','NHL','UCL','SOCCER','COMBO')
      and story.published_at <= now() and story.published_at > now() - interval '168 hours');
$$;
revoke all on function public.angle_visible_in_week(public.angles,integer,integer) from public;
grant execute on function public.angle_visible_in_week(public.angles,integer,integer) to anon, authenticated;
notify pgrst,'reload schema';
commit;
