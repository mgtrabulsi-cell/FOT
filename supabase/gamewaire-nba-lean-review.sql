begin;

create or replace function public.gamewaire_schedule_plan(target_sport text, target_date date, games jsonb, problem text, plan_note text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare batch uuid; game jsonb;
begin
  if target_sport is null or target_sport not in ('NBA','NFL') or target_date is null or games is null or jsonb_typeof(games) <> 'array'
    or jsonb_array_length(games) > (case when target_sport='NBA' then 15 else 16 end)
    or (problem is not null and jsonb_array_length(games)>0)
    or (target_sport='NFL' and extract(isodow from target_date)<>4)
    then raise exception 'Invalid scheduled analysis plan'; end if;
  insert into public.gamewaire_schedule_batches(sport,game_date,status,note,error)
    values(target_sport,target_date,case when problem is not null then 'error' when jsonb_array_length(games)=0 then 'no_games' else 'ready' end,plan_note,problem)
    on conflict(sport,game_date) do nothing returning id into batch;
  if batch is null then return null; end if;
  for game in select value from jsonb_array_elements(games) loop
    if coalesce(game->>'event_id','') !~ '^[a-zA-Z0-9_-]{1,100}$'
      or game->>'matchup' is null or game->>'selection_note' is null or game->>'event_start' is null
      or (game->>'event_start')::timestamptz <= now()
      or ((game->>'event_start')::timestamptz at time zone 'America/New_York')::date not between target_date
        and target_date + (case when target_sport='NFL' then 4 else 0 end)
      then raise exception 'Invalid scheduled game'; end if;
    insert into public.gamewaire_schedule_jobs(batch_id,sport,event_id,event_start,matchup,selection_note)
      values(batch,target_sport,game->>'event_id',(game->>'event_start')::timestamptz,game->>'matchup',game->>'selection_note');
  end loop;
  return batch;
end $$;

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
  -- NBA reports stay private until an explicit publication, including manual refreshes.
  if saved.sport='NBA' then return; end if;
  insert into public.gamewaire_team_leans(sport,event_id,event_start,matchup,team_lean)
    values(saved.sport,saved.event_id,saved.event_start,saved.matchup,nullif(report->'teamLean','null'::jsonb))
  on conflict(sport,event_id) do update set event_start=excluded.event_start,matchup=excluded.matchup,
    team_lean=excluded.team_lean,updated_at=now();
end $$;

create or replace function public.gamewaire_publish_lean(target_run uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved public.gamewaire_runs; lean jsonb; candidate jsonb;
begin
  select * into saved from public.gamewaire_runs where id=target_run for update;
  if not found or saved.sport<>'NBA' or saved.status not in ('completed','no_qualifying') or saved.event_start<=now()
    then raise exception 'Choose a finished NBA analysis for an upcoming game'; end if;
  lean:=saved.payload->'teamLean';
  candidate:=lean->'pick';
  if coalesce(candidate->>'market' not in ('h2h','spreads'),true)
    or coalesce(candidate->>'eventId'<>saved.event_id,true)
    then raise exception 'No verified moneyline/spread lean in this report'; end if;
  if coalesce((candidate->>'updatedAt')::timestamptz < now()-interval '10 minutes',true)
    or (candidate->>'updatedAt')::timestamptz > now()+interval '1 minute'
    or coalesce((candidate->>'dataAt')::timestamptz < now()-interval '1 hour',true)
    then raise exception 'Saved lean prices or data are stale. Refresh the game lean, then review before publishing'; end if;
  insert into public.gamewaire_team_leans(sport,event_id,event_start,matchup,team_lean)
    values(saved.sport,saved.event_id,saved.event_start,saved.matchup,lean)
  on conflict(sport,event_id) do update set event_start=excluded.event_start,matchup=excluded.matchup,
    team_lean=excluded.team_lean,updated_at=now();
end $$;
revoke all on function public.gamewaire_publish_lean(uuid) from public,anon,authenticated;
grant execute on function public.gamewaire_publish_lean(uuid) to service_role;

notify pgrst,'reload schema';
commit;
