begin;
alter table public.angles add column if not exists themes text[];
-- Match the existing section defaults without updating stories or sending alerts.
alter table public.angles disable trigger angles_revision;
alter table public.angles disable trigger angle_first_publication_push;
alter table public.angles disable trigger angle_livewire_sync;
update public.angles set themes = case when section = 'news' then array['fantasy'] else array['news'] end
where themes is null;
alter table public.angles enable trigger angles_revision;
alter table public.angles enable trigger angle_first_publication_push;
alter table public.angles enable trigger angle_livewire_sync;
alter table public.angles alter column themes drop default;
alter table public.angles alter column themes set not null;
alter table public.angles drop constraint if exists angles_themes_check;
alter table public.angles add constraint angles_themes_check check (
  cardinality(themes) between 1 and 3 and array_position(themes, null) is null
  and array_ndims(themes) = 1 and array_lower(themes, 1) = 1
  and themes <@ array['news','fantasy','betting']::text[]
  and (cardinality(themes) < 2 or themes[1] <> themes[2])
  and (cardinality(themes) < 3 or (themes[1] <> themes[3] and themes[2] <> themes[3]))
);
grant update (themes) on public.angles to authenticated;

create or replace function public.initialize_angle_themes() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.themes is null then
    new.themes := case when new.section = 'news' then array['fantasy'] else array['news'] end;
  end if;
  return new;
end;
$$;
revoke all on function public.initialize_angle_themes() from public, anon, authenticated;
drop trigger if exists angle_default_themes on public.angles;
create trigger angle_default_themes before insert on public.angles
for each row execute function public.initialize_angle_themes();

create or replace function public.sync_angle_livewire() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' then
    delete from public.livewire_posts where angle_id = new.id;
    return new;
  end if;
  insert into public.livewire_posts(angle_id,author_id,author_name,title,body,source_url,themes,created_at,updated_at,image_paths,admin_pick,admin_picks)
  values(new.id,new.created_by,'From The Analyst''s Desk',new.title,
    concat_ws(E'\n\n',new.narrative,
      case when btrim(new.evidence)<>'' then 'The supporting context'||E'\n'||new.evidence end,
      case when btrim(new.counterpoint)<>'' then 'The other side'||E'\n'||new.counterpoint end),
    nullif(new.source_url,''),new.themes,coalesce(new.published_at,new.updated_at),
    new.updated_at,new.image_paths,new.pick,new.picks)
  on conflict(angle_id) do update set
    author_id=excluded.author_id,author_name=excluded.author_name,title=excluded.title,body=excluded.body,
    source_url=excluded.source_url,updated_at=excluded.updated_at,image_paths=excluded.image_paths,
    admin_pick=excluded.admin_pick,admin_picks=excluded.admin_picks,themes=excluded.themes;
  return new;
end;
$$;

create or replace function public.queue_angle_push() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' then
    delete from public.livewire_push_deliveries where angle_id = new.id and delivered_at is null;
    return new;
  end if;
  insert into public.angle_push_publications(angle_id) values (new.id) on conflict do nothing;
  if found then
    insert into public.livewire_push_deliveries(angle_id,user_id,endpoint,subject,primary_theme)
    select new.id,user_id,endpoint,new.title,new.themes[1] from public.user_push_subscriptions
    on conflict(angle_id,endpoint) do nothing;
  end if;
  return new;
end;
$$;
-- Fix only unsent legacy notifications; already-sent alerts cannot be changed.
update public.livewire_push_deliveries delivery
set primary_theme = story.themes[1]
from public.angles story
where delivery.angle_id = story.id and delivery.delivered_at is null and delivery.primary_theme is null;

notify pgrst, 'reload schema';
commit;
