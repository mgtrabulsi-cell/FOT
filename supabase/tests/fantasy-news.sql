begin;
insert into auth.users(id) values ('f9541111-1111-4111-8111-111111111111');
insert into public.livewire_roles(user_id,role,display_name)
values('f9541111-1111-4111-8111-111111111111','admin','Fantasy news test');
set local role authenticated;
select set_config('request.jwt.claim.sub','f9541111-1111-4111-8111-111111111111',true);
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,status,section,news_types)
values('f9541111-1111-4111-8111-111111111121',2200,18,'NFL:123','Test','team','','Other','Injury update','Story',true,'published','news','{injury}'),
 ('f9541111-1111-4111-8111-111111111122',2200,18,'NFL:123','Test','team','','Other','Draft','',false,'draft','news','{}');
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,status)
values('f9541111-1111-4111-8111-111111111123',2200,18,'NFL:123','Test','team','','Other','Angle','Story',true,'published');
do $$
begin
  assert exists(select 1 from public.angles where id='f9541111-1111-4111-8111-111111111123' and section='angle' and news_types='{}'),'Angles default to The Angle';
  assert exists(select 1 from public.livewire_posts where angle_id='f9541111-1111-4111-8111-111111111121' and themes=array['fantasy']),'Fantasy News mirrors with the Fantasy theme';
  assert exists(select 1 from public.livewire_posts where angle_id='f9541111-1111-4111-8111-111111111123' and themes=array['news']),'Angles keep the News theme';
  assert (select count(*) from public.analyst_unread_items(2200,18) where kind='news')=1,'Fantasy News reports its own unread kind';
  assert (select count(*) from public.analyst_unread_items(2200,18) where kind='angle')=1,'Angle unread kind unchanged';
  perform public.mark_analyst_read('news','f9541111-1111-4111-8111-111111111121');
  assert not exists(select 1 from public.analyst_unread_items(2200,18) where kind='news'),'News receipts clear unread';
  update public.angles set news_types='{injury,news}',revision=revision+1 where id='f9541111-1111-4111-8111-111111111121';
  assert found,'Admins can retag Fantasy News';
  begin
    update public.angles set status='published',reviewed=true,narrative='Story',revision=revision+1 where id='f9541111-1111-4111-8111-111111111122';
    raise exception 'Untagged Fantasy News published';
  exception when check_violation then null;
  end;
  begin
    update public.angles set news_types='{injury,injury}',revision=revision+1 where id='f9541111-1111-4111-8111-111111111121';
    raise exception 'Duplicate tags accepted';
  exception when check_violation then null;
  end;
  begin
    update public.angles set news_types='{rumor}',revision=revision+1 where id='f9541111-1111-4111-8111-111111111121';
    raise exception 'Unknown tag accepted';
  exception when check_violation then null;
  end;
  begin
    update public.angles set news_types='{news}',revision=revision+1 where id='f9541111-1111-4111-8111-111111111123';
    raise exception 'Angle accepted news tags';
  exception when check_violation then null;
  end;
  begin
    update public.angles set section='angle',revision=revision+1 where id='f9541111-1111-4111-8111-111111111121';
    raise exception 'Section changed after insert';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
begin
  assert exists(select 1 from public.livewire_push_deliveries where angle_id='f9541111-1111-4111-8111-111111111121' and primary_theme='fantasy')
    or not exists(select 1 from public.user_push_subscriptions),'Fantasy News pushes carry the fantasy theme';
  assert not exists(select 1 from public.livewire_push_deliveries where angle_id='f9541111-1111-4111-8111-111111111123' and primary_theme is distinct from 'news'),'Legacy Angle pushes default to News';
end;
$$;
select 'Fantasy News: sections, tags, publish rule, LIVEWIRE theme, unread kind, receipts, and push theme passed' as result;
rollback;
