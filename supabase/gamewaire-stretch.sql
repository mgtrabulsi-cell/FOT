begin;
create table if not exists public.gamewaire_stretch_picks (
  run_id uuid not null references public.gamewaire_runs(id) on delete cascade,
  pick_key text not null,
  primary key (run_id,pick_key)
);
alter table public.gamewaire_stretch_picks enable row level security;
revoke all on public.gamewaire_stretch_picks from public,anon,authenticated;
grant select on public.gamewaire_stretch_picks to authenticated;
grant all on public.gamewaire_stretch_picks to service_role;
drop policy if exists "Designated account reads Stretch labels" on public.gamewaire_stretch_picks;
create policy "Designated account reads Stretch labels" on public.gamewaire_stretch_picks
  for select to authenticated using(public.gamewaire_can_admin());

create or replace function public.gamewaire_finish(target_run uuid, final_status text, report jsonb, candidates jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare saved public.gamewaire_runs; stretch_key text;
begin
  update public.gamewaire_runs set status = final_status, payload = report, finished_at = now()
  where id = target_run and status = 'in_progress' returning * into saved;
  if not found then raise exception 'Analysis is no longer in progress'; end if;
  if report->'teamLean' is not null and jsonb_typeof(report->'teamLean') <> 'null'
    and (coalesce(report->'teamLean'->'pick'->>'market' not in ('h2h','spreads'), true)
      or coalesce((report->'teamLean'->'pick'->>'eventId') <> saved.event_id, true))
    then raise exception 'Invalid team lean for this game'; end if;
  for stretch_key in select jsonb_array_elements_text(coalesce(report->'stretchKeys','[]'::jsonb)) loop
    if not exists(select 1 from jsonb_array_elements(report->'picks') pick
      where pick->>'key'=stretch_key and pick->>'market' like 'player_%')
      then raise exception 'Stretch labels must refer to saved player candidates'; end if;
    insert into public.gamewaire_stretch_picks(run_id,pick_key) values(target_run,stretch_key);
  end loop;
end $$;
revoke all on function public.gamewaire_finish(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.gamewaire_finish(uuid,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
