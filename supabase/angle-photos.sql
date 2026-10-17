begin;
alter table public.angles add column if not exists image_paths text[] not null default '{}'
  check(cardinality(image_paths)<=4 and array_position(image_paths,null) is null);
grant update(image_paths) on public.angles to authenticated;
alter table public.livewire_posts add column if not exists admin_pick text not null default ''
  check(char_length(admin_pick)<=500);

create or replace function public.validate_angle_photos() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if cardinality(new.image_paths)>4 or array_position(new.image_paths,null) is not null then
    raise exception 'Attach at most four photos';
  end if;
  if cardinality(new.image_paths) <> (select count(distinct path) from unnest(new.image_paths) path) then
    raise exception 'Each photo may be attached only once';
  end if;
  if exists(select 1 from unnest(new.image_paths) photo(path) where not exists(
    select 1 from storage.objects object where object.bucket_id='livewire-photos' and object.name=photo.path
    and (split_part(photo.path,'/',1)=auth.uid()::text
      or (tg_op='UPDATE' and photo.path=any(old.image_paths)))
  )) then raise exception 'Photo not found or attachment is not permitted'; end if;
  return new;
end;
$$;
revoke all on function public.validate_angle_photos() from public,anon,authenticated;
drop trigger if exists angle_photos_validation on public.angles;
create trigger angle_photos_validation before insert or update of image_paths on public.angles
for each row execute function public.validate_angle_photos();

drop policy if exists "Admins clean unused LIVEWIRE uploads" on storage.objects;
create policy "Admins clean unused LIVEWIRE uploads" on storage.objects for delete to authenticated
using(bucket_id='livewire-photos' and (storage.foldername(name))[1]=auth.uid()::text
  and public.livewire_role() in ('owner','admin')
  and not exists(select 1 from public.livewire_posts where name=any(image_paths))
  and not exists(select 1 from public.angles where name=any(image_paths)));

create or replace function public.sync_angle_livewire() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' then
    delete from public.livewire_posts where angle_id=new.id;
    return new;
  end if;
  insert into public.livewire_posts(angle_id,author_id,author_name,title,body,source_url,themes,created_at,updated_at,image_paths,admin_pick)
  values(new.id,new.created_by,'From The Analyst''s Desk',new.title,
    concat_ws(E'\n\n',new.narrative,
      case when btrim(new.evidence)<>'' then 'The supporting context'||E'\n'||new.evidence end,
      case when btrim(new.counterpoint)<>'' then 'The other side'||E'\n'||new.counterpoint end),
    nullif(new.source_url,''),array['news'],
    coalesce((select first_published_at from public.angle_push_publications where angle_id=new.id),new.updated_at),
    new.updated_at,new.image_paths,new.pick)
  on conflict(angle_id) do update set
    author_id=excluded.author_id,author_name=excluded.author_name,title=excluded.title,body=excluded.body,
    source_url=excluded.source_url,updated_at=excluded.updated_at,image_paths=excluded.image_paths,admin_pick=excluded.admin_pick;
  return new;
end;
$$;
update public.livewire_posts post set image_paths=story.image_paths,admin_pick=story.pick,
  body=concat_ws(E'\n\n',story.narrative,
    case when btrim(story.evidence)<>'' then 'The supporting context'||E'\n'||story.evidence end,
    case when btrim(story.counterpoint)<>'' then 'The other side'||E'\n'||story.counterpoint end)
from public.angles story where post.angle_id=story.id;
notify pgrst,'reload schema';
commit;
