begin;
create temporary table stretch_test_ids(run_id uuid, pick_key text);
do $$
declare run uuid; candidate jsonb; report jsonb;
begin
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values('NBA','stretch-rollback-test',now()+interval '1 day','Away @ Home','{}','in_progress') returning id into run;
  candidate:=jsonb_build_object('key','stretch-rollback-key','sport','NBA','eventId','stretch-rollback-test',
    'market','player_points','subject','Test Player','side','Over','line',20.5,'american',-110,
    'probability',0.45,'pushProbability',0,'modelVersion','empirical-baseline-v5',
    'updatedAt',now(),'dataAt',now(),'ev',-0.14,'edge',-0.07,'conservativeEV',-0.3);
  report:=jsonb_build_object('picks',jsonb_build_array(candidate),'stretchKeys',jsonb_build_array(candidate->>'key'),'playerPropMinimum',3);
  perform public.gamewaire_finish(run,'completed',report,jsonb_build_array(candidate));
  if not exists(select 1 from public.gamewaire_stretch_picks where run_id=run and pick_key=candidate->>'key')
    then raise exception 'Missing persisted private Stretch label'; end if;
  perform public.gamewaire_publish(run,array[candidate->>'key']);
  if not exists(select 1 from public.gamewaire_publications where run_id=run and jsonb_array_length(picks)=1)
    then raise exception 'Stretch candidate was not publishable'; end if;
  if exists(select 1 from public.gamewaire_publications where run_id=run and (picks::text like '%stretchKeys%' or picks::text like '%"stretch":%'))
    or exists(select 1 from public.gamewaire_picks where run_id=run and (data ? 'stretchKeys' or data ? 'stretch'))
    then raise exception 'Private Stretch metadata leaked into public pick JSON'; end if;
  insert into stretch_test_ids values(run,candidate->>'key');
end $$;
grant select on stretch_test_ids to authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from public.gamewaire_admin_account),true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.gamewaire_stretch_picks s join stretch_test_ids t using(run_id,pick_key))<>1
    then raise exception 'Designated account cannot read its Stretch label'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',coalesce(
  (select user_id::text from public.livewire_roles where user_id<>(select user_id from public.gamewaire_admin_account) and role in ('admin','owner') limit 1),
  '00000000-0000-0000-0000-000000000001'),true);
set local role authenticated;
do $$
begin
  if exists(select 1 from public.gamewaire_stretch_picks) then raise exception 'Another account can read private Stretch labels'; end if;
  if not exists(select 1 from public.gamewaire_publications p join stretch_test_ids t on p.run_id=t.run_id)
    then raise exception 'Published Stretch pick not visible to members'; end if;
  begin
    insert into public.gamewaire_stretch_picks select * from stretch_test_ids;
    raise exception 'Client wrote private Stretch metadata';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.gamewaire_stretch_picks;
    raise exception 'Guest can read Stretch labels';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
select 'PASS: Stretch publication, private persistence, owner/member/guest permissions; all writes rolled back' result;
