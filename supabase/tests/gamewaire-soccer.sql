begin;
do $$
declare run uuid; candidate jsonb; league text; lease uuid;
begin
  assert not has_function_privilege('authenticated','public.gamewaire_publish(uuid,text[])','EXECUTE');
  assert not has_function_privilege('authenticated','public.gamewaire_publish_lean(uuid)','EXECUTE');
  assert has_function_privilege('service_role','public.gamewaire_publish_lean(uuid)','EXECUTE');
  foreach league in array array['EPL','Serie A','La Liga','Bundesliga'] loop
    lease:=public.gamewaire_analysis_lock(league,'soccer-regression');
    assert lease is not null;
    assert public.gamewaire_analysis_lock(league,'soccer-regression') is null;
    insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status,finished_at)
      values(league,'soccer-regression',now()+interval '1 day','Away @ Home','{}','completed',now()) returning id into run;
    candidate:=jsonb_build_object('key',league||'-draw','sport',league,'eventId','soccer-regression','start',now()+interval '1 day',
      'market','h2h','subject','Draw','side','Draw','line',null,'american',300,'probability',0.3,'pushProbability',0,
      'book','Test','modelVersion','soccer-evidence-v1','updatedAt',now(),'dataAt',now());
    update public.gamewaire_runs set payload=jsonb_build_object('modelVersion','soccer-evidence-v1','picks',jsonb_build_array(candidate),
      'teamLean',jsonb_build_object('pick',candidate,'qualifies',false,'reason','Experimental')) where id=run;
    assert not exists(select 1 from public.gamewaire_publications where sport=league),'Analysis alone must stay private';
    perform public.gamewaire_publish_lean(run);
    assert exists(select 1 from public.gamewaire_picks where run_id=run and side='Draw' and push_probability=0 and is_game_lean);
    perform public.gamewaire_publish(run,array[candidate->>'key']);
    assert exists(select 1 from public.gamewaire_publications where sport=league and picks=jsonb_build_array(candidate));
    begin
      update public.gamewaire_picks set result='push' where run_id=run;
      raise exception 'Three-way draw settlement pushed';
    exception when check_violation then null; end;
    update public.gamewaire_picks set result='loss',revision=revision+1 where run_id=run;
    assert exists(select 1 from public.gamewaire_pick_changes change join public.gamewaire_picks pick on pick.id=change.pick_id where pick.run_id=run);
    begin
      perform public.gamewaire_publish_lean(run);
      raise exception 'Settled soccer republished';
    exception when raise_exception then if sqlerrm='Settled soccer republished' then raise; end if; end;
    update public.gamewaire_picks set result='pending' where run_id=run;
    candidate:=jsonb_set(candidate,'{pushProbability}','0.1');
    update public.gamewaire_runs set payload=jsonb_build_object('modelVersion','soccer-evidence-v1','picks',jsonb_build_array(candidate),
      'teamLean',jsonb_build_object('pick',candidate)) where id=run;
    begin
      perform public.gamewaire_publish_lean(run);
      raise exception 'Draw push accepted';
    exception when raise_exception then if sqlerrm='Draw push accepted' then raise; end if; end;
    candidate:=jsonb_set(jsonb_set(candidate,'{pushProbability}','0'),'{modelVersion}','"evidence-value-v10"');
    update public.gamewaire_runs set payload=jsonb_build_object('modelVersion','evidence-value-v10','teamLean',jsonb_build_object('pick',candidate)) where id=run;
    begin
      perform public.gamewaire_publish_lean(run);
      raise exception 'Wrong soccer model accepted';
    exception when raise_exception then if sqlerrm='Wrong soccer model accepted' then raise; end if; end;
    begin
      insert into public.gamewaire_schedule_batches(sport,game_date,status,note) values(league,current_date,'ready','Forbidden');
      raise exception 'Soccer schedule accepted';
    exception when check_violation then null; end;
  end loop;
end $$;
rollback;
