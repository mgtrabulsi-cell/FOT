begin;
alter table public.angles drop constraint if exists angles_game_id_check;
alter table public.angles add constraint angles_game_id_check
  check (game_id ~ '^(NFL:[0-9]{1,15}|(NEWS|FANTASY|NBA|NHL|UCL|SOCCER|CFB|UFC|COMBO):0)$');
notify pgrst,'reload schema';
commit;
