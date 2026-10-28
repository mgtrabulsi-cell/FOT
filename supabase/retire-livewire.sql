-- Run LAST, after all existing Angle, fantasy, X and GamewAIre migrations.
-- LIVEWIRE rows, role/auth infrastructure and shared media remain intact.
begin;

drop trigger if exists angle_livewire_sync on public.angles;
drop trigger if exists livewire_new_post_push on public.livewire_posts;
drop trigger if exists livewire_x_publication on public.livewire_posts;
drop trigger if exists unpublish_fantasy_graphic_post on public.fantasy_graphics;

create or replace function public.reject_retired_livewire_write() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'LIVEWIRE is retired. Publish messages in Analyst Desk - The Angle.';
end;
$$;
revoke all on function public.reject_retired_livewire_write() from public, anon, authenticated;
drop trigger if exists livewire_retired_read_only on public.livewire_posts;
create trigger livewire_retired_read_only before insert or update on public.livewire_posts
for each row execute function public.reject_retired_livewire_write();
revoke insert, update, delete on public.livewire_posts from anon, authenticated;

-- Keep old RPC signatures for a clear upgrade error, including security-definer callers.
create or replace function public.sync_angle_livewire() returns trigger
language plpgsql set search_path = ''
as $$ begin return new; end; $$;
create or replace function public.queue_livewire_push() returns trigger
language plpgsql set search_path = ''
as $$ begin return new; end; $$;
create or replace function public.save_livewire_post(
  post_body text, post_source text default null, post_id uuid default null,
  post_title text default null, post_images text[] default null, post_themes text[] default null
) returns uuid language plpgsql set search_path = ''
as $$ begin raise exception 'LIVEWIRE is retired. Publish messages in Analyst Desk - The Angle.'; end; $$;
create or replace function public.delete_livewire_post(post_id uuid) returns void
language plpgsql set search_path = ''
as $$ begin raise exception 'LIVEWIRE is retired. Archived posts are read-only.'; end; $$;

-- This queue is shared with Angle: retire only standalone post deliveries.
alter table public.livewire_push_deliveries add column if not exists cancelled_at timestamptz;
update public.livewire_push_deliveries set cancelled_at = now(), last_error = 'LIVEWIRE retired'
where post_id is not null and delivered_at is null and cancelled_at is null;
create or replace function public.claim_livewire_push()
returns setof public.livewire_push_deliveries
language sql security definer set search_path = ''
as $$
  update public.livewire_push_deliveries as delivery
  set attempts = delivery.attempts + 1, next_attempt_at = now() + interval '5 minutes'
  where delivery.id in (
    select id from public.livewire_push_deliveries
    where angle_id is not null and post_id is null and cancelled_at is null
      and delivered_at is null and next_attempt_at <= now()
    order by next_attempt_at, id for update skip locked limit 100
  ) returning delivery.*;
$$;

update public.x_publications set status = 'cancelled', updated_at = now(), last_error = 'LIVEWIRE retired'
where source_type = 'livewire' and status in ('pending','sending');
create or replace function public.queue_x_publication() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare connected boolean;
begin
  if tg_table_name <> 'angles' then return new; end if;
  if new.status <> 'published' then
    update public.x_publications set status = 'cancelled', updated_at = now(), last_error = 'Story is no longer published'
      where source_type = 'angle' and source_id = new.id and status = 'pending';
    return new;
  end if;
  select enabled into connected from public.x_publishing_settings where id;
  insert into public.x_publications(source_type, source_id, status, last_error)
  values('angle', new.id, case when new.post_to_x and connected then 'pending' else 'skipped' end,
    case when not new.post_to_x then 'Post to X was unchecked' when not connected then 'X connection is not enabled; not queued' end)
  on conflict do nothing;
  return new;
end;
$$;
create or replace function public.claim_x_publications()
returns setof public.x_publications language plpgsql security definer set search_path = ''
as $$
begin
  if not exists(select 1 from public.x_publishing_settings where id and enabled) then return; end if;
  update public.x_publications set status = 'unknown', updated_at = now(),
    last_error = 'Dispatch interrupted. Check the X account before attempting to repost.'
    where source_type = 'angle' and status = 'sending' and updated_at < now() - interval '5 minutes';
  return query update public.x_publications p set status = 'sending', updated_at = now()
    where p.id in (select id from public.x_publications where source_type = 'angle' and status = 'pending'
      order by id for update skip locked limit 1) returning p.*;
end;
$$;

-- Start/Sit retains its shared drafts and exact-PNG X workflow, with Angle as its message source.
alter table public.angles add column if not exists fantasy_graphic_id uuid unique
  references public.fantasy_graphics(id) on delete set null;

create or replace function public.unpublish_fantasy_graphic_post() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.published_content is null then
    update public.angles set status = 'draft', revision = revision + 1
      where fantasy_graphic_id = new.id and status = 'published';
  end if;
  return new;
end;
$$;
create trigger unpublish_fantasy_graphic_post after update on public.fantasy_graphics
for each row execute function public.unpublish_fantasy_graphic_post();

create or replace function public.save_fantasy_graphic_publication(
  graphic_id uuid, graphic_season integer, graphic_week integer, graphic_content jsonb,
  expected_revision integer, graphic_action text, graphic_image_path text default null, post_to_x boolean default false
)
returns setof public.fantasy_graphics
language plpgsql security definer set search_path = ''
as $$
declare saved public.fantasy_graphics; actor public.livewire_roles; subject text;
begin
  select * into actor from public.livewire_roles where user_id = auth.uid();
  if actor.user_id is null or public.account_deletion_in_progress() then raise exception 'Admin access is required'; end if;
  if post_to_x is null then raise exception 'Choose whether to post to X'; end if;
  if graphic_action = 'publish' and (
    graphic_image_path is null or split_part(graphic_image_path, '/', 1) <> actor.user_id::text
    or graphic_image_path !~ '/[0-9a-f-]+[.]png$' or not exists (
      select 1 from storage.objects where bucket_id = 'livewire-photos' and name = graphic_image_path
        and metadata->>'mimetype' = 'image/png'
    )
  ) then raise exception 'Upload the rendered PNG before publishing this graphic'; end if;
  select * into saved from public.save_fantasy_graphic(
    graphic_id, graphic_season, graphic_week, graphic_content, expected_revision, graphic_action
  );
  if graphic_action = 'publish' then
    subject := 'Week ' || graphic_week || ' Must ' ||
      case when graphic_content->>'kind' = 'sit' then 'Sit' else 'Start' end ||
      ' Fantasy ' || (graphic_content->>'position');
    insert into public.angles(id, fantasy_graphic_id, season, week, game_id, matchup, kind, subject,
      category, title, narrative, reviewed, status, created_by, image_paths, themes, post_to_x)
    values(saved.id, saved.id, graphic_season, graphic_week, 'FANTASY:0', 'Fantasy Start/Sit', 'team', subject,
      'Other', subject, 'Fantasy Start/Sit graphic — editorial opinion.', true, 'published', actor.user_id,
      array[graphic_image_path], array['fantasy'], post_to_x)
    on conflict(fantasy_graphic_id) do update set title = excluded.title, subject = excluded.subject,
      image_paths = excluded.image_paths, status = 'published', post_to_x = excluded.post_to_x,
      revision = public.angles.revision + 1;
  end if;
  return next saved;
end;
$$;

-- Move already-published graphics without notifying or tweeting historical content.
alter table public.angles disable trigger angle_first_publication_push;
alter table public.angles disable trigger angle_x_publication;
alter table public.angles disable trigger angle_photos_validation;
insert into public.angles(id, fantasy_graphic_id, season, week, game_id, matchup, kind, subject,
  category, title, narrative, reviewed, status, created_by, image_paths, themes)
select g.id, g.id, g.season, g.week, 'FANTASY:0', 'Fantasy Start/Sit', 'team', p.title,
  'Other', p.title, 'Fantasy Start/Sit graphic — editorial opinion.', true, 'published', p.author_id,
  p.image_paths, array['fantasy']
from public.fantasy_graphics g join public.livewire_posts p on p.fantasy_graphic_id = g.id
where g.published_content is not null and p.author_id is not null
on conflict do nothing;
insert into public.angle_push_publications(angle_id)
select id from public.angles where fantasy_graphic_id is not null on conflict do nothing;
insert into public.x_publications(source_type, source_id, status, last_error)
select 'angle', id, 'skipped', 'Published before LIVEWIRE retirement'
from public.angles where fantasy_graphic_id is not null on conflict do nothing;
alter table public.angles enable trigger angle_first_publication_push;
alter table public.angles enable trigger angle_x_publication;
alter table public.angles enable trigger angle_photos_validation;

-- Archival links never expose old content as a second live message feed.
create or replace function public.retired_livewire_destination(post_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select a.id from public.livewire_posts p join public.angles a
    on a.id = p.angle_id or a.fantasy_graphic_id = p.fantasy_graphic_id
  where p.id = post_id and a.status = 'published' limit 1;
$$;
revoke all on function public.retired_livewire_destination(uuid) from public;
grant execute on function public.retired_livewire_destination(uuid) to anon, authenticated;

-- Keep the existing cron name/endpoint: it now dispatches Angle deliveries only.
notify pgrst, 'reload schema';
commit;
