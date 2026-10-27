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
    perform count(*) from public.gamewaire_publications;
    raise exception 'Anonymous published-game access must be denied';
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
  begin
    perform public.gamewaire_publish(gen_random_uuid(),array['forbidden']);
    raise exception 'Client publication RPC access must be denied';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.gamewaire_runs) then raise exception 'Ordinary members must not see candidate runs'; end if;
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
  candidate := candidate || jsonb_build_object('updatedAt',now(),'dataAt',now());
  perform public.gamewaire_finish(run,'completed',jsonb_build_object('picks',jsonb_build_array(candidate)),jsonb_build_array(candidate));
  if exists (select 1 from public.gamewaire_picks where event_id = 'gamewaire-test') then raise exception 'Unpublished candidates must not enter performance'; end if;
  perform public.gamewaire_publish(run,array[candidate->>'key']);
  insert into public.gamewaire_runs (sport,event_id,event_start,matchup,settings,status)
    values ('NBA','gamewaire-test',now() + interval '1 day','Test','{}','in_progress') returning id into duplicate;
  perform public.gamewaire_finish(duplicate,'completed',jsonb_build_object('picks',jsonb_build_array(candidate)),jsonb_build_array(candidate));
  perform public.gamewaire_publish(duplicate,array[candidate->>'key']);
  select count(*) into total from public.gamewaire_picks where event_id = 'gamewaire-test';
  if total <> 1 then raise exception 'Repeated identical selections must not inflate performance'; end if;
  begin
    perform public.gamewaire_publish(run,array['invented']);
    raise exception 'Unverified selections must not publish';
  exception when raise_exception then
    if sqlerrm = 'Unverified selections must not publish' then raise; end if;
  end;
  update public.gamewaire_runs set payload = jsonb_build_object('picks',jsonb_build_array(candidate || jsonb_build_object('updatedAt',now() - interval '11 minutes'))) where id = run;
  begin
    perform public.gamewaire_publish(run,array[candidate->>'key']);
    raise exception 'Stale selections must not publish';
  exception when raise_exception then
    if sqlerrm = 'Stale selections must not publish' then raise; end if;
  end;
  update public.gamewaire_picks set withdrawn = true, settlement_note = 'Test withdrawal' where run_id = run;
  select count(*) into total from public.gamewaire_pick_changes where pick_id in (select id from public.gamewaire_picks where run_id = run);
  if total <> 1 then raise exception 'Settlement changes must retain an audit history'; end if;
end $$;
do $$
declare run uuid; candidates jsonb; keys text[]; total integer;
begin
  select jsonb_agg(jsonb_build_object('key','pool-' || n,'market','player_points','subject','Player ' || n,
    'side','Over','line',20.5,'american',150,'probability',0.65,'pushProbability',0,'book','Test',
    'modelVersion','test','updatedAt',now(),'dataAt',now())) into candidates from generate_series(1,8) n;
  insert into public.gamewaire_runs (sport,event_id,event_start,matchup,settings,status)
    values ('NBA','gamewaire-pool-test',now() + interval '1 day','Eight candidate test','{}','in_progress') returning id into run;
  perform public.gamewaire_finish(run,'completed',jsonb_build_object('picks',candidates),candidates);
  if exists (select 1 from public.gamewaire_picks where event_id = 'gamewaire-pool-test') then raise exception 'Private pool must not affect performance'; end if;
  perform public.gamewaire_publish(run,array['pool-1','pool-2','pool-3','pool-4']);
  select count(*) into total from public.gamewaire_picks where event_id = 'gamewaire-pool-test';
  if total <> 4 then raise exception 'Only four published picks must be tracked, not all eight'; end if;
  if (select jsonb_array_length(picks) from public.gamewaire_publications where event_id = 'gamewaire-pool-test') <> 4 then
    raise exception 'Member publication must contain four picks'; end if;
  foreach keys slice 1 in array array[array['pool-1','pool-2','pool-3','pool-4','pool-5'],array['pool-1','pool-1','pool-1','pool-1','pool-1']] loop
    begin
      perform public.gamewaire_publish(run,keys);
      raise exception 'Invalid publication count or duplicates must fail';
    exception when raise_exception then
      if sqlerrm = 'Invalid publication count or duplicates must fail' then raise; end if;
    end;
  end loop;
end $$;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.gamewaire_runs where event_id = 'gamewaire-pool-test') then raise exception 'Private eight-candidate pool must not be readable by members'; end if;
  if not exists (select 1 from public.gamewaire_publications where event_id = 'gamewaire-pool-test' and jsonb_array_length(picks) = 4) then raise exception 'Members must see the four published picks'; end if;
end $$;
reset role;
rollback;
