begin;
insert into auth.users(id) values ('a8541111-1111-4111-8111-111111111111');
insert into public.livewire_roles(user_id,role,display_name)
values ('a8541111-1111-4111-8111-111111111111','admin','Graphic publication test');
insert into storage.objects(bucket_id,name,metadata)
values ('livewire-photos','a8541111-1111-4111-8111-111111111111/a8542222-2222-4222-8222-222222222222.png',
  '{"mimetype":"image/png","size":1000}');
update public.x_publishing_settings set enabled = true where id;
set local role authenticated;
select set_config('request.jwt.claim.sub','a8541111-1111-4111-8111-111111111111',true);
do $$
declare
  body jsonb;
  saved record;
  post record;
  position text;
  kind text;
  image text := 'a8541111-1111-4111-8111-111111111111/a8542222-2222-4222-8222-222222222222.png';
begin
  foreach kind in array array['start','sit'] loop
    foreach position in array array['QB','RB','WR','TE'] loop
      select jsonb_build_object('kind',kind,'position',position,'slots',jsonb_agg(jsonb_build_object(
        'reason','Verified opinion','player',jsonb_build_object(
          'id',n::text,'name','Player ' || n,'position',position,'teamId','9','teamAbbr','GB',
          'headshot','https://a.espncdn.com/photo.png','opponent','','opponentLogo','','matchup','TBD')
      ))) into body from generate_series(1,4) n;
      select * into saved from public.save_fantasy_graphic_publication(null,2200,7,body,0,'draft',null,true);
      if exists(select 1 from public.livewire_posts where fantasy_graphic_id = saved.id) then raise exception 'Draft leaked to LIVEWIRE'; end if;
      begin
        perform public.save_fantasy_graphic_publication(saved.id,2200,7,body,1,'publish',null,true);
        raise exception 'Missing graphic accepted';
      exception when raise_exception then
        if sqlerrm <> 'Upload the rendered PNG before publishing this graphic' then raise; end if;
      end;
      select * into saved from public.save_fantasy_graphic_publication(saved.id,2200,7,body,1,'publish',image,true);
      select * into post from public.livewire_posts where fantasy_graphic_id = saved.id;
      if post.id is null or post.title <> 'Week 7 Must ' || initcap(kind) || ' Fantasy ' || position
        or post.body <> '' or post.image_paths <> array[image] or post.themes <> array['fantasy']
        or saved.published_content <> body then raise exception 'Incorrect subject/image-only publication'; end if;
      if not exists(select 1 from public.x_publications where source_type = 'livewire' and source_id = post.id and status = 'pending') then
        raise exception 'X opt-in was not queued';
      end if;
      begin
        perform public.delete_livewire_post(post.id);
        raise exception 'Linked graphic deleted directly';
      exception when raise_exception then
        if sqlerrm not like 'Edit or unpublish this graphic%' then raise; end if;
      end;
      select * into saved from public.save_fantasy_graphic_publication(saved.id,2200,7,body,2,'publish',image,true);
      if (select count(*) from public.livewire_posts where fantasy_graphic_id = saved.id) <> 1
        or (select count(*) from public.x_publications where source_type = 'livewire' and source_id = post.id) <> 1 then
        raise exception 'Republish duplicated LIVEWIRE or X';
      end if;
      select * into saved from public.save_fantasy_graphic_publication(saved.id,2200,7,body,3,'unpublish',null,true);
      if exists(select 1 from public.livewire_posts where fantasy_graphic_id = saved.id)
        or not exists(select 1 from public.x_publications where source_type = 'livewire' and source_id = post.id and status = 'cancelled') then
        raise exception 'Unpublish did not remove LIVEWIRE and cancel X';
      end if;
      perform public.save_fantasy_graphic_publication(saved.id,2200,7,body,4,'publish',image,true);
      if (select id from public.livewire_posts where fantasy_graphic_id = saved.id) <> post.id
        or (select count(*) from public.x_publications where source_type = 'livewire' and source_id = post.id) <> 1 then
        raise exception 'Unpublish/republish created another X publication';
      end if;
    end loop;
  end loop;
  select * into saved from public.save_fantasy_graphic_publication(null,2200,8,body,0,'publish',image,false);
  if not exists(select 1 from public.x_publications where source_type = 'livewire' and source_id = saved.id and status = 'skipped') then
    raise exception 'Unchecked X publication was queued';
  end if;
  begin
    perform public.save_fantasy_graphic_publication(saved.id,2200,8,body,0,'publish',image,true);
    raise exception 'Stale revision accepted';
  exception when raise_exception then
    if sqlerrm not like 'Another admin updated%' then raise; end if;
  end;
  begin
    perform public.save_livewire_post('', null, null, 'Ordinary empty post', array[image], array['fantasy']);
    raise exception 'Ordinary empty body accepted';
  exception when raise_exception then
    if sqlerrm <> 'Posts must contain 1 to 500 characters' then raise; end if;
  end;
end;
$$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
begin
  if (select count(*) from public.livewire_posts where author_id = 'a8541111-1111-4111-8111-111111111111' and fantasy_graphic_id is not null) <> 9 then
    raise exception 'Public LIVEWIRE graphics are missing';
  end if;
  begin
    perform public.save_fantasy_graphic_publication(null,2200,7,'{}',0,'draft',null,false);
    raise exception 'Anonymous graphic write accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
-- This separate deletion fixture has no uploaded objects; everything rolls back.
insert into auth.users(id) values ('a8543333-3333-4333-8333-333333333333');
insert into public.fantasy_graphics(id,season,week,content,published_content)
select 'a8544444-4444-4444-8444-444444444444',2200,9,content,content
  from public.fantasy_graphics where season = 2200 and week = 8 limit 1;
insert into public.livewire_posts(id,fantasy_graphic_id,author_id,author_name,title,body,image_paths,themes)
values ('a8544444-4444-4444-8444-444444444444','a8544444-4444-4444-8444-444444444444',
  'a8543333-3333-4333-8333-333333333333','Deletion fixture','Week 9 Must Sit Fantasy TE','',
  array['a8543333-3333-4333-8333-333333333333/no-upload.png'],array['fantasy']);
delete from auth.users where id = 'a8543333-3333-4333-8333-333333333333';
do $$
begin
  if exists(select 1 from public.livewire_posts where id = 'a8544444-4444-4444-8444-444444444444') then
    raise exception 'Account deletion retained linked LIVEWIRE posts';
  end if;
end;
$$;
select 'Graphic publications: all subjects, image-only posts, X opt-in, revision checks, public reads and duplicate protection passed' as result;
rollback;
