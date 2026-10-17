begin;
insert into auth.users(id) values ('e9541111-1111-4111-8111-111111111111');
insert into public.livewire_roles(user_id,role,display_name)
values ('e9541111-1111-4111-8111-111111111111','admin','Mirror rollback test');
insert into public.user_push_subscriptions(user_id,endpoint,subscription)
values ('e9541111-1111-4111-8111-111111111111','https://example.invalid/angle-mirror-test','{}');
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,evidence,counterpoint,pick,reviewed,status,created_by)
values ('e9541111-1111-4111-8111-111111111121',2200,18,'NFL:123','Test matchup','team','','Other',
  repeat('H',140),repeat('N',1500),repeat('E',1500),repeat('C',1000),repeat('P',500),false,'draft',
  'e9541111-1111-4111-8111-111111111111');
do $$
begin
  assert not exists(select 1 from public.livewire_posts where angle_id='e9541111-1111-4111-8111-111111111121'),'Draft is not mirrored';
end;
$$;
update public.angles set reviewed=true,status='published',revision=revision+1
where id='e9541111-1111-4111-8111-111111111121';
do $$
declare mirrored public.livewire_posts;
begin
  select * into strict mirrored from public.livewire_posts where angle_id='e9541111-1111-4111-8111-111111111121';
  assert mirrored.author_name='From The Analyst''s Desk','Requested attribution';
  assert char_length(mirrored.title)=140 and char_length(mirrored.body)>4500,'Full maximum-length content is preserved';
  assert position(repeat('N',1500) in mirrored.body)>0 and position(repeat('P',500) in mirrored.body)>0,'Narrative and pick are intact';
  assert mirrored.themes=array['news'],'Visible under News';
  assert (select count(*) from public.livewire_push_deliveries
    where angle_id=mirrored.angle_id and endpoint='https://example.invalid/angle-mirror-test')=1,'One storyline alert per device';
  assert not exists(select 1 from public.livewire_push_deliveries where post_id=mirrored.id),'No second LIVEWIRE push';
end;
$$;
create temporary table mirror_test_original as
select id,created_at from public.livewire_posts where angle_id='e9541111-1111-4111-8111-111111111121';
update public.angles set title='Updated headline',narrative='Updated story',pick='',evidence='',counterpoint='',revision=revision+1
where id='e9541111-1111-4111-8111-111111111121';
do $$
begin
  assert exists(select 1 from public.livewire_posts mirror join mirror_test_original original using(id,created_at)
    where mirror.title='Updated headline' and mirror.body='Updated story'),'Edits update same post without changing publication order';
  assert (select count(*) from public.livewire_push_deliveries
    where angle_id='e9541111-1111-4111-8111-111111111121' and endpoint='https://example.invalid/angle-mirror-test')=1,'Edits do not queue a second push';
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','e9541111-1111-4111-8111-111111111111',true);
do $$
declare mirrored uuid; normal uuid;
begin
  select id into strict mirrored from public.livewire_posts where angle_id='e9541111-1111-4111-8111-111111111121';
  begin
    perform public.save_livewire_post(post_body=>'Wrong edit',post_id=>mirrored,post_title=>'Wrong title');
    raise exception 'Mirror edit unexpectedly permitted';
  exception when raise_exception then
    if sqlerrm <> 'Edit this storyline in Analyst Desk - The Angle' then raise; end if;
  end;
  begin
    perform public.delete_livewire_post(mirrored);
    raise exception 'Mirror delete unexpectedly permitted';
  exception when raise_exception then
    if sqlerrm <> 'Delete or unpublish this storyline in Analyst Desk - The Angle' then raise; end if;
  end;
  normal:=public.save_livewire_post(post_body=>'Normal body',post_title=>'Normal headline');
  perform public.save_livewire_post(post_body=>'Normal edited body',post_id=>normal,post_title=>'Normal edited headline');
  perform public.delete_livewire_post(normal);
  begin
    perform public.save_livewire_post(post_body=>repeat('x',501),post_title=>'Too long');
    raise exception 'Ordinary body limit unexpectedly expanded';
  exception when raise_exception then
    if sqlerrm <> 'Posts must contain 1 to 500 characters' then raise; end if;
  end;
end;
$$;
reset role;
insert into public.livewire_posts(id,author_name,title,body)
values ('e9541111-1111-4111-8111-111111111131','Normal author','Normal push test','Body');
do $$
begin
  assert (select count(*) from public.livewire_push_deliveries
    where post_id='e9541111-1111-4111-8111-111111111131' and endpoint='https://example.invalid/angle-mirror-test')=1,'Normal LIVEWIRE alerts unchanged';
end;
$$;
update public.angles set status='draft',revision=revision+1 where id='e9541111-1111-4111-8111-111111111121';
do $$
begin
  assert not exists(select 1 from public.livewire_posts where angle_id='e9541111-1111-4111-8111-111111111121'),'Unpublishing removes public copy';
  assert not exists(select 1 from public.livewire_push_deliveries where angle_id='e9541111-1111-4111-8111-111111111121'),'Pending notifications cancelled';
end;
$$;
update public.angles set status='published',revision=revision+1 where id='e9541111-1111-4111-8111-111111111121';
do $$
begin
  assert (select count(*) from public.livewire_posts where angle_id='e9541111-1111-4111-8111-111111111121')=1,'Republishing restores one copy';
  assert not exists(select 1 from public.livewire_push_deliveries where angle_id='e9541111-1111-4111-8111-111111111121'),'Republishing does not rebroadcast';
end;
$$;
delete from public.angles where id='e9541111-1111-4111-8111-111111111121';
do $$
begin
  assert not exists(select 1 from public.livewire_posts where angle_id='e9541111-1111-4111-8111-111111111121'),'Deleting storyline cascades to mirror';
end;
$$;
select 'Angle mirrors: full content, single notification, edits, unpublish, republish, deletion, and normal LIVEWIRE behavior passed' as result;
rollback;
