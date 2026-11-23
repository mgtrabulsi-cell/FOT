begin;

-- Preserve historical prices/results and all other publication safeguards.
create or replace function public.gamewaire_prop_price_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare candidate jsonb;
begin
  if tg_table_name='gamewaire_picks' then
    if tg_op='UPDATE' and old.american=new.american and old.market=new.market then return new; end if;
    if new.market like 'player\_%' escape '\' and abs(new.american)<100 then
      raise exception 'Player props require valid American odds';
    end if;
    return new;
  end if;
  for candidate in select value from jsonb_array_elements(new.picks) loop
    if tg_op='UPDATE' then
      if old.picks @> jsonb_build_array(candidate) then continue; end if;
    end if;
    if candidate->>'market' like 'player\_%' escape '\' and
      (jsonb_typeof(candidate->'american') is distinct from 'number'
        or abs((candidate->>'american')::numeric)<100) then
      raise exception 'New player-prop publications require valid American odds';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.gamewaire_prop_price_guard() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
