begin;

create or replace function public.record_site_open() returns bigint
language plpgsql security definer set search_path = ''
as $$
declare total bigint;
begin
  if auth.uid() is null then return null; end if;
  if public.livewire_role() = 'owner' then return null; end if;
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

create or replace function public.record_livewire_view(post_id uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare total bigint;
begin
  select post.view_count into total from public.livewire_posts post
  where post.id = record_livewire_view.post_id for update;
  if total is null then raise exception 'Post is no longer available'; end if;
  if public.livewire_role() = 'owner' then return total; end if;
  update public.livewire_posts post set view_count = post.view_count + 1
  where post.id = record_livewire_view.post_id returning post.view_count into total;
  return total;
end;
$$;

create or replace function public.record_angle_view(story_id uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare total bigint; actor_role text;
begin
  perform 1 from public.angles where id = story_id and status = 'published' for share;
  if not found then raise exception 'Storyline is no longer published'; end if;
  actor_role := public.livewire_role();
  if actor_role = 'owner' then
    return coalesce((select view_count from public.angle_view_counts where angle_id = story_id), 0);
  end if;
  insert into public.angle_view_counts(angle_id, view_count) values (story_id, 1)
  on conflict(angle_id) do update set view_count = public.angle_view_counts.view_count + 1
  returning view_count into total;
  if actor_role = 'admin' then return total; end if;
  return null;
end;
$$;

-- The old implementation recorded exactly one owner view per receipt.
-- Consuming those receipts makes the correction safe to rerun.
with removed as (
  delete from public.livewire_owner_views returning post_id
), counts as (
  select post_id, count(*) as total from removed group by post_id
)
update public.livewire_posts post set view_count = greatest(0, post.view_count - counts.total)
from counts where post.id = counts.post_id;
with removed as (
  delete from public.angle_owner_views returning angle_id
), counts as (
  select angle_id, count(*) as total from removed group by angle_id
)
update public.angle_view_counts views set view_count = greatest(0, views.view_count - counts.total)
from counts where views.angle_id = counts.angle_id;
delete from public.site_opens opens using public.livewire_roles actor
where opens.user_id = actor.user_id and actor.role = 'owner';

notify pgrst, 'reload schema';
commit;
