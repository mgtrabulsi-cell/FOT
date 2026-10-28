-- Run against the complete schema AFTER retire-livewire.sql (legacy mirror tests target older migrations).
begin;
insert into auth.users(id) values ('a8547777-7777-4777-8777-777777777777');
insert into public.livewire_roles(user_id,role,display_name)
values ('a8547777-7777-4777-8777-777777777777','admin','Retirement test');
insert into storage.objects(bucket_id,name,metadata)
values ('livewire-photos','a8547777-7777-4777-8777-777777777777/a8548888-8888-4888-8888-888888888888.png',
  '{"mimetype":"image/png","size":1000}');
update public.x_publishing_settings set enabled = true where id;

-- Even privileged/older background writers cannot create LIVEWIRE content.
do $$
begin
  begin
    insert into public.livewire_posts(author_name,title,body) values ('Legacy','Old client','No new posts');
    raise exception 'Retired table accepted insert';
  exception when raise_exception then
    if sqlerrm not like 'LIVEWIRE is retired.%' then raise; end if;
  end;
  if exists(select 1 from pg_trigger where tgrelid = 'public.angles'::regclass
    and tgname = 'angle_livewire_sync') then raise exception 'Angle mirror is still enabled'; end if;
  if exists(select 1 from public.x_publications where source_type = 'livewire' and status in ('pending','sending')) then
    raise exception 'Legacy X jobs remain active';
  end if;
  if exists(select 1 from public.claim_livewire_push() where angle_id is null or post_id is not null) then
    raise exception 'Legacy push job was claimed';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','a8547777-7777-4777-8777-777777777777',true);
do $$
declare body jsonb; saved record; story record; initial_posts bigint;
begin
  select count(*) into initial_posts from public.livewire_posts;
  begin
    perform public.save_livewire_post('Old client',null,null,'Legacy',null,null);
    raise exception 'Old RPC accepted write';
  exception when raise_exception then
    if sqlerrm not like 'LIVEWIRE is retired.%' then raise; end if;
  end;
  begin
    perform public.save_livewire_post_to_x('Old client',null,null,'Legacy',null,null,true);
    raise exception 'Old X RPC accepted write';
  exception when raise_exception then
    if sqlerrm not like 'LIVEWIRE is retired.%' then raise; end if;
  end;
  select jsonb_build_object('kind','start','position','QB','slots',jsonb_agg(jsonb_build_object(
    'reason','Editorial opinion','player',jsonb_build_object(
      'id',n::text,'name','Player ' || n,'position','QB','teamId','9','teamAbbr','GB',
      'headshot','https://a.espncdn.com/photo.png','opponent','','opponentLogo','','matchup','TBD')
  ))) into body from generate_series(1,4) n;
  select * into saved from public.save_fantasy_graphic_publication(null,2200,7,body,0,'publish',
    'a8547777-7777-4777-8777-777777777777/a8548888-8888-4888-8888-888888888888.png',true);
  select * into story from public.angles where fantasy_graphic_id = saved.id;
  if story.id is null or story.status <> 'published' or story.themes <> array['fantasy']
    or story.title <> 'Week 7 Must Start Fantasy QB' or cardinality(story.image_paths) <> 1 then
    raise exception 'Start/Sit did not publish to Angle';
  end if;
  if not exists(select 1 from public.x_publications where source_type = 'angle' and source_id = story.id and status = 'pending') then
    raise exception 'Direct Angle X publication was lost';
  end if;
  perform public.save_fantasy_graphic_publication(saved.id,2200,7,body,1,'unpublish',null,false);
  if exists(select 1 from public.angles where id = story.id and status = 'published')
    or not exists(select 1 from public.x_publications where source_type = 'angle' and source_id = story.id and status = 'cancelled') then
    raise exception 'Unpublish did not retract Angle and cancel X';
  end if;
  perform public.save_fantasy_graphic_publication(saved.id,2200,7,body,2,'publish',
    'a8547777-7777-4777-8777-777777777777/a8548888-8888-4888-8888-888888888888.png',true);
  if (select count(*) from public.x_publications where source_type = 'angle' and source_id = story.id) <> 1 then
    raise exception 'Republish duplicated X';
  end if;
  if (select count(*) from public.livewire_posts) <> initial_posts then raise exception 'Archived rows changed'; end if;
end;
$$;
reset role;
rollback;
