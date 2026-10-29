begin;
create table if not exists public.gamewaire_pick_orders (
  game_date date primary key,
  pick_keys text[] not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.gamewaire_pick_orders enable row level security;
revoke all on public.gamewaire_pick_orders from public,anon,authenticated;
grant select on public.gamewaire_pick_orders to authenticated;
grant all on public.gamewaire_pick_orders to service_role;
drop policy if exists "Members read published pick order" on public.gamewaire_pick_orders;
create policy "Members read published pick order" on public.gamewaire_pick_orders for select to authenticated using(true);

create or replace function public.gamewaire_save_pick_order(target_date date, ordered_keys text[], expected_revision integer)
returns public.gamewaire_pick_orders language plpgsql security definer set search_path='' as $$
declare saved public.gamewaire_pick_orders; available text[];
begin
  if not public.gamewaire_can_admin() then raise exception 'GamewAIre management is restricted to the designated account'; end if;
  if target_date is null or ordered_keys is null
    or cardinality(ordered_keys)>200 or expected_revision is null or expected_revision<0
    or cardinality(ordered_keys)<>(select count(distinct value) from unnest(ordered_keys) value)
    then raise exception 'Invalid published pick order'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gamewaire-order:'||target_date::text,0));
  select * into saved from public.gamewaire_pick_orders where game_date=target_date for update;
  if coalesce(saved.revision,0)<>expected_revision then raise exception 'Pick order changed in another window. Reload before saving'; end if;
  select array_agg(distinct pick->>'key' order by pick->>'key') into available
    from public.gamewaire_publications publication cross join lateral jsonb_array_elements(publication.picks) pick
    where (publication.event_start at time zone 'America/New_York')::date=target_date;
  if (select array_agg(value order by value) from unnest(ordered_keys) value) is distinct from available
    then raise exception 'Published picks changed. Reload the published list before saving'; end if;
  insert into public.gamewaire_pick_orders(game_date,pick_keys,revision)
    values(target_date,ordered_keys,expected_revision+1)
  on conflict(game_date) do update set pick_keys=excluded.pick_keys,revision=excluded.revision,updated_at=now()
  returning * into saved;
  return saved;
end $$;
revoke all on function public.gamewaire_save_pick_order(date,text[],integer) from public,anon;
grant execute on function public.gamewaire_save_pick_order(date,text[],integer) to authenticated;
notify pgrst,'reload schema';
commit;
