create table if not exists public.livewire_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin')),
  display_name text not null
);
create table if not exists public.livewire_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  source_url text check (source_url is null or (char_length(source_url) <= 2048 and source_url ~* '^https?://[^[:space:]]+$')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists livewire_posts_created_idx on public.livewire_posts(created_at desc, id desc);
alter table public.livewire_roles enable row level security;
alter table public.livewire_posts enable row level security;

create or replace function public.livewire_role() returns text
language sql stable security definer set search_path = ''
as $$ select role from public.livewire_roles where user_id = auth.uid() $$;
revoke all on function public.livewire_role() from public, anon;
grant execute on function public.livewire_role() to authenticated;

drop policy if exists "Read LIVEWIRE roles" on public.livewire_roles;
create policy "Read LIVEWIRE roles" on public.livewire_roles for select to authenticated
using (user_id = auth.uid() or public.livewire_role() = 'owner');
drop policy if exists "Read public LIVEWIRE posts" on public.livewire_posts;
create policy "Read public LIVEWIRE posts" on public.livewire_posts for select to anon, authenticated using (true);
revoke all on public.livewire_roles, public.livewire_posts from public, anon, authenticated;
grant select on public.livewire_posts to anon, authenticated;
grant select on public.livewire_roles to authenticated;

create or replace function public.save_livewire_post(post_body text, post_source text default null, post_id uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  actor public.livewire_roles;
  result uuid;
begin
  select * into actor from public.livewire_roles where user_id = auth.uid();
  if actor.user_id is null then raise exception 'Admin access is required to publish'; end if;
  if post_body is null or char_length(btrim(post_body)) not between 1 and 500 then
    raise exception 'Posts must contain 1 to 500 characters';
  end if;
  post_source := nullif(btrim(post_source), '');
  if post_source is not null and (char_length(post_source) > 2048 or post_source !~* '^https?://[^[:space:]]+$') then
    raise exception 'Use a valid http or https news link';
  end if;
  if post_id is null then
    insert into public.livewire_posts(author_id, author_name, body, source_url)
    values (actor.user_id, actor.display_name, btrim(post_body), post_source) returning id into result;
  else
    update public.livewire_posts set body = btrim(post_body), source_url = post_source, updated_at = clock_timestamp()
    where id = post_id and (author_id = actor.user_id or actor.role = 'owner') returning id into result;
    if result is null then raise exception 'Post not found or editing is not permitted'; end if;
  end if;
  return result;
end;
$$;

create or replace function public.delete_livewire_post(post_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.livewire_role() is null then raise exception 'Admin access is required'; end if;
  delete from public.livewire_posts where id = post_id
    and (author_id = auth.uid() or public.livewire_role() = 'owner');
  if not found then raise exception 'Post not found or deletion is not permitted'; end if;
end;
$$;

create or replace function public.manage_livewire_admin(account_email text default null, remove_user uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare target_id uuid; target_name text;
begin
  if public.livewire_role() is distinct from 'owner' then raise exception 'Only the owner can manage admins'; end if;
  if remove_user is not null then
    delete from public.livewire_roles where user_id = remove_user and role = 'admin';
    if not found then raise exception 'Admin not found; owner access cannot be removed here'; end if;
  else
    select id, coalesce(nullif(btrim(raw_user_meta_data->>'display_name'), ''), 'GameWire Admin')
    into target_id, target_name from auth.users where lower(email) = lower(btrim(account_email));
    if target_id is null then raise exception 'No account found. Ask this person to sign up first'; end if;
    insert into public.livewire_roles(user_id, role, display_name) values(target_id, 'admin', left(target_name, 80))
    on conflict(user_id) do nothing;
  end if;
end;
$$;
revoke all on function public.save_livewire_post(text,text,uuid), public.delete_livewire_post(uuid),
  public.manage_livewire_admin(text,uuid) from public, anon;
grant execute on function public.save_livewire_post(text,text,uuid), public.delete_livewire_post(uuid),
  public.manage_livewire_admin(text,uuid) to authenticated;
