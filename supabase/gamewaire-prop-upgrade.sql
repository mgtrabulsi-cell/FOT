begin;

do $$
declare table_name text; signature text; definition text;
begin
  foreach table_name in array array['gamewaire_runs','gamewaire_picks','gamewaire_publications',
    'gamewaire_team_leans','gamewaire_analysis_locks','gamewaire_schedule_batches','gamewaire_schedule_jobs'] loop
    execute format('alter table public.%I drop constraint if exists %I',table_name,table_name||'_sport_check');
    execute format('alter table public.%I add constraint %I check (sport in (''NFL'',''NBA'',''EPL'',''Serie A'',''La Liga'',''Bundesliga'',''Champions League''))',
      table_name,table_name||'_sport_check');
  end loop;
  foreach signature in array array['public.gamewaire_publish_lean(uuid)',
    'public.gamewaire_soccer_publication_guard()',
    'public.gamewaire_schedule_plan(text,date,jsonb,text,text,text)',
    'public.gamewaire_schedule_claim()'] loop
    if to_regprocedure(signature) is null then raise exception 'Missing prerequisite: %',signature; end if;
    definition:=pg_get_functiondef(to_regprocedure(signature));
    if position('''Champions League''' in definition)=0 then
      definition:=replace(definition,'''Bundesliga''','''Bundesliga'',''Champions League''');
    end if;
    definition:=replace(replace(definition,'''soccer-evidence-v1''','''soccer-probability-v3'''),
      '''soccer-probability-v2''','''soccer-probability-v3''');
    execute definition;
  end loop;
end $$;

alter table public.gamewaire_picks drop constraint if exists gamewaire_soccer_three_way_settlement;
alter table public.gamewaire_picks add constraint gamewaire_soccer_three_way_settlement check (
  sport not in ('EPL','Serie A','La Liga','Bundesliga','Champions League') or market<>'h2h' or (push_probability=0 and result<>'push'));

create or replace function public.gamewaire_prop_price_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare candidate jsonb;
begin
  if tg_table_name='gamewaire_picks' then
    if tg_op='UPDATE' and old.american=new.american and old.market=new.market then return new; end if;
    if new.market like 'player\_%' escape '\' and new.event_start>now() and new.american < -200 then
      raise exception 'Player props require -200 or longer odds';
    end if;
    return new;
  end if;
  for candidate in select value from jsonb_array_elements(new.picks) loop
    if tg_op='UPDATE' then
      if old.picks @> jsonb_build_array(candidate) then continue; end if;
    end if;
    if candidate->>'market' like 'player\_%' escape '\' and
      (jsonb_typeof(candidate->'american') is distinct from 'number'
        or (candidate->>'american')::numeric < -200 or abs((candidate->>'american')::numeric)<100) then
      raise exception 'New player-prop publications require valid -200 or longer odds';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.gamewaire_prop_price_guard() from public,anon,authenticated;
drop trigger if exists gamewaire_prop_price_publication_guard on public.gamewaire_publications;
create trigger gamewaire_prop_price_publication_guard before insert or update on public.gamewaire_publications
for each row execute function public.gamewaire_prop_price_guard();
drop trigger if exists gamewaire_prop_price_pick_guard on public.gamewaire_picks;
create trigger gamewaire_prop_price_pick_guard before insert or update of american,market on public.gamewaire_picks
for each row execute function public.gamewaire_prop_price_guard();
notify pgrst,'reload schema';
commit;
