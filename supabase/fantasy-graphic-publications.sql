begin;

alter table public.livewire_posts add column if not exists fantasy_graphic_id uuid unique
  references public.fantasy_graphics(id) on delete cascade;
alter table public.livewire_posts drop constraint if exists livewire_posts_body_check;
alter table public.livewire_posts add constraint livewire_posts_body_check check (
  (fantasy_graphic_id is not null and angle_id is null and body = '' and title is not null and cardinality(image_paths) = 1)
  or (fantasy_graphic_id is null and char_length(btrim(body)) between 1 and case when angle_id is null then 500 else 5000 end)
);

create or replace function public.guard_fantasy_graphic_post() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Trusted account-deletion triggers and foreign-key cascades must still remove linked posts.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if old.fantasy_graphic_id is not null and exists (
    select 1 from public.fantasy_graphics where id = old.fantasy_graphic_id and published_content is not null
  ) and current_setting('gamewire.graphic_publication',true) is distinct from old.fantasy_graphic_id::text then
    raise exception 'Edit or unpublish this graphic in Analyst Desk - Fantasy - Start/Sit';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_fantasy_graphic_post() from public, anon, authenticated;
drop trigger if exists guard_fantasy_graphic_post on public.livewire_posts;
create trigger guard_fantasy_graphic_post before update of title, body, source_url, image_paths, themes, fantasy_graphic_id or delete on public.livewire_posts
for each row execute function public.guard_fantasy_graphic_post();

create or replace function public.unpublish_fantasy_graphic_post() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.published_content is null then
    update public.x_publications set status = 'cancelled', updated_at = now(), last_error = 'Graphic is no longer published'
      where source_type = 'livewire' and source_id in (
        select id from public.livewire_posts where fantasy_graphic_id = new.id
      ) and status = 'pending';
    delete from public.livewire_posts where fantasy_graphic_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.unpublish_fantasy_graphic_post() from public, anon, authenticated;
drop trigger if exists unpublish_fantasy_graphic_post on public.fantasy_graphics;
create trigger unpublish_fantasy_graphic_post after update on public.fantasy_graphics
for each row execute function public.unpublish_fantasy_graphic_post();

create or replace function public.save_fantasy_graphic_publication(
  graphic_id uuid, graphic_season integer, graphic_week integer, graphic_content jsonb,
  expected_revision integer, graphic_action text, graphic_image_path text default null, post_to_x boolean default false
)
returns setof public.fantasy_graphics
language plpgsql security definer set search_path = ''
as $$
declare
  saved public.fantasy_graphics;
  actor public.livewire_roles;
  subject text;
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
    perform set_config('gamewire.post_to_x',post_to_x::text,true);
    perform set_config('gamewire.graphic_publication',saved.id::text,true);
    insert into public.livewire_posts(id, fantasy_graphic_id, author_id, author_name, title, body, image_paths, themes)
    values(saved.id, saved.id, actor.user_id, actor.display_name, subject, '', array[graphic_image_path], array['fantasy'])
    on conflict(fantasy_graphic_id) do update set
      title = excluded.title, body = '', image_paths = excluded.image_paths, updated_at = clock_timestamp();
    perform set_config('gamewire.graphic_publication','',true);
    perform set_config('gamewire.post_to_x','',true);
  end if;
  return next saved;
end;
$$;
revoke all on function public.save_fantasy_graphic_publication(uuid,integer,integer,jsonb,integer,text,text,boolean) from public, anon;
grant execute on function public.save_fantasy_graphic_publication(uuid,integer,integer,jsonb,integer,text,text,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
