begin;
do $$
declare day date := (now() at time zone 'America/New_York')::date + 60;
  batch uuid; games jsonb; oldjob uuid;
begin
  while extract(isodow from day)<>4 loop day:=day+1; end loop;
  insert into public.gamewaire_schedule_batches(sport,game_date,status,note)
    values('NFL',day,'ready','Old daily plan') returning id into batch;
  insert into public.gamewaire_schedule_jobs(batch_id,sport,event_id,event_start,matchup,selection_note,status)
    values(batch,'NFL','weekly-test-0',(day::timestamp+interval '20 hours') at time zone 'America/New_York','Away @ Home','Old daily plan','completed')
    returning id into oldjob;
  select jsonb_agg(jsonb_build_object('event_id','weekly-test-'||n,'event_start',
    ((day+n)::timestamp+interval '20 hours') at time zone 'America/New_York','matchup','Away @ Home','selection_note','Weekly plan'))
    into games from unnest(array[0,3,6]) n;
  assert public.gamewaire_schedule_plan('NFL',day,games,null,'Weekly plan')=batch;
  assert (select count(*) from public.gamewaire_schedule_jobs where batch_id=batch)=3;
  assert (select status from public.gamewaire_schedule_jobs where id=oldjob)='completed',
    'Extending a daily batch must not rerun existing jobs';
  assert public.gamewaire_schedule_plan('NFL',day,games,null,'Weekly plan') is null;
  begin
    perform public.gamewaire_schedule_plan('NFL',day+7,jsonb_build_array(games->0),null,'Out of window');
    raise exception 'Out of window accepted';
  exception when raise_exception then if sqlerrm='Out of window accepted' then raise; end if;
  end;
  begin
    perform public.gamewaire_schedule_plan('NFL',day+1,'[]',null,'Friday');
    raise exception 'Friday accepted';
  exception when raise_exception then if sqlerrm='Friday accepted' then raise; end if;
  end;
  begin
    perform public.gamewaire_schedule_plan('NBA',day,games,null,'Cross-day NBA');
    raise exception 'Cross-day NBA accepted';
  exception when raise_exception then if sqlerrm='Cross-day NBA accepted' then raise; end if;
  end;
end $$;
do $$
declare run uuid; candidate jsonb; report jsonb;
begin
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values('NFL','weekly-stretch-test',now()+interval '1 day','Away @ Home','{}','in_progress') returning id into run;
  candidate:=jsonb_build_object('key','weekly-team-stretch','sport','NFL','eventId','weekly-stretch-test',
    'market','h2h','subject','Home','side','Home','american',-110,'probability',0.5,'pushProbability',0,
    'modelVersion','empirical-baseline-v6','book','Test','updatedAt',now(),'dataAt',now());
  report:=jsonb_build_object('picks',jsonb_build_array(candidate),'stretchKeys',jsonb_build_array(candidate->>'key'),
    'teamLean',jsonb_build_object('pick',candidate,'qualifies',false));
  perform public.gamewaire_finish(run,'completed',report,jsonb_build_array(candidate));
  assert exists(select 1 from public.gamewaire_stretch_picks where run_id=run and pick_key=candidate->>'key');
  perform public.gamewaire_publish(run,array[candidate->>'key']);
  assert exists(select 1 from public.gamewaire_publications where run_id=run);
  assert not exists(select 1 from public.gamewaire_publications where run_id=run and picks::text like '%stretchKeys%');
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values('NFL','weekly-stretch-test-invalid',now()+interval '1 day','Away @ Home','{}','in_progress') returning id into run;
  begin
    perform public.gamewaire_finish(run,'completed',report,jsonb_build_array(candidate));
    raise exception 'Wrong-event Stretch accepted';
  exception when raise_exception then if sqlerrm='Wrong-event Stretch accepted' then raise; end if;
  end;
end $$;
rollback;
