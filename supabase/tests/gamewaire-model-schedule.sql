begin;
do $$
declare date date:=current_date+100; batch uuid; result uuid; games jsonb; jobs integer;
begin
  if has_function_privilege('authenticated','public.gamewaire_schedule_plan(text,date,jsonb,text,text,text)','execute')
    or has_function_privilege('anon','public.gamewaire_schedule_plan(text,date,jsonb,text,text,text)','execute')
    then raise exception 'Only the service role may schedule paid analyses'; end if;
  games:=jsonb_build_array(jsonb_build_object('event_id','test-model-catchup','event_start',date::timestamptz+interval '18 hours',
    'matchup','Test Away @ Test Home','selection_note','Model catch-up test'));
  insert into public.gamewaire_schedule_batches(sport,game_date,status,note,model_version)
    values('NBA',date,'ready','Old model','test-v8') returning id into batch;
  insert into public.gamewaire_schedule_jobs(batch_id,sport,event_id,event_start,matchup,selection_note,status)
    values(batch,'NBA','test-model-catchup',date::timestamptz+interval '18 hours','Test Away @ Test Home','Old model','completed');
  result:=public.gamewaire_schedule_plan('NBA',date,games,null,'New model','test-v9');
  if result<>batch or not exists(select 1 from public.gamewaire_schedule_jobs where batch_id=batch and status='pending')
    then raise exception 'A model change must requeue an upcoming old-model game'; end if;
  result:=public.gamewaire_schedule_plan('NBA',date,games,null,'New model','test-v9');
  select count(*) into jobs from public.gamewaire_schedule_jobs where batch_id=batch;
  if result is not null or jobs<>1 then raise exception 'Repeated ticks must not duplicate paid work'; end if;
  update public.gamewaire_schedule_jobs set status='failed' where batch_id=batch;
  perform public.gamewaire_schedule_plan('NBA',date,games,null,'New model','test-v9');
  if not exists(select 1 from public.gamewaire_schedule_jobs where batch_id=batch and status='failed')
    then raise exception 'Failed current-model jobs must not retry automatically'; end if;
  update public.gamewaire_schedule_jobs set status='running' where batch_id=batch;
  result:=public.gamewaire_schedule_plan('NBA',date,games,null,'Another model','test-v10');
  if result is not null or exists(select 1 from public.gamewaire_schedule_batches where id=batch and model_version='test-v10')
    then raise exception 'An in-flight analysis must finish before a model catch-up plan'; end if;
  update public.gamewaire_schedule_jobs set status='completed' where batch_id=batch;
  perform public.gamewaire_schedule_plan('NBA',date,games,null,'Another model','test-v10');
  if not exists(select 1 from public.gamewaire_schedule_jobs where batch_id=batch and status='pending')
    then raise exception 'Catch-up must resume after the running job finishes'; end if;
end $$;
rollback;
