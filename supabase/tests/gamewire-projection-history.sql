begin;
do $$
declare future jsonb; saved public.gamewire_player_forecasts; locked uuid; denied boolean;
begin
  future := jsonb_build_object('player_id','999999999991','team_id','23','position','RB','season',2026,'week',8,'format','ppr',
    'event_id','999999991','event_start',now()+interval '1 day','opponent','Fixture opponent','model_version','fixture',
    'projections','[{"market":"player_rush_yds","label":"Rushing yards","base":75,"estimate":75}]'::jsonb);
  assert public.gamewire_save_forecast(future), 'Pregame forecast is recorded';
  select * into saved from public.gamewire_player_forecasts where player_id='999999999991';
  assert saved.forecast_at < saved.event_start and saved.actuals is null, 'No fabricated actuals or postgame forecast';
  assert public.gamewire_save_forecast(jsonb_set(future,'{projections,0,estimate}','80')), 'Pregame refresh is permitted';
  assert (select (projections->0->>'estimate')::numeric=80 from public.gamewire_player_forecasts where id=saved.id), 'Latest pregame estimate persists';
  assert not public.gamewire_save_forecast(jsonb_set(future,'{event_start}',to_jsonb(now()-interval '1 hour'))), 'No backfilled predictions';
  insert into public.gamewire_player_forecasts(player_id,team_id,position,season,week,format,event_id,event_start,opponent,model_version,forecast_at,projections)
    values('999999999992','23','RB',2026,7,'ppr','999999992',now()-interval '1 hour','Fixture','fixture',now()-interval '1 day',
      '[{"market":"player_rush_yds","label":"Rushing yards","base":75,"estimate":75}]') returning id into locked;
  denied := false;
  begin update public.gamewire_player_forecasts set projections='[]' where id=locked;
  exception when raise_exception then denied := true; end;
  assert denied,'Forecast is immutable after kickoff';
  update public.gamewire_player_forecasts set actuals='{"player_rush_yds":0}',settled_at=clock_timestamp() where id=locked;
  assert (select actuals->>'player_rush_yds'='0' and projections->0->>'estimate'='75' from public.gamewire_player_forecasts where id=locked), 'Actual zero is saved without changing projection';
  assert not has_table_privilege('authenticated','public.gamewire_player_forecasts','SELECT'), 'No direct member access to archive';
  assert not has_function_privilege('authenticated','public.gamewire_save_forecast(jsonb)','EXECUTE'), 'Members cannot invent archived forecasts';
  assert has_function_privilege('service_role','public.gamewire_save_forecast(jsonb)','EXECUTE'), 'Verified server can archive';
end $$;
rollback;
select 'Projection archival timing, immutable kickoff snapshots, real zero and service-only permissions passed' as result;
