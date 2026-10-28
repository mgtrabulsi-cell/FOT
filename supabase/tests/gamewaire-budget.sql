begin;
do $$
declare target uuid; i integer; amount integer;
begin
  select id into target from auth.users order by created_at limit 1;
  if target is null then raise exception 'An existing account is required for budget tests'; end if;
  insert into public.gamewaire_limits (scope,bucket,attempts) values ('global',date_trunc('hour',now()),0)
    on conflict (scope) do update set bucket = excluded.bucket, attempts = 0;
  insert into public.gamewaire_limits (scope,user_id,bucket,attempts) values (target::text,target,date_trunc('hour',now()),0)
    on conflict (scope) do update set bucket = excluded.bucket, attempts = 0;
  for i in 1..6 loop
    if not public.gamewaire_claim(target) then raise exception 'The first six analysis requests must be accepted'; end if;
  end loop;
  for i in 1..3 loop
    if public.gamewaire_claim(target) then raise exception 'User cap must reject excess requests'; end if;
  end loop;
  select attempts into amount from public.gamewaire_limits where scope = 'global';
  if amount <> 6 then raise exception 'User-limited retries must not consume global slots'; end if;
  select attempts into amount from public.gamewaire_limits where scope = target::text;
  if amount <> 6 then raise exception 'Rejected retries must not increase the user counter'; end if;
  update public.gamewaire_limits set attempts = 20 where scope = 'global';
  update public.gamewaire_limits set attempts = 0 where scope = target::text;
  if public.gamewaire_claim(target) then raise exception 'Global cap must reject excess requests'; end if;
  select attempts into amount from public.gamewaire_limits where scope = 'global';
  if amount <> 20 then raise exception 'Rejected retries must not increase the global counter'; end if;
  select attempts into amount from public.gamewaire_limits where scope = target::text;
  if amount <> 0 then raise exception 'Global-limited retries must not consume user slots'; end if;
  update public.gamewaire_limits set bucket = date_trunc('hour',now()) - interval '1 hour', attempts = 99
    where scope in ('global',target::text);
  if not public.gamewaire_claim(target) then raise exception 'A new hour must reset both budgets'; end if;
  if exists (select 1 from public.gamewaire_limits where scope in ('global',target::text)
    and (attempts <> 1 or bucket <> date_trunc('hour',now()))) then raise exception 'Reset counters must start at one'; end if;
end $$;
set local role authenticated;
do $$
begin
  begin
    perform public.gamewaire_claim('00000000-0000-0000-0000-000000000001');
    raise exception 'Clients must not be able to claim provider budget';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
