begin;
do $$
declare run uuid; candidate jsonb; league text; model text; blocked boolean; lease uuid;
begin
  assert not has_function_privilege('authenticated','public.gamewaire_publish(uuid,text[])','execute');
  assert not has_function_privilege('authenticated','public.gamewaire_publish_lean(uuid)','execute');
  assert has_function_privilege('service_role','public.gamewaire_publish(uuid,text[])','execute');
  foreach league in array array['NFL','NBA','Champions League'] loop
    model:=case when league='Champions League' then 'soccer-probability-v3' else 'probability-only-v14' end;
    lease:=public.gamewaire_analysis_lock(league,'prop-upgrade');
    assert lease is not null;
    insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status,finished_at)
      values(league,'prop-upgrade',now()+interval '1 day','Away @ Home','{}','completed',now()) returning id into run;
    candidate:=jsonb_build_object('key',league||'-prop','sport',league,'eventId','prop-upgrade','start',now()+interval '1 day',
      'market',case when league='Champions League' then 'player_shots' when league='NBA' then 'player_points' else 'player_rush_yds' end,
      'subject','Test Player','side','Over','line',1.5,'american',-201,'probability',0.6,'pushProbability',0,
      'book','Test','modelVersion',model,'updatedAt',now(),'dataAt',now());
    update public.gamewaire_runs set payload=jsonb_build_object('modelVersion',model,'picks',jsonb_build_array(candidate)) where id=run;
    blocked:=false;
    begin
      perform public.gamewaire_publish(run,array[candidate->>'key']);
    exception when others then
      if position('-200' in sqlerrm)=0 then raise; end if;
      blocked:=true;
    end;
    assert blocked,'Shorter-than--200 props were published';
    candidate:=jsonb_set(candidate,'{american}','-200');
    update public.gamewaire_runs set payload=jsonb_build_object('modelVersion',model,'picks',jsonb_build_array(candidate)) where id=run;
    perform public.gamewaire_publish(run,array[candidate->>'key']);
    assert exists(select 1 from public.gamewaire_publications where sport=league and picks=jsonb_build_array(candidate));
    candidate:=jsonb_set(candidate,'{american}','5000');
    update public.gamewaire_runs set payload=jsonb_build_object('modelVersion',model,'picks',jsonb_build_array(candidate)) where id=run;
    perform public.gamewaire_publish(run,array[candidate->>'key']);
    assert exists(select 1 from public.gamewaire_publications where sport=league and picks=jsonb_build_array(candidate));
  end loop;
  assert position('Champions League' in pg_get_functiondef('public.gamewaire_schedule_plan(text,date,jsonb,text,text,text)'::regprocedure))>0;
  assert position('soccer-probability-v3' in pg_get_functiondef('public.gamewaire_soccer_publication_guard()'::regprocedure))>0;
end $$;
rollback;
