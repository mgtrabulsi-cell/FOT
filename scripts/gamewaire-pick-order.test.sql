-- Run against an installed ordering migration with at least one existing publication.
-- All order writes and authentication changes are rolled back.
begin isolation level repeatable read;
create temporary table before_order_test as select
  (select md5(coalesce(jsonb_agg(p order by p.sport,p.event_id)::text,'')) from public.gamewaire_publications p) publications,
  (select count(*) from public.gamewaire_push_days) push_days,
  (select count(*) from public.gamewaire_push_deliveries) deliveries,
  (select count(*) from public.gamewaire_picks) picks;
select set_config('request.jwt.claim.sub',(select user_id::text from public.gamewaire_admin_account),true);
set local role authenticated;
do $$
declare target date; keys text[]; saved public.gamewaire_pick_orders; old_revision integer;
begin
  select max((event_start at time zone 'America/New_York')::date) into target from (
    select event_start from public.gamewaire_publications
    union all select event_start from public.gamewaire_team_leans
  ) games;
  if target is null then raise exception 'Test requires an existing publication'; end if;
  select array_agg(distinct key order by key desc) into keys from (
    select pick->>'key' as key
      from public.gamewaire_publications p cross join lateral jsonb_array_elements(p.picks) pick
      where (p.event_start at time zone 'America/New_York')::date=target
    union
    select team_lean->'pick'->>'key' from public.gamewaire_team_leans
      where (event_start at time zone 'America/New_York')::date=target and team_lean->'pick'->>'key' is not null
  ) selections;
  select coalesce((select revision from public.gamewaire_pick_orders where game_date=target),0) into old_revision;
  saved:=public.gamewaire_save_pick_order(target,keys,old_revision);
  if saved.pick_keys<>keys or saved.revision<>old_revision+1 then raise exception 'Saved order/revision mismatch'; end if;
  begin
    perform public.gamewaire_save_pick_order(target,keys,old_revision);
    raise exception 'Stale revision incorrectly accepted';
  exception when raise_exception then
    if sqlerrm not like 'Pick order changed%' then raise; end if;
  end;
  begin
    perform public.gamewaire_save_pick_order(target,array['invented'],saved.revision);
    raise exception 'Invalid keys incorrectly accepted';
  exception when raise_exception then
    if sqlerrm not like 'Published picks changed%' then raise; end if;
  end;
  begin
    perform public.gamewaire_save_pick_order(target,array[keys[1],keys[1]],saved.revision);
    raise exception 'Duplicate keys incorrectly accepted';
  exception when raise_exception then
    if sqlerrm not like 'Invalid published pick order%' then raise; end if;
  end;
  begin
    update public.gamewaire_pick_orders set revision=99 where game_date=target;
    raise exception 'Direct table write incorrectly accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
-- Impersonate an unlisted administrator without changing the designated allowlist.
select set_config('request.jwt.claim.sub',coalesce(
  (select user_id::text from public.livewire_roles where user_id<>(select user_id from public.gamewaire_admin_account) and role in ('admin','owner') limit 1),
  '00000000-0000-0000-0000-000000000001'),true);
set local role authenticated;
do $$
begin
  perform count(*) from public.gamewaire_pick_orders;
  begin
    perform public.gamewaire_save_pick_order(current_date,array[]::text[],0);
    raise exception 'Other account incorrectly allowed to reorder';
  exception when raise_exception then
    if sqlerrm not like 'GamewAIre management is restricted%' then raise; end if;
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.gamewaire_pick_orders;
    raise exception 'Guest table read incorrectly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.gamewaire_save_pick_order(current_date,array[]::text[],0);
    raise exception 'Guest RPC incorrectly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if exists(select 1 from before_order_test where
    publications<>(select md5(coalesce(jsonb_agg(p order by p.sport,p.event_id)::text,'')) from public.gamewaire_publications p)
    or push_days<>(select count(*) from public.gamewaire_push_days)
    or deliveries<>(select count(*) from public.gamewaire_push_deliveries)
    or picks<>(select count(*) from public.gamewaire_picks)) then raise exception 'Reordering changed publications, notifications or performance'; end if;
end $$;
rollback;
select 'PASS: owner-only durable ordering, revision conflicts, key validation, member/guest permissions and no publication/push/performance changes; all test writes rolled back' result;
