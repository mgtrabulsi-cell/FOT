begin;
create or replace function public.gamewaire_schedule_plan(target_sport text, target_date date, games jsonb, problem text, plan_note text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare batch uuid; game jsonb;
begin
  if target_sport is null or target_sport not in ('NBA','NFL') or target_date is null or games is null or jsonb_typeof(games) <> 'array'
    or jsonb_array_length(games) > (case when target_sport='NBA' then 15 else 16 end)
    or (target_sport='NFL' and extract(isodow from target_date)<>4)
    or (problem is not null and jsonb_array_length(games)>0)
    then raise exception 'Invalid scheduled analysis plan'; end if;
  insert into public.gamewaire_schedule_batches as batches(sport,game_date,status,note,error)
    values(target_sport,target_date,case when problem is not null then 'error' when jsonb_array_length(games)=0 then 'no_games' else 'ready' end,plan_note,problem)
    on conflict(sport,game_date) do update set status=excluded.status,note=excluded.note,error=excluded.error
      where target_sport='NFL' and batches.note<>excluded.note
    returning id into batch;
  if batch is null then return null; end if;
  for game in select value from jsonb_array_elements(games) loop
    if coalesce(game->>'event_id','') !~ '^[a-zA-Z0-9_-]{1,100}$'
      or game->>'matchup' is null or game->>'selection_note' is null or game->>'event_start' is null
      or (game->>'event_start')::timestamptz <= now()
      or ((game->>'event_start')::timestamptz at time zone 'America/New_York')::date < target_date
      or ((game->>'event_start')::timestamptz at time zone 'America/New_York')::date > target_date+(case when target_sport='NFL' then 6 else 0 end)
      then raise exception 'Invalid scheduled game'; end if;
    insert into public.gamewaire_schedule_jobs(batch_id,sport,event_id,event_start,matchup,selection_note)
      values(batch,target_sport,game->>'event_id',(game->>'event_start')::timestamptz,game->>'matchup',game->>'selection_note')
      on conflict(batch_id,event_id) do nothing;
  end loop;
  return batch;
end $$;
create or replace function public.gamewaire_finish(target_run uuid, final_status text, report jsonb, candidates jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare saved public.gamewaire_runs; stretch_key text;
begin
  update public.gamewaire_runs set status=final_status,payload=report,finished_at=now()
    where id=target_run and status='in_progress' returning * into saved;
  if not found then raise exception 'Analysis is no longer in progress'; end if;
  if report->'teamLean' is not null and jsonb_typeof(report->'teamLean')<>'null'
    and (coalesce(report->'teamLean'->'pick'->>'market' not in ('h2h','spreads'),true)
      or coalesce(report->'teamLean'->'pick'->>'eventId'<>saved.event_id,true))
    then raise exception 'Invalid team lean for this game'; end if;
  for stretch_key in select jsonb_array_elements_text(coalesce(report->'stretchKeys','[]'::jsonb)) loop
    if not exists(select 1 from jsonb_array_elements(report->'picks') pick
      where pick->>'key'=stretch_key and pick->>'eventId'=saved.event_id
        and (pick->>'market' like 'player_%' or pick=report->'teamLean'->'pick'))
      then raise exception 'Stretch labels must refer to saved player candidates or this game lean'; end if;
    insert into public.gamewaire_stretch_picks(run_id,pick_key) values(target_run,stretch_key);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
