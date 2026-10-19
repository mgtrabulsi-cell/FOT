-- Allow Angle storylines for NBA, NHL, UCL, and other soccer picks alongside NFL games.
alter table public.angles drop constraint if exists angles_game_id_check;
alter table public.angles add constraint angles_game_id_check
  check (game_id ~ '^(NFL:[0-9]{1,15}|(NBA|NHL|UCL|SOCCER):0)$');
