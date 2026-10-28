begin;
create table if not exists public.gamewaire_team_leans (
  sport text not null check (sport in ('NBA','NFL')),
  event_id text not null,
  event_start timestamptz not null,
  matchup text not null,
  team_lean jsonb,
  updated_at timestamptz not null default now(),
  primary key (sport,event_id)
);
alter table public.gamewaire_team_leans enable row level security;
revoke all on public.gamewaire_team_leans from anon, authenticated;
grant select on public.gamewaire_team_leans to authenticated;
grant all on public.gamewaire_team_leans to service_role;
drop policy if exists "Members read game team leans" on public.gamewaire_team_leans;
create policy "Members read game team leans" on public.gamewaire_team_leans for select to authenticated using (true);

create or replace function public.gamewaire_finish(target_run uuid, final_status text, report jsonb, candidates jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare saved public.gamewaire_runs;
begin
  update public.gamewaire_runs set status = final_status, payload = report, finished_at = now()
  where id = target_run and status = 'in_progress' returning * into saved;
  if not found then raise exception 'Analysis is no longer in progress'; end if;
  if report->'teamLean' is not null and jsonb_typeof(report->'teamLean') <> 'null'
    and (coalesce(report->'teamLean'->'pick'->>'market' not in ('h2h','spreads'), true)
      or coalesce((report->'teamLean'->'pick'->>'eventId') <> saved.event_id, true))
    then raise exception 'Invalid team lean for this game'; end if;
  insert into public.gamewaire_team_leans(sport,event_id,event_start,matchup,team_lean)
    values(saved.sport,saved.event_id,saved.event_start,saved.matchup,nullif(report->'teamLean','null'::jsonb))
  on conflict(sport,event_id) do update set event_start=excluded.event_start,matchup=excluded.matchup,
    team_lean=excluded.team_lean,updated_at=now();
end $$;
revoke all on function public.gamewaire_finish(uuid,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.gamewaire_finish(uuid,text,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
