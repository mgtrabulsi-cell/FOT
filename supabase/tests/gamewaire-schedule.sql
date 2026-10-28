begin;
do $$
declare day date := (now() at time zone 'America/New_York')::date + 1; batch uuid; job jsonb; games jsonb; total integer; lease uuid;
begin
  delete from public.gamewaire_analysis_locks where sport='NBA' and event_id='schedule-test';
  lease := public.gamewaire_analysis_lock('NBA','schedule-test');
  if lease is null or public.gamewaire_analysis_lock('NBA','schedule-test') is not null
    then raise exception 'Only one caller may refresh a game at a time'; end if;
  update public.gamewaire_analysis_locks set claimed_at=now()-interval '4 minutes' where token=lease;
  if public.gamewaire_analysis_lock('NBA','schedule-test') is null then raise exception 'Interrupted locks must expire'; end if;
  delete from public.gamewaire_analysis_locks where token=lease;
  if not exists(select 1 from public.gamewaire_analysis_locks where event_id='schedule-test')
    then raise exception 'Old worker must not release a newer lease'; end if;
  -- All fixtures roll back, including modifications to pre-existing queue state.
  update public.gamewaire_schedule_jobs set status='completed' where status in ('pending','running');
  delete from public.gamewaire_schedule_jobs where batch_id in (
    select id from public.gamewaire_schedule_batches where sport='NBA' and game_date=day);
  delete from public.gamewaire_schedule_batches where sport='NBA' and game_date=day;
  games := jsonb_build_array(jsonb_build_object('event_id','schedule-test','event_start',
    (day::timestamp+interval '20 hours') at time zone 'America/New_York','matchup','Away @ Home','selection_note','Test ranking'));
  batch := public.gamewaire_schedule_plan('NBA',day,games,null,'Test daily game leans');
  if batch is null then raise exception 'Plan must create a batch'; end if;
  if public.gamewaire_schedule_plan('NBA',day,games,null,'Duplicate') is not null then raise exception 'Duplicate plan must be ignored'; end if;
  select count(*) into total from public.gamewaire_schedule_jobs where batch_id=batch;
  if total<>1 then raise exception 'Only one job per game per batch'; end if;
  job := public.gamewaire_schedule_claim();
  if job->>'event_id'<>'schedule-test' or job->>'status'<>'running' then raise exception 'Claim must start one game'; end if;
  if public.gamewaire_schedule_claim() is not null then raise exception 'Concurrent workers must not claim twice'; end if;
  update public.gamewaire_schedule_jobs set started_at=now()-interval '6 minutes' where id=(job->>'id')::uuid;
  if public.gamewaire_schedule_claim() is not null then raise exception 'Timed-out jobs must not retry automatically'; end if;
  if not exists(select 1 from public.gamewaire_schedule_jobs where id=(job->>'id')::uuid and status='failed')
    then raise exception 'Interrupted job must remain visibly failed'; end if;
  begin
    perform public.gamewaire_schedule_plan('NBA',day+1,games||games||games||games||games||games||games||games||games||games||games||games||games||games||games||games,null,'Too many');
    raise exception 'NBA schedule must cap at fifteen';
  exception when raise_exception then
    if sqlerrm='NBA schedule must cap at fifteen' then raise; end if;
  end;
  if exists(select 1 from public.gamewaire_publications where event_id='schedule-test')
    or exists(select 1 from public.gamewaire_picks where event_id='schedule-test')
    then raise exception 'Scheduling must not publish or create performance picks'; end if;
end $$;
set local role authenticated;
do $$
begin
  if exists(select 1 from public.gamewaire_schedule_jobs) or exists(select 1 from public.gamewaire_schedule_batches)
    then raise exception 'Ordinary members must not see scheduled candidates'; end if;
  begin
    perform public.gamewaire_schedule_claim();
    raise exception 'Clients must not invoke the worker claim';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.gamewaire_schedule_jobs;
    raise exception 'Anonymous schedule access must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
