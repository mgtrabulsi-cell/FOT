-- Keep this function in sync with gamewaire.sql for existing installations.
create or replace function public.gamewaire_claim(target_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare global_amount integer; user_amount integer; current_bucket timestamptz := date_trunc('hour', now());
begin
  insert into public.gamewaire_limits (scope,bucket,attempts) values ('global',current_bucket,0)
  on conflict (scope) do nothing;
  select case when bucket = current_bucket then attempts else 0 end into global_amount
    from public.gamewaire_limits where scope = 'global' for update;
  select case when bucket = current_bucket then attempts else 0 end into user_amount
    from public.gamewaire_limits where scope = target_user::text for update;
  if global_amount >= 20 or coalesce(user_amount,0) >= 6 then return false; end if;
  update public.gamewaire_limits set bucket = current_bucket, attempts = global_amount + 1 where scope = 'global';
  insert into public.gamewaire_limits as limits (scope,user_id,bucket,attempts) values (target_user::text,target_user,current_bucket,1)
  on conflict (scope) do update set bucket = excluded.bucket,
    attempts = coalesce(user_amount,0) + 1;
  return true;
end $$;
revoke all on function public.gamewaire_claim(uuid) from public, anon, authenticated;
grant execute on function public.gamewaire_claim(uuid) to service_role;
