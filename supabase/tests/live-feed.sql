begin;
insert into public.live_feed_games(sport,provider_game_id,start_time,away_name,home_name,away_score,home_score,status)
values ('NFL','test-game',now(),'Test Away','Test Home',10,14,'LIVE')
on conflict (sport,provider_game_id) do nothing;
insert into public.live_feed_state(sport,day,requests_used,last_polled_at)
values ('NFL',current_date,2,now())
on conflict (sport) do nothing;
set local role anon;
select provider_game_id from public.live_feed_games where provider_game_id='test-game';
select sport from public.live_feed_state where sport='NFL';
do $$
begin
  begin
    insert into public.live_feed_games(sport,provider_game_id,start_time,away_name,home_name,status)
    values ('NFL','forbidden',now(),'A','B','LIVE');
    raise exception 'Anonymous live feed writes must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
do $$
begin
  begin
    delete from public.live_feed_games where provider_game_id='test-game';
    raise exception 'Authenticated live feed writes must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$
begin
  begin
    update public.live_feed_state set requests_used=0 where sport='NFL';
    raise exception 'Authenticated live feed state writes must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
