begin;
insert into auth.users(id,email) values
 ('c9503333-3333-4333-8333-333333333331','nba-team@example.test'),
 ('c9503333-3333-4333-8333-333333333332','nba-player@example.test'),
 ('c9503333-3333-4333-8333-333333333333','nba-optout@example.test');
insert into public.user_favorites(user_id,favorites) values
 ('c9503333-3333-4333-8333-333333333331','[{"type":"team","feedPath":"basketball/nba","id":"1"}]'),
 ('c9503333-3333-4333-8333-333333333332','[{"type":"player","feedPath":"basketball/nba","id":"p1","teamId":"1"},{"type":"team","feedPath":"football/nfl","id":"1"}]');
insert into public.user_push_subscriptions(user_id,endpoint,subscription,notify_scores) values
 ('c9503333-3333-4333-8333-333333333331','https://example.invalid/nba-team','{}',true),
 ('c9503333-3333-4333-8333-333333333332','https://example.invalid/nba-player','{}',true),
 ('c9503333-3333-4333-8333-333333333333','https://example.invalid/nba-optout','{}',false);
set local role anon;
do $$ begin
  begin perform public.claim_nba_push(); raise exception 'Anon claimed deliveries'; exception when insufficient_privilege then null; end;
  begin perform public.save_nba_push_poll('test',0,'{}','[]','https://example.invalid'); raise exception 'Anon saved state'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9503333-3333-4333-8333-333333333331',true);
do $$ begin
  begin perform 1 from public.nba_push_deliveries; raise exception 'Member read deliveries'; exception when insufficient_privilege then null; end;
  begin perform public.claim_nba_push(); raise exception 'Member claimed deliveries'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
set local role service_role;
do $$ begin
  assert public.save_nba_push_poll('test-nba-notifications',0,'{"status":"in"}','[]','https://example.invalid'), 'Baseline saved';
  assert not public.save_nba_push_poll('test-nba-notifications',0,'{}','[]','https://example.invalid'), 'Stale concurrent state rejected';
  assert public.save_nba_push_poll('test-nba-notifications',1,'{"status":"in"}',
    '[{"key":"quarter:1","kind":"quarter","teamIds":["1","2"],"body":"End Q1"},{"key":"points:p1:35","kind":"milestone","teamIds":[],"body":"Player hits 35"}]',
    'https://example.invalid'), 'State and events enqueue atomically';
  assert (select count(*)=1 from public.nba_push_deliveries where event_id='test-nba-notifications' and kind='quarter'
    and user_id in ('c9503333-3333-4333-8333-333333333331','c9503333-3333-4333-8333-333333333332')), 'Only NBA team favorite gets quarter alert';
  assert (select count(*)=2 from public.nba_push_deliveries where event_id='test-nba-notifications' and kind='milestone'
    and user_id in ('c9503333-3333-4333-8333-333333333331','c9503333-3333-4333-8333-333333333332')), 'All enabled devices get milestones';
  assert not exists(select 1 from public.nba_push_deliveries where user_id='c9503333-3333-4333-8333-333333333333'), 'Opt-out respected';
  assert public.save_nba_push_poll('test-nba-notifications',2,'{"status":"in"}',
    '[{"key":"points:p1:35","kind":"milestone","teamIds":[],"body":"Player hits 35"}]','https://example.invalid');
  assert (select count(*)=3 from public.nba_push_deliveries where event_id='test-nba-notifications'
    and user_id in ('c9503333-3333-4333-8333-333333333331','c9503333-3333-4333-8333-333333333332')), 'Repeat event is deduplicated by endpoint';
end; $$;
reset role;
-- Do not claim real production deliveries in a rollback-only test.
delete from auth.users where id='c9503333-3333-4333-8333-333333333332';
do $$ begin
  assert not exists(select 1 from public.nba_push_deliveries where user_id='c9503333-3333-4333-8333-333333333332'), 'Account deletion removes queued deliveries';
end; $$;
rollback;
