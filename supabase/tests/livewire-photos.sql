begin;
insert into auth.users(id) values
 ('d7002222-2222-4222-8222-222222222221'),
 ('d7002222-2222-4222-8222-222222222222'),
 ('d7002222-2222-4222-8222-222222222223');
insert into public.livewire_roles values
 ('d7002222-2222-4222-8222-222222222221', 'admin', 'Photo admin'),
 ('d7002222-2222-4222-8222-222222222222', 'owner', 'Photo owner');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd7002222-2222-4222-8222-222222222221', true);
insert into storage.objects(bucket_id,name) values
 ('livewire-photos', 'd7002222-2222-4222-8222-222222222221/test-1.png'),
 ('livewire-photos', 'd7002222-2222-4222-8222-222222222221/test-2.png'),
 ('livewire-photos', 'd7002222-2222-4222-8222-222222222221/test-3.png'),
 ('livewire-photos', 'd7002222-2222-4222-8222-222222222221/test-4.png');
do $$
declare target uuid; images text[];
begin
  select array_agg(name order by name) into images from storage.objects where bucket_id = 'livewire-photos'
    and name like 'd7002222-2222-4222-8222-222222222221/%';
  target := public.save_livewire_post('Photo body', null, null, 'Photo test', images);
  assert (select cardinality(image_paths) from public.livewire_posts where id = target) = 4, 'Four photos saved';
  perform public.save_livewire_post('Legacy edited body', null, target, 'Photo test');
  assert (select cardinality(image_paths) from public.livewire_posts where id = target) = 4, 'Old clients preserve photos';
  begin
    perform public.save_livewire_post('Body', null, null, 'Title', images || images[1]);
    raise exception 'Fifth photo accepted';
  exception when raise_exception then
    if sqlerrm <> 'Attach at most four photos' then raise; end if;
  end;
  begin
    perform public.save_livewire_post('Body', null, null, 'Title', array['https://untrusted.invalid/photo']);
    raise exception 'External attachment accepted';
  exception when raise_exception then
    if sqlerrm <> 'Photo not found or attachment is not permitted' then raise; end if;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd7002222-2222-4222-8222-222222222222', true);
do $$
declare target uuid; images text[];
begin
  select id, image_paths into target, images from public.livewire_posts where title = 'Photo test';
  begin
    perform public.save_livewire_post('Body', null, null, 'Copied photos', images);
    raise exception 'Another account attached private draft paths';
  exception when raise_exception then
    if sqlerrm <> 'Photo not found or attachment is not permitted' then raise; end if;
  end;
  perform public.save_livewire_post('Owner moderated body', null, target, 'Photo test', images[1:2]);
  assert (select cardinality(image_paths) from public.livewire_posts where id = target) = 2, 'Owner can retain or remove existing photos';
end;
$$;
select set_config('request.jwt.claim.sub', 'd7002222-2222-4222-8222-222222222223', true);
do $$
begin
  begin
    insert into storage.objects(bucket_id,name) values('livewire-photos',auth.uid()::text || '/forbidden.png');
    raise exception 'Reader uploaded a photo';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
