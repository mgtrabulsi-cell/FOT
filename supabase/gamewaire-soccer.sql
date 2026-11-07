begin;

-- Only manual analysis/storage tables expand. Scheduled batches and jobs remain NFL/NBA.
alter table public.gamewaire_runs drop constraint if exists gamewaire_runs_sport_check;
alter table public.gamewaire_runs add constraint gamewaire_runs_sport_check check (sport in ('NFL','NBA','EPL','Serie A','La Liga','Bundesliga'));
alter table public.gamewaire_picks drop constraint if exists gamewaire_picks_sport_check;
alter table public.gamewaire_picks add constraint gamewaire_picks_sport_check check (sport in ('NFL','NBA','EPL','Serie A','La Liga','Bundesliga'));
alter table public.gamewaire_picks drop constraint if exists gamewaire_soccer_three_way_settlement;
alter table public.gamewaire_picks add constraint gamewaire_soccer_three_way_settlement check (
  sport not in ('EPL','Serie A','La Liga','Bundesliga') or market<>'h2h' or (push_probability=0 and result<>'push'));
alter table public.gamewaire_publications drop constraint if exists gamewaire_publications_sport_check;
alter table public.gamewaire_publications add constraint gamewaire_publications_sport_check check (sport in ('NFL','NBA','EPL','Serie A','La Liga','Bundesliga'));
alter table public.gamewaire_team_leans drop constraint if exists gamewaire_team_leans_sport_check;
alter table public.gamewaire_team_leans add constraint gamewaire_team_leans_sport_check check (sport in ('NFL','NBA','EPL','Serie A','La Liga','Bundesliga'));
alter table public.gamewaire_analysis_locks drop constraint if exists gamewaire_analysis_locks_sport_check;
alter table public.gamewaire_analysis_locks add constraint gamewaire_analysis_locks_sport_check check (sport in ('NFL','NBA','EPL','Serie A','La Liga','Bundesliga'));

-- Preserve the effective saved-snapshot, withdrawn/settled and archive behavior verbatim.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.gamewaire_publish_lean(uuid)'::regprocedure);
  if position('saved.sport not in (''NBA'',''NFL'')' in definition)>0 then
    definition:=replace(definition,'saved.sport not in (''NBA'',''NFL'')',
      'saved.sport not in (''NBA'',''NFL'',''EPL'',''Serie A'',''La Liga'',''Bundesliga'')');
    definition:=replace(definition,'NBA or NFL analysis','supported league analysis');
    execute definition;
  elsif position('''Bundesliga''' in definition)=0 then
    raise exception 'Apply the saved-lean publication migration before soccer';
  end if;
end $$;
revoke all on function public.gamewaire_publish_lean(uuid) from public,anon,authenticated;
grant execute on function public.gamewaire_publish_lean(uuid) to service_role;

create or replace function public.gamewaire_soccer_publication_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare candidate jsonb; candidates jsonb; source public.gamewaire_runs;
begin
  if new.sport not in ('EPL','Serie A','La Liga','Bundesliga') then return new; end if;
  if tg_table_name='gamewaire_team_leans' then
    candidates:=jsonb_build_array(new.team_lean->'pick');
  else
    candidates:=new.picks;
    -- Removing archived selections is not a new publication.
    if tg_op='UPDATE' and old.sport=new.sport and old.event_id=new.event_id
      and old.picks @> new.picks then return new; end if;
  end if;
  for candidate in select value from jsonb_array_elements(candidates) loop
    select * into source from public.gamewaire_runs
      where sport=new.sport and event_id=new.event_id
        and payload->>'modelVersion'='soccer-evidence-v1'
        and (payload->'picks' @> jsonb_build_array(candidate) or payload->'teamLean'->'pick'=candidate)
        and status in ('completed','no_qualifying') and finished_at is not null
      order by created_at desc limit 1;
    if not found or source.event_start<>new.event_start
      or source.event_start<=now() or source.finished_at>=source.event_start
      or coalesce(candidate->>'modelVersion','')<>'soccer-evidence-v1'
      or coalesce(candidate->>'sport','')<>new.sport
      or coalesce(candidate->>'eventId','')<>new.event_id
      or coalesce(candidate->>'market','') not in ('h2h','totals','player_shots','player_shots_on_target','player_assists')
      or coalesce((candidate->>'updatedAt')::timestamptz>=source.event_start,true)
      or coalesce((candidate->>'dataAt')::timestamptz>=source.event_start,true)
      or (candidate->>'updatedAt')::timestamptz>source.finished_at+interval '1 minute'
      or (candidate->>'dataAt')::timestamptz>source.finished_at+interval '1 minute'
      or (candidate->>'market'='h2h' and coalesce((candidate->>'pushProbability')::numeric,1)<>0)
      then raise exception 'Soccer publication requires a reviewed current-model regulation-time saved candidate'; end if;
  end loop;
  return new;
end $$;
revoke all on function public.gamewaire_soccer_publication_guard() from public,anon,authenticated;
drop trigger if exists gamewaire_soccer_publication_guard on public.gamewaire_publications;
create trigger gamewaire_soccer_publication_guard before insert or update on public.gamewaire_publications
for each row execute function public.gamewaire_soccer_publication_guard();
drop trigger if exists gamewaire_soccer_lean_guard on public.gamewaire_team_leans;
create trigger gamewaire_soccer_lean_guard before insert or update on public.gamewaire_team_leans
for each row execute function public.gamewaire_soccer_publication_guard();
notify pgrst,'reload schema';
commit;
