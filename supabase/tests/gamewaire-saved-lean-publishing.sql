begin;
do $$
declare run uuid; lean jsonb; prop jsonb; tracked public.gamewaire_picks; league text; market_name text; original jsonb;
begin
  foreach league in array array['NBA','NFL'] loop
    foreach market_name in array array['h2h','spreads'] loop
      insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status,finished_at)
        values(league,'saved-lean-test-'||league||market_name,now()+interval '1 day','Away @ Home','{}','completed',now()-interval '12 hours')
        returning id into run;
      lean:=jsonb_build_object('qualifies',false,'reason','Verified game lean','pick',
        jsonb_build_object('key','saved-lean-test-'||league||market_name,'eventId','saved-lean-test-'||league||market_name,
          'market',market_name,'subject','Away','side','Away','line',case when market_name='spreads' then 3.5 else null end,
          'american',-110,'probability',0.55,'pushProbability',0,'book','Test','modelVersion','test-model',
          'updatedAt',now()-interval '12 hours','dataAt',now()-interval '12 hours'));
      update public.gamewaire_runs set payload=jsonb_build_object('teamLean',lean) where id=run;
      original:=lean;
      perform public.gamewaire_publish_lean(run);
      assert exists(select 1 from public.gamewaire_team_leans where team_lean=original),'Overnight snapshot publishes unchanged';
      select * into tracked from public.gamewaire_picks where run_id=run;
      assert tracked.is_game_lean and not tracked.is_top_pick and tracked.american=-110;
      -- An old client publishing a team selection cannot restore Top Pick membership.
      update public.gamewaire_picks set is_top_pick=true where id=tracked.id;
      assert exists(select 1 from public.gamewaire_picks where id=tracked.id and is_game_lean and not is_top_pick);
      prop:=jsonb_build_object('key',lean->'pick'->>'key'||'-prop','eventId',lean->'pick'->>'eventId','market','player_points',
        'subject','Player','side','Over','line',20.5,'american',100,'probability',0.6,'pushProbability',0,
        'book','Test','modelVersion','test-model','updatedAt',now(),'dataAt',now());
      insert into public.gamewaire_picks(run_id,fingerprint,sport,event_id,event_start,market,subject,side,line,american,probability,push_probability,data)
        values(run,concat_ws('|',prop->>'key','Test','100','test-model'),league,tracked.event_id,tracked.event_start,
          'player_points','Player','Over',20.5,100,0.6,0,prop);
      insert into public.gamewaire_publications(sport,event_id,run_id,event_start,matchup,picks)
        values(league,tracked.event_id,run,tracked.event_start,'Away @ Home',jsonb_build_array(lean->'pick',prop));
      assert exists(select 1 from public.gamewaire_picks where id=tracked.id and not is_top_pick and is_game_lean);
      assert exists(select 1 from public.gamewaire_picks where run_id=run and market='player_points' and is_top_pick and not is_game_lean);
      perform public.gamewaire_delete_lean(tracked.id,tracked.revision);
      assert exists(select 1 from public.gamewaire_picks where id=tracked.id and not is_top_pick and not is_game_lean),'Deletion preserves audited snapshot';
      assert (select picks from public.gamewaire_publications where sport=league and event_id=tracked.event_id)=jsonb_build_array(prop),'Deleting a legacy team selection preserves props and removes feed entry';
      perform public.gamewaire_publish_lean(run);
      update public.gamewaire_picks set withdrawn=true where id=tracked.id;
      begin
        perform public.gamewaire_publish_lean(run);
        raise exception 'Withdrawn lean accepted';
      exception when raise_exception then if sqlerrm='Withdrawn lean accepted' then raise; end if; end;
      update public.gamewaire_picks set withdrawn=false,result='void' where id=tracked.id;
      begin
        perform public.gamewaire_publish_lean(run);
        raise exception 'Settled lean accepted';
      exception when raise_exception then if sqlerrm='Settled lean accepted' then raise; end if; end;
      update public.gamewaire_picks set result='pending' where id=tracked.id;
      update public.gamewaire_runs set event_start=now()-interval '1 minute' where id=run;
      begin
        perform public.gamewaire_publish_lean(run);
        raise exception 'Started lean accepted';
      exception when raise_exception then if sqlerrm='Started lean accepted' then raise; end if; end;
      update public.gamewaire_runs set event_start=now()+interval '1 day',
        payload=jsonb_build_object('teamLean',jsonb_set(lean,'{pick,updatedAt}','null')) where id=run;
      begin
        perform public.gamewaire_publish_lean(run);
        raise exception 'Missing timestamp accepted';
      exception when raise_exception then if sqlerrm='Missing timestamp accepted' then raise; end if; end;
      update public.gamewaire_runs set payload=jsonb_build_object('teamLean',
        jsonb_set(lean,'{pick,dataAt}',to_jsonb(now()+interval '1 hour'))) where id=run;
      begin
        perform public.gamewaire_publish_lean(run);
        raise exception 'Future data accepted';
      exception when raise_exception then if sqlerrm='Future data accepted' then raise; end if; end;
      update public.gamewaire_runs set payload=jsonb_build_object('teamLean',jsonb_set(lean,'{pick,market}','"player_points"')) where id=run;
      begin
        perform public.gamewaire_publish_lean(run);
        raise exception 'Player lean accepted';
      exception when raise_exception then if sqlerrm='Player lean accepted' then raise; end if; end;
    end loop;
  end loop;
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values('NBA','saved-total-test',now()+interval '1 day','Away @ Home','{}','in_progress') returning id into run;
  lean:=jsonb_build_object('key','saved-total-test|totals','eventId','saved-total-test','market','totals',
    'subject','Away @ Home','side','Over','line',210.5,'american',-110,'probability',0.55,'pushProbability',0,
    'book','Test','modelVersion','test-model','updatedAt',now(),'dataAt',now());
  prop:=prop||jsonb_build_object('key','saved-total-test|prop','eventId','saved-total-test');
  perform public.gamewaire_finish(run,'completed',jsonb_build_object('picks',jsonb_build_array(lean,prop)),jsonb_build_array(lean,prop));
  perform public.gamewaire_publish(run,array[lean->>'key',prop->>'key']);
  assert exists(select 1 from public.gamewaire_picks where run_id=run and market='totals' and is_game_lean and not is_top_pick),'Totals publish only as Game Leans';
  assert exists(select 1 from public.gamewaire_picks where run_id=run and market='player_points' and is_top_pick and not is_game_lean),'Props publish only as Top Picks';
  select * into tracked from public.gamewaire_picks where run_id=run and market='totals';
  perform public.gamewaire_delete_lean(tracked.id,tracked.revision);
  assert (select picks from public.gamewaire_publications where event_id='saved-total-test')=jsonb_build_array(prop),'Deleting totals preserves player props';
end $$;
set local role authenticated;
do $$ begin
  begin
    perform public.gamewaire_publish_lean(gen_random_uuid());
    raise exception 'Client published directly';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
