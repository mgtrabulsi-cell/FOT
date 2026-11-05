begin;

alter table public.gamewaire_schedule_batches add column if not exists model_version text;

create or replace function public.gamewaire_schedule_plan(
  target_sport text, target_date date, games jsonb, problem text, plan_note text, target_model text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare batch uuid; game jsonb; existing_run uuid;
begin
  if target_sport is null or target_sport not in ('NBA','NFL') or target_date is null
    or target_model is null or target_model !~ '^[a-zA-Z0-9._+-]{1,80}$'
    or games is null or jsonb_typeof(games)<>'array'
    or jsonb_array_length(games)>(case when target_sport='NBA' then 15 else 16 end)
    or (target_sport='NFL' and extract(isodow from target_date)<>4)
    or (problem is not null and jsonb_array_length(games)>0)
    then raise exception 'Invalid model-aware analysis plan'; end if;
  perform pg_advisory_xact_lock(hashtext('gamewaire-scheduled-worker'));
  if exists(select 1 from public.gamewaire_schedule_jobs j
    join public.gamewaire_schedule_batches b on b.id=j.batch_id
    where b.sport=target_sport and b.game_date=target_date and j.status='running')
    then return null; end if;
  insert into public.gamewaire_schedule_batches as batches(sport,game_date,status,note,error,model_version)
    values(target_sport,target_date,case when problem is not null then 'error'
      when jsonb_array_length(games)=0 then 'no_games' else 'ready' end,plan_note,problem,target_model)
    on conflict(sport,game_date) do update set status=excluded.status,note=excluded.note,
      error=excluded.error,model_version=excluded.model_version
      where batches.model_version is distinct from excluded.model_version
    returning id into batch;
  if batch is null then return null; end if;
  for game in select value from jsonb_array_elements(games) loop
    if coalesce(game->>'event_id','') !~ '^[a-zA-Z0-9_-]{1,100}$'
      or game->>'matchup' is null or game->>'selection_note' is null or game->>'event_start' is null
      or (game->>'event_start')::timestamptz<=now()
      or ((game->>'event_start')::timestamptz at time zone 'America/New_York')::date<target_date
      or ((game->>'event_start')::timestamptz at time zone 'America/New_York')::date>target_date+(case when target_sport='NFL' then 6 else 0 end)
      then raise exception 'Invalid scheduled game'; end if;
    select case when payload->>'modelVersion'=target_model
      and status in ('completed','no_qualifying','insufficient_data','stale_odds') then id end
      into existing_run from public.gamewaire_runs
      where sport=target_sport and event_id=game->>'event_id'
        and event_start=(game->>'event_start')::timestamptz and created_at<event_start
      order by created_at desc,id limit 1;
    insert into public.gamewaire_schedule_jobs as jobs(batch_id,sport,event_id,event_start,matchup,selection_note,status,run_id,finished_at)
      values(batch,target_sport,game->>'event_id',(game->>'event_start')::timestamptz,game->>'matchup',game->>'selection_note',
        case when existing_run is null then 'pending' else 'completed' end,existing_run,
        case when existing_run is null then null else now() end)
      on conflict(batch_id,event_id) do update set event_start=excluded.event_start,matchup=excluded.matchup,
        selection_note=excluded.selection_note,status=excluded.status,run_id=excluded.run_id,
        started_at=null,finished_at=excluded.finished_at,error=null,provider_usage=null;
  end loop;
  return batch;
end $$;
revoke all on function public.gamewaire_schedule_plan(text,date,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.gamewaire_schedule_plan(text,date,jsonb,text,text,text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname='gamewire-gamewaire-schedule';
select cron.schedule('gamewire-gamewaire-schedule','* * * * *',$job$
  select net.http_post(
    url:=replace((select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-url'),'/poll-live-games','/gamewaire'),
    headers:=jsonb_build_object('Content-Type','application/json',
      'x-gamewire-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-secret')),
    body:='{"action":"scheduled"}'::jsonb,timeout_milliseconds:=180000
  );
$job$);
notify pgrst,'reload schema';
commit;
