begin;

create table if not exists public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;

create or replace function public.account_deletion_in_progress() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.account_deletion_requests where user_id = auth.uid()) $$;
revoke all on function public.account_deletion_in_progress() from public, anon;
grant execute on function public.account_deletion_in_progress() to authenticated;

drop policy if exists "Deleting accounts cannot upload files" on storage.objects;
create policy "Deleting accounts cannot upload files" on storage.objects as restrictive
for insert to authenticated with check (not public.account_deletion_in_progress());
drop policy if exists "Deleting accounts cannot update files" on storage.objects;
create policy "Deleting accounts cannot update files" on storage.objects as restrictive
for update to authenticated using (not public.account_deletion_in_progress())
with check (not public.account_deletion_in_progress());

create or replace function public.prepare_account_deletion(target_user uuid)
returns table(bucket_id text, name text)
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from auth.users where id = target_user for update;
  if not found then raise exception 'Account not found'; end if;
  insert into public.account_deletion_requests(user_id) values(target_user) on conflict do nothing;
  return query
    select object.bucket_id, object.name from storage.objects object
    where object.owner_id = target_user::text or object.owner = target_user
      or (object.bucket_id = 'livewire-photos' and (
        split_part(object.name, '/', 1) = target_user::text
        or exists(select 1 from public.livewire_posts post where post.author_id = target_user and object.name = any(post.image_paths))
      ))
    order by object.bucket_id, object.name limit 100;
end;
$$;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

create or replace function public.remove_deleted_account_content() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists(select 1 from storage.objects object
    where object.owner_id = old.id::text or object.owner = old.id
      or (object.bucket_id = 'livewire-photos' and (
        split_part(object.name, '/', 1) = old.id::text
        or exists(select 1 from public.livewire_posts post where post.author_id = old.id and object.name = any(post.image_paths))
      ))) then
    raise exception 'Remove account uploads using the Storage API before deleting this account';
  end if;
  delete from public.livewire_posts where author_id = old.id;
  return old;
end;
$$;
revoke all on function public.remove_deleted_account_content() from public, anon, authenticated;
drop trigger if exists remove_account_content on auth.users;
create trigger remove_account_content before delete on auth.users
for each row execute function public.remove_deleted_account_content();

commit;
