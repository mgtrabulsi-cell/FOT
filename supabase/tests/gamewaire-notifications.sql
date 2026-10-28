begin;

-- Isolate today's threshold without changing live data outside this rolled-back transaction.
alter table public.gamewaire_publications disable trigger gamewaire_published_push;
update public.gamewaire_publications set published_at = now() - interval '3 days'
  where published_at >= ((now() at time zone 'America/New_York')::date::timestamp at time zone 'America/New_York');
alter table public.gamewaire_publications enable trigger gamewaire_published_push;
delete from public.gamewaire_push_days where publication_date = (now() at time zone 'America/New_York')::date;
insert into public.gamewaire_push_days(publication_date) values ((now() at time zone 'America/New_York')::date - 1) on conflict do nothing;
insert into auth.users(id) values
 ('d6903333-3333-4333-8333-333333333331'),
 ('d6903333-3333-4333-8333-333333333332');
insert into public.user_push_subscriptions(user_id, endpoint, subscription, notify_scores) values
 ('d6903333-3333-4333-8333-333333333331', 'https://example.invalid/gamewaire-one', '{}', true),
 ('d6903333-3333-4333-8333-333333333332', 'https://example.invalid/gamewaire-two', '{}', false);

set local role authenticated;
do $$
begin
  begin
    perform public.claim_gamewaire_push();
    raise exception 'Members cannot claim notifications';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.gamewaire_push_deliveries;
    raise exception 'Members cannot read notification targets';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.gamewaire_push_days values(current_date,now());
    raise exception 'Members cannot forge a daily notification';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
declare
  today date := (now() at time zone 'America/New_York')::date;
  run_one uuid;
  run_two uuid;
  candidates jsonb;
  first_claim bigint[];
  second_claim bigint[];
  queued bigint;
begin
  select jsonb_agg(jsonb_build_object('key','notification-player-' || n,'market','player_points','subject','Notification Player ' || n,
    'side','Over','line',20.5,'american',150,'probability',0.65,'pushProbability',0,'book','Test',
    'modelVersion','test','updatedAt',now(),'dataAt',now())) into candidates from generate_series(1,6) n;
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status,payload)
    values ('NBA','notification-game-one',now() + interval '1 day','Notification test','{}','completed',jsonb_build_object('picks',candidates))
    returning id into run_one;
  insert into public.gamewaire_runs(sport,event_id,event_start,matchup,settings,status,payload)
    values ('NFL','notification-game-two',now() + interval '1 day','Notification test','{}','completed',jsonb_build_object('picks',candidates))
    returning id into run_two;
  assert not exists(select 1 from public.gamewaire_push_days where publication_date = today), 'Private analysis never sends alerts';
  perform public.gamewaire_publish(run_one,array['notification-player-1','notification-player-2','notification-player-3','notification-player-4']);
  assert not exists(select 1 from public.gamewaire_push_days where publication_date = today), 'Four picks do not trigger the five-pick alert';
  insert into public.gamewaire_publications(sport,event_id,run_id,event_start,matchup,picks,published_at)
    select 'NBA','notification-old-publication',run_one,now() - interval '3 days','Old publication',picks,now() - interval '3 days'
    from public.gamewaire_publications where sport = 'NBA' and event_id = 'notification-game-one';
  assert not exists(select 1 from public.gamewaire_push_days where publication_date = today), 'Old publications do not count toward today';
  perform public.gamewaire_publish(run_one,array['notification-player-1','notification-player-2','notification-player-3','notification-player-4']);
  assert not exists(select 1 from public.gamewaire_push_days where publication_date = today), 'Republishing four picks does not count as eight';
  insert into public.gamewaire_team_leans(sport,event_id,event_start,matchup,team_lean)
    values ('NBA','notification-lean',now() + interval '1 day','Notification lean',null);
  assert not exists(select 1 from public.gamewaire_push_days where publication_date = today), 'Game leans never count toward the threshold';
  perform public.gamewaire_publish(run_two,array['notification-player-5']);
  assert exists(select 1 from public.gamewaire_push_days where publication_date = today), 'The fifth Top Pick across NBA/NFL queues today even with yesterday already notified';
  assert (select count(*) from public.gamewaire_push_deliveries where publication_date = today and endpoint like 'https://example.invalid/gamewaire-%') = 2,
    'All notification-enabled devices receive it, independent of score preferences';
  assert not exists(select 1 from public.gamewaire_push_deliveries where publication_date = today
    and expires_at <> ((today + 1)::timestamp at time zone 'America/New_York')), 'Alerts expire at the next Eastern midnight';
  select count(*) into queued from public.gamewaire_push_deliveries where publication_date = today;
  perform public.gamewaire_publish(run_two,array['notification-player-5','notification-player-6']);
  assert (select count(*) from public.gamewaire_push_deliveries where publication_date = today) = queued, 'Sixth and later picks never broadcast again';
  select array_agg(id) into first_claim from public.claim_gamewaire_push();
  select array_agg(id) into second_claim from public.claim_gamewaire_push();
  assert not coalesce(first_claim && second_claim,false), 'Claim leases prevent concurrent delivery';
  assert (select attempts from public.gamewaire_push_deliveries where publication_date = today and endpoint = 'https://example.invalid/gamewaire-one') = 1,
    'Claim increments attempts once';
  update public.gamewaire_push_deliveries set next_attempt_at = now() - interval '1 second'
    where publication_date = today;
  perform public.claim_gamewaire_push();
  assert (select attempts from public.gamewaire_push_deliveries where publication_date = today and endpoint = 'https://example.invalid/gamewaire-one') = 2,
    'Interrupted or failed deliveries can retry';
  delete from public.user_push_subscriptions where endpoint = 'https://example.invalid/gamewaire-two';
  assert not exists(select 1 from public.gamewaire_push_deliveries where endpoint = 'https://example.invalid/gamewaire-two'), 'Opting out removes pending alerts';
  update public.gamewaire_push_deliveries set delivered_at = now(), next_attempt_at = now() - interval '1 second'
    where publication_date = today;
  assert not exists(select 1 from public.claim_gamewaire_push() where publication_date = today), 'Delivered alerts cannot be reclaimed';
  update public.gamewaire_push_deliveries set delivered_at = null, expires_at = now() - interval '1 second'
    where publication_date = today;
  assert not exists(select 1 from public.claim_gamewaire_push() where publication_date = today), 'Expired alerts never send the next day';
end $$;
rollback;
