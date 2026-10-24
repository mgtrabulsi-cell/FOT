begin;

create table if not exists public.guest_site_opens (
  session_id uuid primary key,
  open_count bigint not null default 1 check (open_count > 0),
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now()
);
alter table public.guest_site_opens enable row level security;
revoke all on public.guest_site_opens from public, anon, authenticated;

create or replace function public.record_guest_site_open(guest_session uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null then return; end if;
  if guest_session is null then raise exception 'Guest session is required'; end if;
  insert into public.guest_site_opens as opens(session_id) values (guest_session)
  on conflict (session_id) do update
    set open_count = opens.open_count + 1, last_opened_at = now()
    where opens.last_opened_at < now() - interval '30 seconds';
end;
$$;
revoke all on function public.record_guest_site_open(uuid) from public, authenticated;
grant execute on function public.record_guest_site_open(uuid) to anon;

create or replace function public.owner_guest_activity()
returns table(sessions bigint, total_opens bigint, active_week bigint, last_opened_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce(public.livewire_role(), '') not in ('owner', 'admin') then raise exception 'Admin access is required'; end if;
  return query select count(*), coalesce(sum(opens.open_count),0)::bigint,
    count(*) filter (where opens.last_opened_at > now() - interval '7 days'), max(opens.last_opened_at)
  from public.guest_site_opens opens;
end;
$$;
revoke all on function public.owner_guest_activity() from public, anon;
grant execute on function public.owner_guest_activity() to authenticated;
notify pgrst, 'reload schema';
commit;
