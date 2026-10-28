begin;

create or replace function public.record_site_open() returns bigint
language plpgsql security definer set search_path = ''
as $$
declare total bigint;
begin
  if auth.uid() is null then return null; end if;
  if public.livewire_role() in ('owner','admin') then return null; end if;
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

create or replace function public.record_angle_view(story_id uuid) returns bigint
language plpgsql security definer set search_path=''
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
  insert into public.post_view_receipts(surface,post_id,user_id,guest)
  values('angle',story_id,auth.uid(),auth.uid() is null);
  return null;
end;
$$;

create or replace function public.record_livewire_view(post_id uuid) returns bigint
language plpgsql security definer set search_path=''
as $$
declare total bigint;
begin
  select post.view_count into total from public.livewire_posts post
  where post.id=record_livewire_view.post_id for update;
  if total is null then raise exception 'Post is no longer available'; end if;
  if public.livewire_role() in ('owner','admin') then return total; end if;
  update public.livewire_posts post set view_count=post.view_count+1
  where post.id=record_livewire_view.post_id returning post.view_count into total;
  insert into public.post_view_receipts(surface,post_id,user_id,guest)
  values('livewire',record_livewire_view.post_id,auth.uid(),auth.uid() is null);
  return total;
end;
$$;

-- Consume identifiable receipts once so reapplying cannot subtract twice.
-- Retired archive content remains read-only after this transactional count correction.
alter table public.livewire_posts disable trigger livewire_retired_read_only;
with removed as (
  delete from public.post_view_receipts receipt using public.livewire_roles actor
  where receipt.user_id=actor.user_id and actor.role in ('owner','admin')
  returning receipt.surface,receipt.post_id
), counts as (
  select surface,post_id,count(*) as total from removed group by surface,post_id
), angle_counts as (
  update public.angle_view_counts views set view_count=greatest(0,views.view_count-counts.total)
  from counts where counts.surface='angle' and views.angle_id=counts.post_id returning views.angle_id
)
update public.livewire_posts post set view_count=greatest(0,post.view_count-counts.total)
from counts where counts.surface='livewire' and post.id=counts.post_id;
alter table public.livewire_posts enable trigger livewire_retired_read_only;

delete from public.site_opens opens using public.livewire_roles actor
where opens.user_id=actor.user_id and actor.role in ('owner','admin');

notify pgrst,'reload schema';
commit;
