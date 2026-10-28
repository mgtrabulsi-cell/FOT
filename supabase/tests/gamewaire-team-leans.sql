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
  lean := '{"qualifies":false,"reason":"Not a Top Pick","pick":{"key":"lean","eventId":"team-lean-test","market":"h2h","probability":0.55}}';
  perform public.gamewaire_finish(run,'no_qualifying',jsonb_build_object('picks','[]'::jsonb,'teamLean',lean),'[]');
  if not exists(select 1 from public.gamewaire_team_leans where event_id='team-lean-test' and team_lean=lean)
    then raise exception 'A supported lean must persist without qualifying picks'; end if;
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
  if exists(select 1 from public.gamewaire_team_leans where event_id='team-lean-test' and team_lean is not null)
    then raise exception 'Unavailable refresh must clear prior lean, not keep a stale success'; end if;
end $$;
rollback;
