begin;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.gamewaire_runs;
    raise exception 'Anonymous GamewAIre history access must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.gamewaire_claim('00000000-0000-0000-0000-000000000001');
    raise exception 'Anonymous rate-limit RPC access must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
select count(*) from public.gamewaire_runs;
select count(*) from public.gamewaire_picks;
do $$
begin
  begin
    insert into public.gamewaire_runs (sport,event_id,event_start,matchup,settings,status)
    values ('NBA','forbidden',now(),'Forbidden','{}','in_progress');
    raise exception 'Client analysis writes must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.gamewaire_picks set result = 'win';
    raise exception 'Client settlement writes must be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.gamewaire_finish(gen_random_uuid(),'completed','{}','[]');
    raise exception 'Client completion RPC access must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
declare run uuid; duplicate uuid; candidate jsonb; total integer;
begin
  insert into public.gamewaire_runs (sport,event_id,event_start,matchup,settings,status)
    values ('NBA','gamewaire-test',now() + interval '1 day','Test','{}','in_progress') returning id into run;
  begin
    insert into public.gamewaire_runs (sport,event_id,event_start,matchup,settings,status)
      values ('NBA','gamewaire-test',now() + interval '1 day','Test','{}','in_progress');
    raise exception 'Concurrent analysis must be rejected';
  exception when unique_violation then null;
  end;
  candidate := '{"key":"test|player_points|Player|Over|20.5","market":"player_points","subject":"Player","side":"Over","line":20.5,"american":150,"probability":0.65,"pushProbability":0,"book":"Test","modelVersion":"test"}';
  perform public.gamewaire_finish(run,'completed',jsonb_build_object('picks',jsonb_build_array(candidate)),jsonb_build_array(candidate));
  insert into public.gamewaire_runs (sport,event_id,event_start,matchup,settings,status)
    values ('NBA','gamewaire-test',now() + interval '1 day','Test','{}','in_progress') returning id into duplicate;
  perform public.gamewaire_finish(duplicate,'completed','{}',jsonb_build_array(candidate));
  select count(*) into total from public.gamewaire_picks where event_id = 'gamewaire-test';
  if total <> 1 then raise exception 'Repeated identical selections must not inflate performance'; end if;
  update public.gamewaire_picks set withdrawn = true, settlement_note = 'Test withdrawal' where run_id = run;
  select count(*) into total from public.gamewaire_pick_changes where pick_id in (select id from public.gamewaire_picks where run_id = run);
  if total <> 1 then raise exception 'Settlement changes must retain an audit history'; end if;
end $$;
rollback;
