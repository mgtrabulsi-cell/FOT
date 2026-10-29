begin;
do $$
declare run uuid; lean jsonb; games jsonb; day date := (now() at time zone 'America/New_York')::date + 30; batch uuid;
begin
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values ('NBA','nba-private-lean-test',now()+interval '1 day','Private lean test','{"markets":["h2h","spreads"]}','in_progress')
    returning id into run;
  lean:=jsonb_build_object('qualifies',false,'reason','Lean only, not a Top Pick','pick',
    jsonb_build_object('key','nba-private-lean-test|h2h','eventId','nba-private-lean-test','market','h2h',
      'subject','Away','side','Away','american',-110,'probability',0.55,'pushProbability',0,'book','Test','modelVersion','empirical-baseline-v5','updatedAt',now(),'dataAt',now()));
  perform public.gamewaire_finish(run,'no_qualifying',jsonb_build_object('picks','[]'::jsonb,'teamLean',lean),'[]');
  assert not exists(select 1 from public.gamewaire_team_leans where event_id='nba-private-lean-test'),'NBA analysis cannot publish automatically';
  perform public.gamewaire_publish_lean(run);
  assert exists(select 1 from public.gamewaire_team_leans where event_id='nba-private-lean-test' and team_lean=lean),'Explicit lean publication succeeds';
  assert exists(select 1 from public.gamewaire_picks where event_id='nba-private-lean-test' and is_game_lean and not is_top_pick),'Lean creates only Game Leans performance';
  -- A later private refresh must not overwrite the owner's published snapshot.
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values ('NBA','nba-private-lean-test',now()+interval '1 day','Private lean test','{}','in_progress') returning id into run;
  perform public.gamewaire_finish(run,'insufficient_data','{"picks":[]}','[]');
  assert exists(select 1 from public.gamewaire_team_leans where event_id='nba-private-lean-test' and team_lean=lean),'Private refresh preserves published snapshot';
  begin
    perform public.gamewaire_publish_lean(run);
    raise exception 'Missing lean accepted';
  exception when raise_exception then if sqlerrm='Missing lean accepted' then raise; end if;
  end;
  update public.gamewaire_runs set status='completed',payload=jsonb_build_object('teamLean',
    jsonb_set(lean,'{pick,updatedAt}',to_jsonb(now()-interval '11 minutes'))) where id=run;
  begin
    perform public.gamewaire_publish_lean(run);
    raise exception 'Stale lean accepted';
  exception when raise_exception then if sqlerrm='Stale lean accepted' then raise; end if;
  end;
  update public.gamewaire_runs set payload=jsonb_build_object('teamLean',
    jsonb_set(lean,'{pick,market}','"player_points"')) where id=run;
  begin
    perform public.gamewaire_publish_lean(run);
    raise exception 'Player lean accepted';
  exception when raise_exception then if sqlerrm='Player lean accepted' then raise; end if;
  end;
  select jsonb_agg(jsonb_build_object('event_id','nba-slate-test-'||n,'event_start',
    (day::timestamp+interval '20 hours') at time zone 'America/New_York','matchup','Away @ Home','selection_note','All games'))
    into games from generate_series(1,15) n;
  batch:=public.gamewaire_schedule_plan('NBA',day,games,null,'Every NBA game');
  assert (select count(*) from public.gamewaire_schedule_jobs where batch_id=batch)=15,'Full 15-game NBA slate accepted';
  begin
    perform public.gamewaire_schedule_plan('NBA',day+1,games||jsonb_build_array(games->0),null,'Too many');
    raise exception 'Over 15 NBA games accepted';
  exception when raise_exception then if sqlerrm='Over 15 NBA games accepted' then raise; end if;
  end;
end $$;
set local role authenticated;
do $$ begin
  begin
    perform public.gamewaire_publish_lean(gen_random_uuid());
    raise exception 'Client can publish directly';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
