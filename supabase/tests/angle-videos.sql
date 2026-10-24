begin;
do $$
begin
  assert exists(select 1 from storage.buckets where id='livewire-photos' and public
    and file_size_limit=52428800
    and allowed_mime_types @> array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']),
    'Attachment bucket supports existing photos and videos up to 50 MB';
end;
$$;
insert into auth.users(id) values ('f8541111-1111-4111-8111-111111111111');
insert into public.livewire_roles(user_id,role,display_name)
values ('f8541111-1111-4111-8111-111111111111','admin','Video attachment test');
insert into storage.objects(bucket_id,name) values
('livewire-photos','f8541111-1111-4111-8111-111111111111/video.mp4'),
('livewire-photos','f8541111-1111-4111-8111-111111111111/video.webm'),
('livewire-photos','f8541111-1111-4111-8111-111111111111/video.mov'),
('livewire-photos','f8541111-1111-4111-8111-111111111111/photo.png');
set local role authenticated;
select set_config('request.jwt.claim.sub','f8541111-1111-4111-8111-111111111111',true);
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,status,image_paths)
values ('f8541111-1111-4111-8111-111111111121',2200,18,'NFL:123','Video test','team','','Other','Mixed attachments',
  'Video analysis',true,'published',array[
  'f8541111-1111-4111-8111-111111111111/video.mp4','f8541111-1111-4111-8111-111111111111/video.webm',
  'f8541111-1111-4111-8111-111111111111/video.mov','f8541111-1111-4111-8111-111111111111/photo.png']);
do $$
begin
  assert exists(select 1 from public.livewire_posts where angle_id='f8541111-1111-4111-8111-111111111121'
    and cardinality(image_paths)=4 and image_paths[1] like '%.mp4' and image_paths[3] like '%.mov'),
    'Mixed videos and photos mirror without new schema fields';
  begin
    update public.angles set image_paths=array['missing/video.mp4'],revision=revision+1
    where id='f8541111-1111-4111-8111-111111111121';
    raise exception 'Missing video was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Photo not found or attachment is not permitted' then raise; end if;
  end;
end;
$$;
update public.angles set image_paths=image_paths[2:4],revision=revision+1
where id='f8541111-1111-4111-8111-111111111121';
do $$
begin
  assert exists(select 1 from public.livewire_posts where angle_id='f8541111-1111-4111-8111-111111111121'
    and cardinality(image_paths)=3 and image_paths[1] like '%.webm'),'Removing a video updates the mirror';
end;
$$;
select 'Video bucket configuration, mixed attachment publication, ownership validation and LIVEWIRE updates passed' as result;
rollback;
