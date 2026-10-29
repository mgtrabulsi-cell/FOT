begin isolation level repeatable read;
create temporary table lean_results_baseline as select
  (select count(*) from public.gamewaire_push_days) push_days,
  (select count(*) from public.gamewaire_push_deliveries) deliveries,
  (select count(*) from public.gamewaire_publications) publications;

do $$
declare league text; run uuid; candidate jsonb; lean jsonb; tracked public.gamewaire_picks; shared uuid; top_first uuid;
begin
  foreach league in array array['NBA','NFL'] loop
    insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
      values(league,'lean-results-test-'||league,now()+interval '1 day','Away @ Home','{}','in_progress') returning id into run;
    candidate:=jsonb_build_object('key','lean-results-test-'||league||'|h2h','eventId','lean-results-test-'||league,
      'sport',league,'market','h2h','subject','Away','side','Away','line',null,'american',-110,
      'probability',0.55,'pushProbability',0,'book','Test','modelVersion','empirical-baseline-v5',
      'updatedAt',now(),'dataAt',now());
    lean:=jsonb_build_object('pick',candidate,'qualifies',false,'reason','Lean only');
    perform public.gamewaire_finish(run,'completed',jsonb_build_object('picks',jsonb_build_array(candidate),'teamLean',lean),jsonb_build_array(candidate));
    assert not exists(select 1 from public.gamewaire_picks where run_id=run),'Private report must not create results';
    perform public.gamewaire_publish_lean(run);
    select * into tracked from public.gamewaire_picks where run_id=run;
    assert tracked.is_game_lean and not tracked.is_top_pick and tracked.result='pending','Published lean starts pending, separate from Top Picks';
    assert tracked.data=candidate and tracked.american=-110 and tracked.run_id=run,'Track exact saved price/analysis, no invented data';
    perform public.gamewaire_publish_lean(run);
    assert (select count(*) from public.gamewaire_picks where run_id=run)=1,'Repeated lean publication cannot duplicate a result';
    assert (select publications=(select count(*) from public.gamewaire_publications)
      and push_days=(select count(*) from public.gamewaire_push_days)
      and deliveries=(select count(*) from public.gamewaire_push_deliveries) from lean_results_baseline),
      'Lean publication must not create Top Picks or notifications';
    if league='NBA' then shared:=tracked.id; end if;
  end loop;

  -- Lean first, then Top Pick: share the existing fingerprint and result.
  select run_id into run from public.gamewaire_picks where id=shared;
  select data into candidate from public.gamewaire_picks where id=shared;
  -- Disable only the notification trigger during rollback test publication.
  alter table public.gamewaire_publications disable trigger gamewaire_published_push;
  perform public.gamewaire_publish(run,array[candidate->>'key']);
  select * into tracked from public.gamewaire_picks where id=shared;
  assert tracked.is_game_lean and tracked.is_top_pick,'Both records share a selection when lean is published first';
  assert (select count(*) from public.gamewaire_picks where run_id=run)=1,'All Picks must count shared fingerprint once';

  -- Preserve manual outcome, revision and historical metadata when republishing a lean.
  update public.gamewaire_picks set result='win',revision=revision+1,settled_at=now(),settlement_note='Existing note' where id=shared;
  perform public.gamewaire_publish_lean(run);
  select * into tracked from public.gamewaire_picks where id=shared;
  assert tracked.result='win' and tracked.revision=2 and tracked.settlement_note='Existing note','Lean republish cannot reset settlement';
  update public.gamewaire_picks set result='loss',revision=revision+1 where id=shared;
  assert exists(select 1 from public.gamewaire_picks where id=shared and is_top_pick and is_game_lean and result='loss'),
    'Hit/Missed result is shared across both records';
  assert exists(select 1 from public.gamewaire_pick_changes where pick_id=shared),'Lean outcomes retain settlement audit';

  -- Changed price is a new selection snapshot, not an overwrite of the settled record.
  candidate:=candidate||jsonb_build_object('american',-115);
  update public.gamewaire_runs set payload=jsonb_build_object('picks',jsonb_build_array(candidate),
    'teamLean',jsonb_build_object('pick',candidate,'qualifies',true,'reason','Test')) where id=run;
  perform public.gamewaire_publish_lean(run);
  assert (select count(*) from public.gamewaire_picks where run_id=run)=2,'Changed price retains historical selections';
  assert exists(select 1 from public.gamewaire_picks where run_id=run and american=-115 and result='pending' and not is_top_pick),
    'Changed lean price starts pending only in Game Leans';

  -- Top Pick first, then lean: attach lean membership without changing outcome.
  perform public.gamewaire_publish(run,array[candidate->>'key']);
  select id into top_first from public.gamewaire_picks where run_id=run and american=-115;
  assert exists(select 1 from public.gamewaire_picks where id=top_first and is_top_pick and is_game_lean),'Republished Top Pick retains both memberships';
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values('NBA','lean-results-top-first',now()+interval '1 day','Away @ Home','{}','in_progress') returning id into run;
  candidate:=candidate||jsonb_build_object('eventId','lean-results-top-first','key','lean-results-top-first|h2h');
  perform public.gamewaire_finish(run,'completed',jsonb_build_object('picks',jsonb_build_array(candidate),
    'teamLean',jsonb_build_object('pick',candidate,'qualifies',true,'reason','Test')),jsonb_build_array(candidate));
  perform public.gamewaire_publish(run,array[candidate->>'key']);
  select id into top_first from public.gamewaire_picks where run_id=run;
  update public.gamewaire_picks set result='win',revision=2 where id=top_first;
  perform public.gamewaire_publish_lean(run);
  assert exists(select 1 from public.gamewaire_picks where id=top_first and is_top_pick and is_game_lean and result='win' and revision=2),
    'Top Pick first also shares membership without resetting results';
  alter table public.gamewaire_publications enable trigger gamewaire_published_push;
end $$;

set local role authenticated;
do $$
begin
  assert exists(select 1 from public.gamewaire_picks where event_id='lean-results-test-NFL' and is_game_lean),
    'Members can read published lean results';
  begin
    update public.gamewaire_picks set result='win' where event_id='lean-results-test-NFL';
    raise exception 'Direct result write incorrectly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.gamewaire_track_published_lean(null);
    raise exception 'Direct tracking RPC incorrectly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.gamewaire_picks;
    raise exception 'Guest can read results';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
select 'PASS: NBA/NFL lean tracking, private exclusion, both publication orders, deduplication, historical outcomes, metadata, auditing, permissions and no lean pushes; all test writes rolled back' result;
