begin;
create table if not exists public.angle_view_counts (
  angle_id uuid primary key references public.angles(id) on delete cascade,
  view_count bigint not null default 0 check(view_count >= 0)
);
create table if not exists public.angle_owner_views (
  angle_id uuid not null references public.angles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key(angle_id,user_id)
);
alter table public.angle_view_counts enable row level security;
alter table public.angle_owner_views enable row level security;
revoke all on public.angle_view_counts, public.angle_owner_views from public, anon, authenticated;
grant select on public.angle_view_counts to authenticated;
drop policy if exists "Admins read Angle counts" on public.angle_view_counts;
create policy "Admins read Angle counts" on public.angle_view_counts for select to authenticated
using(public.livewire_role() in ('owner','admin'));

create or replace function public.record_angle_view(story_id uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare total bigint; actor_role text;
begin
  perform 1 from public.angles where id=story_id and status='published' for share;
  if not found then raise exception 'Storyline is no longer published'; end if;
  actor_role:=public.livewire_role();
  if actor_role in ('owner','admin') then
    return coalesce((select view_count from public.angle_view_counts where angle_id=story_id),0);
  end if;
  insert into public.angle_view_counts(angle_id,view_count) values(story_id,1)
  on conflict(angle_id) do update set view_count=public.angle_view_counts.view_count+1
  returning view_count into total;
  if actor_role in ('owner','admin') then return total; end if;
  return null;
end;
$$;
revoke all on function public.record_angle_view(uuid) from public;
grant execute on function public.record_angle_view(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
