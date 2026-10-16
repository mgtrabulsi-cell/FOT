begin;

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
alter table public.livewire_posts add column if not exists title text
  check (title is null or char_length(btrim(title)) between 1 and 120);
alter table public.livewire_posts add column if not exists image_paths text[] not null default '{}'
  check (cardinality(image_paths) <= 4 and array_position(image_paths, null) is null);
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('livewire-photos', 'livewire-photos', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
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

drop policy if exists "Admins upload LIVEWIRE photos" on storage.objects;
create policy "Admins upload LIVEWIRE photos" on storage.objects for insert to authenticated
with check (bucket_id = 'livewire-photos' and (storage.foldername(name))[1] = auth.uid()::text
  and public.livewire_role() in ('owner','admin'));
drop policy if exists "Admins read own LIVEWIRE upload metadata" on storage.objects;
create policy "Admins read own LIVEWIRE upload metadata" on storage.objects for select to authenticated
using (bucket_id = 'livewire-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.livewire_role() in ('owner','admin'));
drop policy if exists "Admins clean unused LIVEWIRE uploads" on storage.objects;
create policy "Admins clean unused LIVEWIRE uploads" on storage.objects for delete to authenticated
using (bucket_id = 'livewire-photos' and (storage.foldername(name))[1] = auth.uid()::text
  and public.livewire_role() in ('owner','admin')
  and not exists(select 1 from public.livewire_posts where name = any(image_paths)));

drop function if exists public.save_livewire_post(text,text,uuid);
drop function if exists public.save_livewire_post(text,text,uuid,text);
create or replace function public.save_livewire_post(post_body text, post_source text default null, post_id uuid default null, post_title text default null, post_images text[] default null)
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
  if post_title is not null and char_length(btrim(post_title)) not between 1 and 120 then
    raise exception 'Titles must contain 1 to 120 characters';
  end if;
  if post_images is not null then
    if cardinality(post_images) > 4 or array_position(post_images, null) is not null then
      raise exception 'Attach at most four photos';
    end if;
    if exists (
      select 1 from unnest(post_images) as photo(path)
      where not exists (
        select 1 from storage.objects as object where object.bucket_id = 'livewire-photos' and object.name = photo.path
        and (split_part(photo.path, '/', 1) = actor.user_id::text or exists (
          select 1 from public.livewire_posts as post where post.id = post_id
          and (post.author_id = actor.user_id or actor.role = 'owner') and photo.path = any(post.image_paths)
        ))
      )
    ) then raise exception 'Photo not found or attachment is not permitted'; end if;
  end if;
  post_source := nullif(btrim(post_source), '');
  if post_source is not null and (char_length(post_source) > 2048 or post_source !~* '^https?://[^[:space:]]+$') then
    raise exception 'Use a valid http or https news link';
  end if;
  if post_id is null then
    insert into public.livewire_posts(author_id, author_name, title, body, source_url, image_paths)
    values (actor.user_id, actor.display_name, btrim(post_title), btrim(post_body), post_source, coalesce(post_images, '{}')) returning id into result;
  else
    update public.livewire_posts set title = coalesce(btrim(post_title), title), body = btrim(post_body), source_url = post_source,
      image_paths = coalesce(post_images, image_paths), updated_at = clock_timestamp()
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
revoke all on function public.save_livewire_post(text,text,uuid,text,text[]), public.delete_livewire_post(uuid),
  public.manage_livewire_admin(text,uuid) from public, anon;
grant execute on function public.save_livewire_post(text,text,uuid,text,text[]), public.delete_livewire_post(uuid),
  public.manage_livewire_admin(text,uuid) to authenticated;

commit;
