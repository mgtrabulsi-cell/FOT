begin;
do $$
declare run uuid; tracked public.gamewaire_picks; candidate jsonb; lean jsonb;
begin
  assert not has_function_privilege('authenticated','public.gamewaire_delete_lean(uuid,integer)','execute');
  assert not has_function_privilege('anon','public.gamewaire_delete_lean(uuid,integer)','execute');
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values('NBA','delete-lean-test',now()+interval '1 day','Away @ Home','{}','in_progress') returning id into run;
  candidate:=jsonb_build_object('key','delete-lean-test|h2h','eventId','delete-lean-test',
    'sport','NBA','market','h2h','subject','Away','side','Away','line',null,'american',-110,
    'probability',0.55,'pushProbability',0,'book','Test','modelVersion','empirical-baseline-v5',
    'updatedAt',now(),'dataAt',now());
  lean:=jsonb_build_object('pick',candidate,'qualifies',false,'reason','Test');
  perform public.gamewaire_finish(run,'completed',jsonb_build_object('picks','[]'::jsonb,'teamLean',lean),'[]'::jsonb);
  perform public.gamewaire_publish_lean(run);
  select * into tracked from public.gamewaire_picks where run_id=run;
  begin
    perform public.gamewaire_delete_lean(tracked.id,tracked.revision+1);
    raise exception 'Expected stale revision rejection';
  exception when raise_exception then
    if sqlerrm<>'This pick changed. Refresh before deleting' then raise; end if;
  end;
  perform public.gamewaire_delete_lean(tracked.id,tracked.revision);
  assert not exists(select 1 from public.gamewaire_team_leans where event_id='delete-lean-test');
  assert exists(select 1 from public.gamewaire_picks where id=tracked.id and not is_game_lean and not is_top_pick);
  assert exists(select 1 from public.gamewaire_pick_changes where pick_id=tracked.id),'Removal is audited';
  assert exists(select 1 from public.gamewaire_runs where id=run),'Saved analysis survives';

  perform public.gamewaire_publish_lean(run);
  update public.gamewaire_picks set is_top_pick=true,result='win',settled_at=now() where id=tracked.id;
  select * into tracked from public.gamewaire_picks where id=tracked.id;
  -- A newer price snapshot must survive deletion of the older result.
  candidate:=candidate||jsonb_build_object('american',-115);
  update public.gamewaire_runs set payload=jsonb_build_object('teamLean',jsonb_build_object('pick',candidate)) where id=run;
  perform public.gamewaire_publish_lean(run);
  perform public.gamewaire_delete_lean(tracked.id,tracked.revision);
  assert exists(select 1 from public.gamewaire_team_leans where event_id='delete-lean-test'
    and team_lean->'pick'->>'american'='-115'),'Do not remove a newer publication';
  assert exists(select 1 from public.gamewaire_picks where id=tracked.id and is_top_pick and not is_game_lean and result='win'),
    'Shared Top Pick and result survive';
end $$;
rollback;
select 'PASS: revision checks, service-only permissions, exact snapshot deletion, shared Top Pick preservation and audit retention' result;
