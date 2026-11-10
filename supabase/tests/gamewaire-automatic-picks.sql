begin;
do $$
declare run uuid; candidate jsonb; tracked public.gamewaire_picks; start_time timestamptz:=now()+interval '1 day';
begin
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values('NBA','automatic-record-test',start_time,'Away @ Home','{}','no_qualifying') returning id into run;
  candidate:=jsonb_build_object('key','automatic-record-test|h2h','eventId','automatic-record-test',
    'sport','NBA','start',start_time,'home','Home','away','Away','market','h2h','subject','Home','side','Home',
    'line',null,'american',-110,'probability',0.6,'pushProbability',0,'book','Test','modelVersion','test-model',
    'updatedAt',now(),'dataAt',now(),'identifiers',jsonb_build_object('espnEventId','401'));
  update public.gamewaire_runs set payload=jsonb_build_object('winnerLean',jsonb_build_object('pick',candidate,'qualifies',false)) where id=run;
  assert public.gamewaire_track_automatic_pick(run,candidate),'A selected winner lean can be tracked without passing value screens';
  select * into tracked from public.gamewaire_picks where run_id=run;
  assert tracked.is_automatic and not tracked.is_top_pick and not tracked.is_game_lean and tracked.result='pending','Automatic picks have their own category';
  assert tracked.data=candidate and tracked.american=-110,'Save the exact original selection and price';
  assert not public.gamewaire_track_automatic_pick(run,candidate),'Repeated registration must be idempotent';
  update public.gamewaire_picks set result='win',settled_at=now(),settlement_note='Manual correction',revision=2 where id=tracked.id;
  candidate:=candidate||jsonb_build_object('american',-120);
  update public.gamewaire_runs set payload=jsonb_build_object('winnerLean',jsonb_build_object('pick',candidate)) where id=run;
  assert not public.gamewaire_track_automatic_pick(run,candidate),'A refresh cannot replace the first automatic selection';
  assert (select count(*)=1 from public.gamewaire_picks where run_id=run),'No second price or result for the same automatic game';
  assert exists(select 1 from public.gamewaire_picks where id=tracked.id and result='win' and revision=2 and american=-110 and settlement_note='Manual correction'),'Manual outcomes and original price remain unchanged';
  begin
    perform public.gamewaire_track_automatic_pick(run,candidate||jsonb_build_object('side','Other'));
    raise exception 'Unsupported candidate accepted';
  exception when raise_exception then if sqlerrm='Unsupported candidate accepted' then raise; end if; end;
  -- A second automatic game can reuse an already-published row without resetting it.
  delete from public.gamewaire_automatic_picks where run_id=run;
  select data into candidate from public.gamewaire_picks where id=tracked.id;
  update public.gamewaire_runs set payload=jsonb_build_object('teamLean',jsonb_build_object('pick',candidate)) where id=run;
  update public.gamewaire_picks set is_game_lean=true,is_automatic=false where id=tracked.id;
  assert public.gamewaire_track_automatic_pick(run,candidate),'Attach automatic membership to the existing selection';
  assert exists(select 1 from public.gamewaire_picks where id=tracked.id and is_automatic and is_game_lean and result='win' and revision=2),'Published/automatic selection shares one unchanged result';
  delete from public.gamewaire_automatic_picks where run_id=run;
  update public.gamewaire_runs set event_start=now()-interval '1 hour' where id=run;
  candidate:=candidate||jsonb_build_object('start',now()-interval '1 hour');
  update public.gamewaire_runs set payload=jsonb_build_object('teamLean',jsonb_build_object('pick',candidate)) where id=run;
  assert not public.gamewaire_track_automatic_pick(run,candidate),'Never retrospectively invent a historical automatic selection';
end $$;
set local role authenticated;
do $$
begin
  assert exists(select 1 from public.gamewaire_picks where event_id='automatic-record-test' and is_automatic),'Members can read automatic results';
  begin
    perform public.gamewaire_track_automatic_pick(null,null);
    raise exception 'Direct tracking incorrectly allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: automatic pregame snapshots, winner leans, idempotency, exact prices, shared outcomes, manual protection, historical exclusion and permissions; test writes rolled back' as result;
