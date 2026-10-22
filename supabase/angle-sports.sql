-- Allow general NFL/Fantasy posts and non-NFL storylines alongside specific NFL games.
begin;
alter table public.angles drop constraint if exists angles_game_id_check;
alter table public.angles add constraint angles_game_id_check
  check (game_id ~ '^(NFL:[0-9]{1,15}|(FANTASY|NBA|NHL|UCL|SOCCER):0)$');
commit;
