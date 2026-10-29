begin;
alter table public.gamewaire_picks add column if not exists is_top_pick boolean not null default true;
alter table public.gamewaire_picks add column if not exists is_game_lean boolean not null default false;

create or replace function public.gamewaire_track_published_lean(lean public.gamewaire_team_leans) returns void
language plpgsql security definer set search_path='' as $$
declare candidate jsonb:=lean.team_lean->'pick'; source_run uuid;
begin
  if candidate is null or jsonb_typeof(candidate)='null' then return; end if;
  if coalesce(candidate->>'market' not in ('h2h','spreads'),true)
    or coalesce(candidate->>'eventId'<>lean.event_id,true)
    then raise exception 'Published lean has no valid team selection'; end if;
  select id into source_run from public.gamewaire_runs
    where sport=lean.sport and event_id=lean.event_id and payload->'teamLean'->'pick'=candidate
    order by created_at desc,id limit 1;
  if source_run is null then raise exception 'Published lean is missing its saved source analysis'; end if;
  insert into public.gamewaire_picks(run_id,fingerprint,sport,event_id,event_start,market,subject,side,line,
    american,probability,push_probability,data,created_at,is_top_pick,is_game_lean)
  values(source_run,concat_ws('|',candidate->>'key',candidate->>'book',candidate->>'american',candidate->>'modelVersion'),
    lean.sport,lean.event_id,lean.event_start,candidate->>'market',candidate->>'subject',candidate->>'side',
    (candidate->>'line')::numeric,(candidate->>'american')::numeric,(candidate->>'probability')::numeric,
    (candidate->>'pushProbability')::numeric,candidate,lean.updated_at,false,true)
  on conflict(fingerprint) do update set is_game_lean=true where not gamewaire_picks.is_game_lean;
end $$;
revoke all on function public.gamewaire_track_published_lean(public.gamewaire_team_leans) from public,anon,authenticated;
grant execute on function public.gamewaire_track_published_lean(public.gamewaire_team_leans) to service_role;

create or replace function public.gamewaire_lean_result_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public.gamewaire_track_published_lean(new);
  return new;
end $$;
revoke all on function public.gamewaire_lean_result_change() from public,anon,authenticated;
drop trigger if exists gamewaire_track_lean_result on public.gamewaire_team_leans;
create trigger gamewaire_track_lean_result after insert or update on public.gamewaire_team_leans
  for each row execute function public.gamewaire_lean_result_change();

create or replace function public.gamewaire_top_pick_result_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.gamewaire_picks tracked set is_top_pick=true
  from jsonb_array_elements(new.picks) candidate
  where tracked.fingerprint=concat_ws('|',candidate->>'key',candidate->>'book',candidate->>'american',candidate->>'modelVersion')
    and not tracked.is_top_pick;
  return new;
end $$;
revoke all on function public.gamewaire_top_pick_result_change() from public,anon,authenticated;
drop trigger if exists gamewaire_track_top_pick_result on public.gamewaire_publications;
create trigger gamewaire_track_top_pick_result after insert or update on public.gamewaire_publications
  for each row execute function public.gamewaire_top_pick_result_change();

do $$
declare lean public.gamewaire_team_leans;
begin
  for lean in select * from public.gamewaire_team_leans loop
    perform public.gamewaire_track_published_lean(lean);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
