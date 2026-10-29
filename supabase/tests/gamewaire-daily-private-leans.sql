begin;
do $$
declare league text; run uuid; lean jsonb; games jsonb; batch uuid;
  day date := (now() at time zone 'America/New_York')::date + 60;
begin
  while extract(isodow from day)=4 loop day:=day+1; end loop;
  foreach league in array array['NBA','NFL'] loop
    insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
      values(league,'daily-private-'||league,now()+interval '1 day','Daily private test','{}','in_progress') returning id into run;
    lean:=jsonb_build_object('qualifies',false,'reason','Lean only','pick',
      jsonb_build_object('key','daily-private-'||league||'|spreads','eventId','daily-private-'||league,'market','spreads',
        'subject','Away','side','Away','line',3.5,'american',-110,'probability',0.55,'pushProbability',0,'book','Test','modelVersion','empirical-baseline-v5','updatedAt',now(),'dataAt',now()));
    perform public.gamewaire_finish(run,'no_qualifying',jsonb_build_object('teamLean',lean,'picks','[]'::jsonb),'[]');
    assert not exists(select 1 from public.gamewaire_team_leans where event_id='daily-private-'||league),
      'Neither sport may publish on analysis completion';
    perform public.gamewaire_publish_lean(run);
    assert exists(select 1 from public.gamewaire_team_leans where event_id='daily-private-'||league and team_lean=lean),
      'Both sports support explicit lean publication';
    insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
      values(league,'daily-private-'||league,now()+interval '1 day','Daily private test','{}','in_progress') returning id into run;
    perform public.gamewaire_finish(run,'insufficient_data','{"picks":[]}','[]');
    assert exists(select 1 from public.gamewaire_team_leans where event_id='daily-private-'||league and team_lean=lean),
      'Private refreshes preserve the published snapshot';
    select jsonb_agg(jsonb_build_object('event_id','daily-slate-'||league||'-'||n,'event_start',
      (day::timestamp+interval '20 hours') at time zone 'America/New_York','matchup','Away @ Home','selection_note','Daily private'))
      into games from generate_series(1,case when league='NBA' then 15 else 16 end) n;
    batch:=public.gamewaire_schedule_plan(league,day,games,null,'Daily private');
    assert (select count(*) from public.gamewaire_schedule_jobs where batch_id=batch)=jsonb_array_length(games),
      'Full daily slates accepted on a non-Thursday';
    assert public.gamewaire_schedule_plan(league,day,games,null,'Repeat') is null, 'Daily plans remain idempotent';
    begin
      perform public.gamewaire_schedule_plan(league,day+1,jsonb_build_array(games->0),null,'Wrong date');
      raise exception 'Cross-day slate accepted';
    exception when raise_exception then if sqlerrm='Cross-day slate accepted' then raise; end if;
    end;
    assert not exists(select 1 from public.gamewaire_picks where event_id='daily-private-'||league and is_top_pick),
      'Leans do not create Top Pick performance records';
  end loop;
end $$;
rollback;
