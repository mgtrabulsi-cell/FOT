begin;

alter table public.livewire_posts add column if not exists view_count bigint not null default 0
  check (view_count >= 0);

create table if not exists public.livewire_owner_views (
  post_id uuid not null references public.livewire_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (post_id, user_id)
);
alter table public.livewire_owner_views enable row level security;
revoke all on public.livewire_owner_views from public, anon, authenticated;

create or replace function public.record_livewire_view(post_id uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare total bigint;
begin
  select post.view_count into total from public.livewire_posts post
  where post.id = record_livewire_view.post_id for update;
  if total is null then raise exception 'Post is no longer available'; end if;

  if public.livewire_role() in ('owner','admin') then return total; end if;

  update public.livewire_posts post set view_count = post.view_count + 1
  where post.id = record_livewire_view.post_id returning post.view_count into total;
  return total;
end;
$$;
revoke all on function public.record_livewire_view(uuid) from public;
grant execute on function public.record_livewire_view(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
