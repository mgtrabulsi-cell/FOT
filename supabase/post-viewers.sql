begin;
create table if not exists public.post_view_receipts (
  id bigint generated always as identity primary key,
  surface text not null check(surface in ('angle','livewire')),
  post_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  guest boolean not null,
  viewed_at timestamptz not null default now()
);
create index if not exists post_view_receipts_lookup on public.post_view_receipts(surface,post_id);
alter table public.post_view_receipts enable row level security;
revoke all on public.post_view_receipts from public,anon,authenticated;

create or replace function public.remove_post_view_receipts()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  delete from public.post_view_receipts where surface=tg_argv[0] and post_id=old.id;
  return old;
end;
$$;
revoke all on function public.remove_post_view_receipts() from public,anon,authenticated;
drop trigger if exists remove_angle_view_receipts on public.angles;
create trigger remove_angle_view_receipts after delete on public.angles
for each row execute function public.remove_post_view_receipts('angle');
drop trigger if exists remove_livewire_view_receipts on public.livewire_posts;
create trigger remove_livewire_view_receipts after delete on public.livewire_posts
for each row execute function public.remove_post_view_receipts('livewire');

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

create or replace function public.admin_post_viewers(post_surface text, target_post uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare total bigint; tracked bigint; guests bigint; viewers jsonb;
begin
  if public.livewire_role() not in ('owner','admin') or public.livewire_role() is null then
    raise exception 'Admin access is required';
  end if;
  if post_surface='angle' then
    if not exists(select 1 from public.angles where id=target_post and status='published') then
      raise exception 'Storyline is no longer published';
    end if;
    select coalesce((select view_count from public.angle_view_counts where angle_id=target_post),0) into total;
  elsif post_surface='livewire' then
    select view_count into total from public.livewire_posts where id=target_post;
    if total is null then raise exception 'Post is no longer available'; end if;
  else raise exception 'Invalid post surface'; end if;
  select count(*),count(*) filter(where guest) into tracked,guests
  from public.post_view_receipts where surface=post_surface and post_id=target_post;
  select coalesce(jsonb_agg(to_jsonb(viewer) order by viewer.last_viewed_at desc,viewer.user_id),'[]'::jsonb)
  into viewers from (
    select receipt.user_id,coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'),''),'Registered member') as display_name,
      count(*) as views,max(receipt.viewed_at) as last_viewed_at
    from public.post_view_receipts receipt join auth.users u on u.id=receipt.user_id
    where receipt.surface=post_surface and receipt.post_id=target_post
    group by receipt.user_id,u.raw_user_meta_data
  ) viewer;
  return jsonb_build_object('viewers',viewers,'guest_views',guests,
    'unattributed_views',greatest(0,total-tracked)+(select count(*) from public.post_view_receipts
      where surface=post_surface and post_id=target_post and user_id is null and not guest));
end;
$$;
revoke all on function public.admin_post_viewers(text,uuid) from public,anon;
grant execute on function public.admin_post_viewers(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
