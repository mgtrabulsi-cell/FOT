begin;

-- Categories follow the market, including historical published records.
create or replace function public.gamewaire_pick_category() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.is_top_pick or new.is_game_lean then
    if new.market in ('h2h','spreads','totals') then
      new.is_top_pick:=false;
      new.is_game_lean:=true;
    elsif new.market like 'player_%' then
      new.is_top_pick:=true;
      new.is_game_lean:=false;
    else
      raise exception 'Published picks must be game markets or player props';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.gamewaire_pick_category() from public,anon,authenticated;
drop trigger if exists gamewaire_enforce_pick_category on public.gamewaire_picks;
create trigger gamewaire_enforce_pick_category before insert or update of market,is_top_pick,is_game_lean
  on public.gamewaire_picks for each row execute function public.gamewaire_pick_category();

update public.gamewaire_picks set
  is_top_pick=(market like 'player_%'),
  is_game_lean=(market in ('h2h','spreads','totals'))
where (is_top_pick or is_game_lean) and (market in ('h2h','spreads','totals') or market like 'player_%');

create or replace function public.gamewaire_top_pick_result_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.gamewaire_picks tracked
    set is_top_pick=(tracked.market like 'player_%'),
      is_game_lean=(tracked.market in ('h2h','spreads','totals'))
  from jsonb_array_elements(new.picks) candidate
  where tracked.fingerprint=concat_ws('|',candidate->>'key',candidate->>'book',candidate->>'american',candidate->>'modelVersion')
    and (tracked.is_top_pick is distinct from (tracked.market like 'player_%')
      or tracked.is_game_lean is distinct from (tracked.market in ('h2h','spreads','totals')));
  return new;
end $$;

create or replace function public.gamewaire_publish_lean(target_run uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved public.gamewaire_runs; lean jsonb; candidate jsonb;
begin
  select * into saved from public.gamewaire_runs where id=target_run for update;
  if not found or saved.sport not in ('NBA','NFL') or saved.status not in ('completed','no_qualifying')
    or saved.event_start<=now() or saved.finished_at is null or saved.finished_at>=saved.event_start
    then raise exception 'Choose a finished pregame NBA or NFL analysis for an upcoming game'; end if;
  lean:=saved.payload->'teamLean';
  candidate:=lean->'pick';
  if coalesce(candidate->>'market' not in ('h2h','spreads'),true)
    or coalesce(candidate->>'eventId'<>saved.event_id,true)
    then raise exception 'No verified moneyline/spread lean in this report'; end if;
  -- Publish the original verified snapshot, not a newly invented current price.
  if coalesce((candidate->>'updatedAt')::timestamptz>=saved.event_start,true)
    or coalesce((candidate->>'dataAt')::timestamptz>=saved.event_start,true)
    or (candidate->>'updatedAt')::timestamptz>least(now(),saved.finished_at)+interval '1 minute'
    or (candidate->>'dataAt')::timestamptz>least(now(),saved.finished_at)+interval '1 minute'
    then raise exception 'Saved lean requires valid pregame odds and data timestamps'; end if;
  if exists(select 1 from public.gamewaire_picks
    where fingerprint=concat_ws('|',candidate->>'key',candidate->>'book',candidate->>'american',candidate->>'modelVersion')
      and (withdrawn or result<>'pending'))
    then raise exception 'A withdrawn or settled selection cannot be published again'; end if;
  insert into public.gamewaire_team_leans(sport,event_id,event_start,matchup,team_lean)
    values(saved.sport,saved.event_id,saved.event_start,saved.matchup,lean)
  on conflict(sport,event_id) do update set event_start=excluded.event_start,matchup=excluded.matchup,
    team_lean=excluded.team_lean,updated_at=now();
end $$;
revoke all on function public.gamewaire_publish_lean(uuid) from public,anon,authenticated;
grant execute on function public.gamewaire_publish_lean(uuid) to service_role;

create or replace function public.gamewaire_delete_lean(target_pick uuid, expected_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare tracked public.gamewaire_picks; remaining jsonb;
begin
  select * into tracked from public.gamewaire_picks where id=target_pick;
  if not found then raise exception 'Game lean not found'; end if;
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
  perform 1 from public.gamewaire_publications
    where sport=tracked.sport and event_id=tracked.event_id for update;
  select jsonb_agg(candidate order by position) into remaining
    from public.gamewaire_publications publication,
      jsonb_array_elements(publication.picks) with ordinality as items(candidate,position)
    where publication.sport=tracked.sport and publication.event_id=tracked.event_id
      and concat_ws('|',candidate->>'key',candidate->>'book',candidate->>'american',candidate->>'modelVersion')<>tracked.fingerprint;
  if remaining is null then
    delete from public.gamewaire_publications where sport=tracked.sport and event_id=tracked.event_id;
  else
    update public.gamewaire_publications set picks=remaining where sport=tracked.sport and event_id=tracked.event_id;
  end if;
  update public.gamewaire_picks set is_game_lean=false,is_top_pick=false,revision=revision+1 where id=target_pick;
end $$;
revoke all on function public.gamewaire_delete_lean(uuid,integer) from public,anon,authenticated;
grant execute on function public.gamewaire_delete_lean(uuid,integer) to service_role;

notify pgrst,'reload schema';
commit;
