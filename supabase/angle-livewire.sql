begin;

alter table public.livewire_posts add column if not exists angle_id uuid unique references public.angles(id) on delete cascade;
alter table public.livewire_posts drop constraint if exists livewire_posts_body_check;
alter table public.livewire_posts add constraint livewire_posts_body_check
  check (char_length(btrim(body)) between 1 and case when angle_id is null then 500 else 5000 end);
alter table public.livewire_posts drop constraint if exists livewire_posts_title_check;
alter table public.livewire_posts add constraint livewire_posts_title_check
  check (title is null or char_length(btrim(title)) between 1 and case when angle_id is null then 120 else 140 end);

create or replace function public.queue_livewire_push() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.angle_id is null and new.title is not null then
    insert into public.livewire_push_deliveries(post_id, user_id, endpoint, subject, primary_theme)
    select new.id, user_id, endpoint, new.title, new.themes[1] from public.user_push_subscriptions
    on conflict(post_id, endpoint) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.queue_livewire_push() from public, anon, authenticated;

create or replace function public.sync_angle_livewire() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' then
    delete from public.livewire_posts where angle_id = new.id;
    return new;
  end if;
  insert into public.livewire_posts(angle_id, author_id, author_name, title, body, source_url, themes, created_at, updated_at)
  values (
    new.id, new.created_by, 'From The Analyst''s Desk', new.title,
    concat_ws(E'\n\n', new.narrative,
      case when btrim(new.evidence) <> '' then 'The supporting context' || E'\n' || new.evidence end,
      case when btrim(new.counterpoint) <> '' then 'The other side' || E'\n' || new.counterpoint end,
      case when btrim(new.pick) <> '' then 'Admin pick - Opinion' || E'\n' || new.pick end),
    nullif(new.source_url, ''), array['news'],
    coalesce((select first_published_at from public.angle_push_publications where angle_id = new.id), new.updated_at),
    new.updated_at
  )
  on conflict(angle_id) do update set
    author_id = excluded.author_id, author_name = excluded.author_name, title = excluded.title,
    body = excluded.body, source_url = excluded.source_url, updated_at = excluded.updated_at;
  return new;
end;
$$;
revoke all on function public.sync_angle_livewire() from public, anon, authenticated;
drop trigger if exists angle_livewire_sync on public.angles;
create trigger angle_livewire_sync after insert or update on public.angles
for each row execute function public.sync_angle_livewire();

-- Backfill without changing stories, revisions, or publication notifications.
insert into public.livewire_posts(angle_id, author_id, author_name, title, body, source_url, themes, created_at, updated_at)
select story.id, story.created_by, 'From The Analyst''s Desk', story.title,
  concat_ws(E'\n\n', story.narrative,
    case when btrim(story.evidence) <> '' then 'The supporting context' || E'\n' || story.evidence end,
    case when btrim(story.counterpoint) <> '' then 'The other side' || E'\n' || story.counterpoint end,
    case when btrim(story.pick) <> '' then 'Admin pick - Opinion' || E'\n' || story.pick end),
  nullif(story.source_url, ''), array['news'], coalesce(publication.first_published_at, story.updated_at), story.updated_at
from public.angles story left join public.angle_push_publications publication on publication.angle_id = story.id
where story.status = 'published'
on conflict(angle_id) do nothing;

create or replace function public.save_livewire_post(post_body text, post_source text default null, post_id uuid default null, post_title text default null, post_images text[] default null, post_themes text[] default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  actor public.livewire_roles;
  result uuid;
begin
  select * into actor from public.livewire_roles where user_id = auth.uid();
  if actor.user_id is null then raise exception 'Admin access is required to publish'; end if;
  if exists(select 1 from public.livewire_posts where id = post_id and angle_id is not null) then
    raise exception 'Edit this storyline in Analyst Desk - The Angle';
  end if;
  if post_body is null or char_length(btrim(post_body)) not between 1 and 500 then
    raise exception 'Posts must contain 1 to 500 characters';
  end if;
  if post_title is not null and char_length(btrim(post_title)) not between 1 and 120 then
    raise exception 'Titles must contain 1 to 120 characters';
  end if;
  if post_themes is not null and (
    cardinality(post_themes) > 3 or array_position(post_themes, null) is not null
    or not (post_themes <@ array['news','fantasy','betting']::text[])
    or cardinality(post_themes) <> (select count(distinct theme) from unnest(post_themes) theme)
  ) then raise exception 'Choose News, Fantasy, and Betting at most once each'; end if;
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
    insert into public.livewire_posts(author_id, author_name, title, body, source_url, image_paths, themes)
    values (actor.user_id, actor.display_name, btrim(post_title), btrim(post_body), post_source, coalesce(post_images, '{}'), coalesce(post_themes, '{}')) returning id into result;
  else
    update public.livewire_posts set title = coalesce(btrim(post_title), title), body = btrim(post_body), source_url = post_source,
      image_paths = coalesce(post_images, image_paths), themes = coalesce(post_themes, themes), updated_at = clock_timestamp()
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
  if exists(select 1 from public.livewire_posts where id = post_id and angle_id is not null) then
    raise exception 'Delete or unpublish this storyline in Analyst Desk - The Angle';
  end if;
  delete from public.livewire_posts where id = post_id
    and (author_id = auth.uid() or public.livewire_role() = 'owner');
  if not found then raise exception 'Post not found or deletion is not permitted'; end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
