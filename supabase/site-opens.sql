begin;

create table if not exists public.site_opens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  open_count bigint not null default 0 check (open_count >= 0),
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now()
);
alter table public.site_opens enable row level security;
revoke all on public.site_opens from public, anon, authenticated;

-- Opens within 30 seconds of the last one (reloads, double mounts) are not counted again.
create or replace function public.record_site_open() returns bigint
language plpgsql security definer set search_path = ''
as $$
declare total bigint;
begin
  if auth.uid() is null then return null; end if;
  insert into public.site_opens as opens(user_id, open_count) values (auth.uid(), 1)
  on conflict (user_id) do update
    set open_count = opens.open_count + 1, last_opened_at = now()
    where opens.last_opened_at < now() - interval '30 seconds'
  returning opens.open_count into total;
  if total is null then
    select opens.open_count into total from public.site_opens opens where opens.user_id = auth.uid();
  end if;
  return total;
end;
$$;
revoke all on function public.record_site_open() from public, anon;
grant execute on function public.record_site_open() to authenticated;

create or replace function public.owner_user_activity()
returns table(user_id uuid, email text, display_name text, joined_at timestamptz, last_sign_in_at timestamptz, open_count bigint, last_opened_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if public.livewire_role() is distinct from 'owner' then raise exception 'Owner access is required'; end if;
  return query
    select u.id, u.email::text, nullif(btrim(u.raw_user_meta_data->>'display_name'), ''), u.created_at, u.last_sign_in_at,
      coalesce(o.open_count, 0)::bigint, o.last_opened_at
    from auth.users u
    left join public.site_opens o on o.user_id = u.id
    where u.deleted_at is null and not coalesce(u.is_anonymous, false)
    order by coalesce(o.open_count, 0) desc, u.created_at desc;
end;
$$;
revoke all on function public.owner_user_activity() from public, anon;
grant execute on function public.owner_user_activity() to authenticated;

notify pgrst, 'reload schema';
commit;
