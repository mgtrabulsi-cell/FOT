begin;
do $$
declare league text; date date:=(now() at time zone 'America/New_York')::date+100;
  batch uuid; result uuid; games jsonb; claimed jsonb; count_before integer; run uuid;
begin
  assert not has_function_privilege('authenticated','public.gamewaire_schedule_plan(text,date,jsonb,text,text,text)','execute');
  assert not has_function_privilege('anon','public.gamewaire_schedule_claim()','execute');
  assert has_function_privilege('service_role','public.gamewaire_schedule_claim()','execute');
  select count(*) into count_before from public.gamewaire_publications;
  foreach league in array array['EPL','Serie A','La Liga','Bundesliga'] loop
    insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
      values(league,'daily-private-report',date::timestamptz+interval '18 hours','Test Away @ Test Home',
        '{"markets":["h2h","totals"]}','in_progress') returning id into run;
    perform public.gamewaire_finish(run,'insufficient_data',
      '{"modelVersion":"soccer-evidence-v1","picks":[],"warnings":["No supported markets"]}','[]');
    assert not exists(select 1 from public.gamewaire_publications where event_id='daily-private-report');
    games:=jsonb_build_array(jsonb_build_object('event_id','daily-soccer-test','event_start',date::timestamptz+interval '18 hours',
      'matchup','Test Away @ Test Home','selection_note','Private match result/totals'));
    batch:=public.gamewaire_schedule_plan(league,date,games,null,'Daily private soccer','soccer-evidence-v1');
    assert batch is not null;
    assert exists(select 1 from public.gamewaire_schedule_jobs where batch_id=batch and status='pending');
    result:=public.gamewaire_schedule_plan(league,date,games,null,'Repeated tick','soccer-evidence-v1');
    assert result is null;
    update public.gamewaire_schedule_jobs set status='failed' where batch_id=batch;
    perform public.gamewaire_schedule_plan(league,date,games,null,'No paid retry','soccer-evidence-v1');
    assert exists(select 1 from public.gamewaire_schedule_jobs where batch_id=batch and status='failed');
    begin
      perform public.gamewaire_schedule_plan(league,date+1,games,null,'Wrong day','soccer-evidence-v2');
      raise exception 'Soccer week window accepted';
    exception when raise_exception then if sqlerrm='Soccer week window accepted' then raise; end if; end;
    update public.gamewaire_schedule_jobs set status='pending' where batch_id=batch;
  end loop;
  assert (select count(*) from public.gamewaire_publications)=count_before,'Scheduling never publishes';
  -- Isolate the claim tests without committing any changes to existing queue rows.
  update public.gamewaire_schedule_jobs set status='skipped' where event_id<>'daily-soccer-test';
  insert into public.gamewaire_soccer_schedule_budget(game_date,attempts)
    values((now() at time zone 'America/New_York')::date,39)
    on conflict(game_date) do update set attempts=39;
  update public.gamewaire_schedule_jobs set provider_usage=null;
  claimed:=public.gamewaire_schedule_claim();
  assert claimed->>'sport' in ('EPL','Serie A','La Liga','Bundesliga');
  assert (select attempts from public.gamewaire_soccer_schedule_budget
    where game_date=(now() at time zone 'America/New_York')::date)=40;
  assert public.gamewaire_schedule_claim() is null,'One worker only';
  update public.gamewaire_schedule_jobs set status='failed',finished_at=now() where id=(claimed->>'id')::uuid;
  assert public.gamewaire_schedule_claim() is null;
  assert (select count(*) from public.gamewaire_schedule_jobs where event_id='daily-soccer-test'
    and status='skipped' and error like 'Shared soccer daily budget%')=3;
  perform public.gamewaire_schedule_plan('EPL',date,games,null,'Model catch-up','soccer-evidence-v2');
  assert public.gamewaire_schedule_claim() is null,'Model catch-up must not reset the daily reservation';
  assert (select attempts from public.gamewaire_soccer_schedule_budget
    where game_date=(now() at time zone 'America/New_York')::date)=40;
  update public.gamewaire_soccer_schedule_budget set attempts=0 where game_date=(now() at time zone 'America/New_York')::date;
  update public.gamewaire_schedule_jobs set provider_usage='{"creditsRemaining":1}',finished_at=now()
    where id=(claimed->>'id')::uuid;
  update public.gamewaire_schedule_jobs set status='pending' where event_id='daily-soccer-test' and status='skipped';
  assert public.gamewaire_schedule_claim() is null;
  assert not exists(select 1 from public.gamewaire_schedule_jobs where event_id='daily-soccer-test' and status='pending');
  assert exists(select 1 from public.gamewaire_schedule_jobs where error like 'Last known provider balance%');
end $$;
rollback;
