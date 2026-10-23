begin;
insert into auth.users(id) values ('c8541111-1111-4111-8111-111111111111');
insert into public.livewire_roles(user_id,role,display_name)
values('c8541111-1111-4111-8111-111111111111','admin','Pick category test');
set local role authenticated;
select set_config('request.jwt.claim.sub','c8541111-1111-4111-8111-111111111111',true);
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,picks,reviewed,status)
values('c8541111-1111-4111-8111-111111111121',2200,18,'NFL:123','Test','team','','Other','Types','Story',
'[{"id":"c8541111-1111-4111-8111-111111111131","text":"Straight","result":"hit"},
{"id":"c8541111-1111-4111-8111-111111111132","text":"Parlay","result":"hit","category":"parlay"},
{"id":"c8541111-1111-4111-8111-111111111133","text":"Sprinkle","result":"hit","category":"sprinkle"}]',true,'published');
do $$
begin
  assert exists(select 1 from public.angles where id='c8541111-1111-4111-8111-111111111121'
    and picks->0->>'category'='straight' and picks->1->>'category'='parlay'
    and picks->2->>'category'='sprinkle' and picks->1->>'result'='pending'),'Types stored, legacy defaults straight and new grades remain pending';
end;
$$;
reset role;
create temporary table category_baseline as select published_at from public.angles where id='c8541111-1111-4111-8111-111111111121';
create temporary table category_push_baseline as select count(*) as total from public.livewire_push_deliveries;
create temporary table category_x_baseline as select count(*) as total from public.x_publications;
set local role authenticated;
update public.angles set picks=jsonb_set(picks,'{1,result}','"hit"'), revision=revision+1
where id='c8541111-1111-4111-8111-111111111121';
update public.angles set picks=jsonb_set(picks,'{1,category}','"sprinkle"'), revision=revision+1
where id='c8541111-1111-4111-8111-111111111121';
do $$
begin
  assert exists(select 1 from public.angles where id='c8541111-1111-4111-8111-111111111121'
    and picks->1->>'category'='sprinkle' and picks->1->>'result'='hit'),'Category-only changes preserve grades';
  assert exists(select 1 from public.livewire_posts where angle_id='c8541111-1111-4111-8111-111111111121'
    and admin_picks->1->>'category'='sprinkle' and admin_picks->1->>'result'='hit'),'LIVEWIRE mirrors categories and grades';
  update public.angles set picks=jsonb_set(picks,'{1}',(picks->1)-'category'),revision=revision+1
  where id='c8541111-1111-4111-8111-111111111121';
  assert exists(select 1 from public.angles where id='c8541111-1111-4111-8111-111111111121'
    and picks->1->>'category'='sprinkle' and picks->1->>'result'='hit'),'Older clients cannot erase saved categories';
  begin
    update public.angles set picks=jsonb_set(picks,'{0,category}','"invalid"'),revision=revision+1
    where id='c8541111-1111-4111-8111-111111111121';
    raise exception 'Invalid category accepted';
  exception when raise_exception then
    if sqlerrm <> 'Pick type must be Straight, Parlay, or Sprinkle' then raise; end if;
  end;
  begin
    update public.angles set picks=jsonb_set(picks,'{0,category}','null'),revision=revision+1
    where id='c8541111-1111-4111-8111-111111111121';
    raise exception 'Null category accepted';
  exception when raise_exception then
    if sqlerrm <> 'Pick type must be Straight, Parlay, or Sprinkle' then raise; end if;
  end;
end;
$$;
reset role;
do $$
begin
  assert (select published_at from public.angles where id='c8541111-1111-4111-8111-111111111121')=(select published_at from category_baseline),'Publication date unchanged';
  assert (select count(*) from public.livewire_push_deliveries)=(select total from category_push_baseline),'Category changes never broadcast another alert';
  assert (select count(*) from public.x_publications)=(select total from category_x_baseline),'Category changes never queue another tweet';
end;
$$;
select 'Pick categories, defaults, grade preservation, old clients, validation, LIVEWIRE mirrors, dates, and no repeat alerts/tweets passed' as result;
rollback;
