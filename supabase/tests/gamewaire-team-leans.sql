begin;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.gamewaire_team_leans;
    raise exception 'Anonymous lean access must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
select count(*) from public.gamewaire_team_leans;
do $$
begin
  begin
    insert into public.gamewaire_team_leans values ('NBA','forbidden',now(),'Forbidden',null,now());
    raise exception 'Member writes must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
declare run uuid; lean jsonb;
begin
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values ('NFL','team-lean-test',now()+interval '1 day','Team lean test','{}','in_progress') returning id into run;
  lean := jsonb_build_object('qualifies',false,'reason','Not a Top Pick','pick',
    jsonb_build_object('key','lean','eventId','team-lean-test','market','h2h','probability',0.55,'updatedAt',now(),'dataAt',now()));
  perform public.gamewaire_finish(run,'no_qualifying',jsonb_build_object('picks','[]'::jsonb,'teamLean',lean),'[]');
  if exists(select 1 from public.gamewaire_team_leans where event_id='team-lean-test')
    then raise exception 'NFL analysis must stay private'; end if;
  perform public.gamewaire_publish_lean(run);
  if not exists(select 1 from public.gamewaire_team_leans where event_id='team-lean-test' and team_lean=lean)
    then raise exception 'Explicit publication must save the NFL lean'; end if;
  if exists(select 1 from public.gamewaire_picks where event_id='team-lean-test')
    then raise exception 'Team leans must never enter published performance automatically'; end if;
  begin
    perform public.gamewaire_publish(run,array['lean']);
    raise exception 'A failed-value lean cannot publish as a Top Pick';
  exception when raise_exception then
    if sqlerrm = 'A failed-value lean cannot publish as a Top Pick' then raise; end if;
  end;
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status)
    values ('NFL','team-lean-test',now()+interval '1 day','Team lean test','{}','in_progress') returning id into run;
  perform public.gamewaire_finish(run,'insufficient_data','{"picks":[]}'::jsonb,'[]');
  if not exists(select 1 from public.gamewaire_team_leans where event_id='team-lean-test' and team_lean=lean)
    then raise exception 'Private refresh must not overwrite an explicitly published lean'; end if;
end $$;
rollback;
