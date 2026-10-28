begin;

-- A singleton allowlist pins GamewAIre management to the existing owner account.
create table if not exists public.gamewaire_admin_account (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade
);
alter table public.gamewaire_admin_account enable row level security;
revoke all on public.gamewaire_admin_account from public, anon, authenticated;
grant select on public.gamewaire_admin_account to service_role;
do $$
begin
  if not exists(select 1 from public.gamewaire_admin_account) then
    if (select count(*) from public.livewire_roles where role='owner') <> 1 then
      raise exception 'Select exactly one owner account before configuring GamewAIre access';
    end if;
    insert into public.gamewaire_admin_account(user_id)
    select user_id from public.livewire_roles where role='owner';
  end if;
end $$;

create or replace function public.gamewaire_can_admin() returns boolean
language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.gamewaire_admin_account allowed
    join public.livewire_roles actor on actor.user_id=allowed.user_id
    where allowed.user_id=auth.uid() and actor.role in ('owner','admin')
  );
$$;
revoke all on function public.gamewaire_can_admin() from public, anon;
grant execute on function public.gamewaire_can_admin() to authenticated;

drop policy if exists "Members read GamewAIre runs" on public.gamewaire_runs;
drop policy if exists "Admins read candidate GamewAIre runs" on public.gamewaire_runs;
create policy "Admins read candidate GamewAIre runs" on public.gamewaire_runs
for select to authenticated using (public.gamewaire_can_admin());
drop policy if exists "Admins read analysis schedules" on public.gamewaire_schedule_batches;
create policy "Admins read analysis schedules" on public.gamewaire_schedule_batches
for select to authenticated using (public.gamewaire_can_admin());
drop policy if exists "Admins read scheduled analyses" on public.gamewaire_schedule_jobs;
create policy "Admins read scheduled analyses" on public.gamewaire_schedule_jobs
for select to authenticated using (public.gamewaire_can_admin());

notify pgrst,'reload schema';
commit;
