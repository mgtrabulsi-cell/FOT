begin;

create table if not exists public.livewire_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.livewire_posts(id) on delete cascade,
  primary key (user_id, post_id)
);
alter table public.livewire_reads enable row level security;
revoke all on public.livewire_reads from public, anon, authenticated;
grant select, insert on public.livewire_reads to authenticated;

drop policy if exists "Users read their own LIVEWIRE receipts" on public.livewire_reads;
create policy "Users read their own LIVEWIRE receipts" on public.livewire_reads
for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users create their own LIVEWIRE receipts" on public.livewire_reads;
create policy "Users create their own LIVEWIRE receipts" on public.livewire_reads
for insert to authenticated with check (user_id = auth.uid() and not public.account_deletion_in_progress());

create or replace function public.livewire_unread_count() returns bigint
language sql stable security invoker set search_path = ''
as $$
  select count(*) from public.livewire_posts post
  where not exists (
    select 1 from public.livewire_reads receipt
    where receipt.user_id = auth.uid() and receipt.post_id = post.id
  )
$$;
revoke all on function public.livewire_unread_count() from public, anon;
grant execute on function public.livewire_unread_count() to authenticated;

notify pgrst, 'reload schema';
commit;
