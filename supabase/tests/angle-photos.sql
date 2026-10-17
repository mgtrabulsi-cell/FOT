begin;
insert into auth.users(id) values
('a8541111-1111-4111-8111-111111111111'),
('a8541111-1111-4111-8111-111111111112');
insert into public.livewire_roles(user_id,role,display_name) values
('a8541111-1111-4111-8111-111111111111','admin','Photo test'),
('a8541111-1111-4111-8111-111111111112','admin','Other photo test');
insert into storage.objects(bucket_id,name) select 'livewire-photos','a8541111-1111-4111-8111-111111111111/photo-'||n||'.png'
from generate_series(1,5) n;
insert into storage.objects(bucket_id,name) values('livewire-photos','a8541111-1111-4111-8111-111111111112/foreign.png');
set local role authenticated;
select set_config('request.jwt.claim.sub','a8541111-1111-4111-8111-111111111111',true);
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,pick,reviewed,status,image_paths)
values('a8541111-1111-4111-8111-111111111121',2200,18,'NFL:123','Test','team','','Other','Photos','Story','Exact pick',true,'published',
array(select 'a8541111-1111-4111-8111-111111111111/photo-'||n||'.png' from generate_series(1,4) n));
do $$
begin
  assert exists(select 1 from public.livewire_posts where angle_id='a8541111-1111-4111-8111-111111111121'
    and cardinality(image_paths)=4 and admin_pick='Exact pick' and body='Story'),'Four photos and structured pick mirror intact';
  begin
    update public.angles set image_paths=array(select 'a8541111-1111-4111-8111-111111111111/photo-'||n||'.png'
      from generate_series(1,5) n),revision=revision+1 where id='a8541111-1111-4111-8111-111111111121';
    raise exception 'Five photos allowed';
  exception when raise_exception then
    if sqlerrm <> 'Attach at most four photos' then raise; end if;
  end;
  begin
    update public.angles set image_paths=array['a8541111-1111-4111-8111-111111111112/foreign.png'],revision=revision+1
    where id='a8541111-1111-4111-8111-111111111121';
    raise exception 'Foreign attachment allowed';
  exception when raise_exception then
    if sqlerrm <> 'Photo not found or attachment is not permitted' then raise; end if;
  end;
  begin
    update public.angles set image_paths=array['missing.png'],revision=revision+1
    where id='a8541111-1111-4111-8111-111111111121';
    raise exception 'Missing attachment allowed';
  exception when raise_exception then
    if sqlerrm <> 'Photo not found or attachment is not permitted' then raise; end if;
  end;
end;
$$;
select set_config('request.jwt.claim.sub','a8541111-1111-4111-8111-111111111112',true);
update public.angles set title='Another admin edit',image_paths=image_paths[1:2],pick='Revised pick',revision=revision+1
where id='a8541111-1111-4111-8111-111111111121';
do $$
begin
  assert exists(select 1 from public.livewire_posts where angle_id='a8541111-1111-4111-8111-111111111121'
    and cardinality(image_paths)=2 and admin_pick='Revised pick' and body='Story'),'Other admin retains existing photos; removal and pick edits sync';
end;
$$;
update public.angles set status='draft',revision=revision+1 where id='a8541111-1111-4111-8111-111111111121';
do $$
begin
  assert not exists(select 1 from public.livewire_posts where angle_id='a8541111-1111-4111-8111-111111111121'),'Private draft has no mirrored photos';
end;
$$;
reset role;
select 'Angle photos: four-photo limit, ownership, existing attachment retention, structured picks, mirror updates, and drafts passed' as result;
rollback;
