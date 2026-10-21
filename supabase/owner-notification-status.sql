begin;

-- A new result shape requires recreating the RPC; keep its owner-only access check.
drop function public.owner_user_activity();
create function public.owner_user_activity()
returns table(user_id uuid, email text, display_name text, joined_at timestamptz, last_sign_in_at timestamptz,
  open_count bigint, last_opened_at timestamptz, notification_devices bigint, score_alert_devices bigint)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if public.livewire_role() is distinct from 'owner' then raise exception 'Owner access is required'; end if;
  return query
    select u.id, u.email::text, nullif(btrim(u.raw_user_meta_data->>'display_name'), ''), u.created_at, u.last_sign_in_at,
      coalesce(o.open_count, 0)::bigint, o.last_opened_at,
      coalesce(push.devices, 0)::bigint, coalesce(push.score_devices, 0)::bigint
    from auth.users u
    left join public.site_opens o on o.user_id = u.id
    left join (
      select user_id, count(*) as devices, count(*) filter (where notify_scores) as score_devices
      from public.user_push_subscriptions group by user_id
    ) push on push.user_id = u.id
    where u.deleted_at is null and not coalesce(u.is_anonymous, false)
    order by coalesce(o.open_count, 0) desc, u.created_at desc;
end;
$$;
revoke all on function public.owner_user_activity() from public, anon;
grant execute on function public.owner_user_activity() to authenticated;

notify pgrst, 'reload schema';
commit;
