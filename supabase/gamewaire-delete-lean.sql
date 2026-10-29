begin;
drop policy if exists "Members read GamewAIre picks" on public.gamewaire_picks;
create policy "Members read GamewAIre picks" on public.gamewaire_picks
  for select to authenticated using (is_top_pick or is_game_lean);
create or replace function public.gamewaire_delete_lean(target_pick uuid, expected_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare tracked public.gamewaire_picks;
begin
  select * into tracked from public.gamewaire_picks where id=target_pick;
  if not found then raise exception 'Game lean not found'; end if;
  -- Match publication's lock order before changing its result membership.
  perform 1 from public.gamewaire_team_leans
    where sport=tracked.sport and event_id=tracked.event_id for update;
  select * into tracked from public.gamewaire_picks where id=target_pick for update;
  if not found or not tracked.is_game_lean then raise exception 'Game lean is no longer published'; end if;
  if expected_revision is null or tracked.revision<>expected_revision then
    raise exception 'This pick changed. Refresh before deleting';
  end if;
  delete from public.gamewaire_team_leans
    where sport=tracked.sport and event_id=tracked.event_id
      and concat_ws('|',team_lean->'pick'->>'key',team_lean->'pick'->>'book',
        team_lean->'pick'->>'american',team_lean->'pick'->>'modelVersion')=tracked.fingerprint;
  -- Retain the audited snapshot; shared Top Picks keep their outcome and membership.
  update public.gamewaire_picks set is_game_lean=false,revision=revision+1 where id=target_pick;
end $$;
revoke all on function public.gamewaire_delete_lean(uuid,integer) from public,anon,authenticated;
grant execute on function public.gamewaire_delete_lean(uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
