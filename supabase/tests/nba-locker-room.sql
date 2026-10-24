begin;
insert into auth.users(id,email) values
 ('b9703333-3333-4333-8333-333333333331','nba-locker-one@example.test'),
 ('b9703333-3333-4333-8333-333333333332','nba-locker-two@example.test');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9703333-3333-4333-8333-333333333331',true);
select public.save_locker_room_daily_history('2026-10-23',
 '[{"key":"player:NBA:123:favorite","payload":{"kind":"player","favorite":{"key":"player:basketball/nba:1"},"game":{"id":"NBA:123","league":"NBA","status":"FINAL"},"stats":{"points":0,"rebounds":12}},"observed_at":"2026-10-23T23:00:00Z"}]');
select public.save_locker_room_daily_history('2026-10-23',
 '[{"key":"player:NBA:123:favorite","payload":{"kind":"player","game":{"league":"NBA","status":"LIVE"},"stats":{"points":100}},"observed_at":"2026-10-24T01:00:00Z"}]');
do $$ begin
  assert (select payload->'stats'->>'points'='0' from public.locker_room_daily_history where activity_date='2026-10-23'),'Final stats remain stable';
  begin
    perform public.save_locker_room_daily_history('2026-10-24','[]','b9703333-3333-4333-8333-333333333332');
    raise exception 'Cross-account write succeeded';
  exception when raise_exception then if sqlerrm <> 'Sign in to save Locker Room history' then raise; end if; end;
end; $$;
select public.save_locker_room_daily_history('2026-10-24',
 '[{"key":"news:test","payload":{"kind":"news","headline":"NBA headline"},"observed_at":"2026-10-24T14:00:00Z"}]');
select set_config('request.jwt.claim.sub','b9703333-3333-4333-8333-333333333332',true);
do $$ begin assert (select count(*)=0 from public.locker_room_daily_history),'Other accounts cannot read history'; end; $$;
reset role;
do $$ begin
  assert (select count(*)=2 from public.locker_room_daily_history where user_id='b9703333-3333-4333-8333-333333333331'),'Separate dates retained';
end; $$;
delete from auth.users where id='b9703333-3333-4333-8333-333333333331';
do $$ begin
  assert not exists(select 1 from public.locker_room_daily_history where user_id='b9703333-3333-4333-8333-333333333331'),'Deleting account removes NBA history';
end; $$;
rollback;
