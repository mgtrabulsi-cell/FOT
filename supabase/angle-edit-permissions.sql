begin;
-- The editor sends post_to_x even when it is false; retain the existing admin-only RLS.
grant update (post_to_x) on public.angles to authenticated;
notify pgrst, 'reload schema';
commit;
