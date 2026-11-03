begin;
insert into public.live_feed_games(sport,provider_game_id,start_time,away_name,home_name,away_score,home_score,status)
values ('NFL','test-game',now(),'Test Away','Test Home',10,14,'LIVE')
on conflict (sport,provider_game_id) do nothing;
insert into public.live_feed_state(sport,day,requests_used,last_polled_at)
values ('NFL',current_date,2,now())
on conflict (sport) do nothing;
insert into public.live_feed_game_details(sport,provider_game_id,status,payload)
values ('NFL','test-game','LIVE','{"status":"LIVE"}')
on conflict (sport,provider_game_id) do nothing;
insert into public.live_feed_team_games(sport,season,provider_game_id,api_team_id,team_name,game_date,points_for,points_against)
values ('NFL',2026,'test-game','18','Test Home','2026-11-01',27,10)
on conflict (sport,provider_game_id,api_team_id) do nothing;
insert into public.live_feed_season_state(sport,season,finals_total,finals_synced)
values ('NFL',2026,1,1)
on conflict (sport,season) do nothing;
set local role anon;
select provider_game_id from public.live_feed_games where provider_game_id='test-game';
select sport from public.live_feed_state where sport='NFL';
select provider_game_id from public.live_feed_game_details where provider_game_id='test-game';
select api_team_id from public.live_feed_team_games where provider_game_id='test-game';
select finals_total from public.live_feed_season_state where sport='NFL';
do $$
begin
  begin
    insert into public.live_feed_team_games(sport,season,provider_game_id,api_team_id,team_name,game_date)
    values ('NFL',2026,'forbidden','1','A','2026-11-01');
    raise exception 'Anonymous season game writes must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$
begin
  begin
    insert into public.live_feed_game_details(sport,provider_game_id,status,payload)
    values ('NFL','forbidden-detail','LIVE','{}');
    raise exception 'Anonymous game detail writes must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
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
