begin;
insert into auth.users(id) values
('b8541111-1111-4111-8111-111111111111'),('b8541111-1111-4111-8111-111111111112');
insert into public.livewire_roles(user_id,role,display_name)
values('b8541111-1111-4111-8111-111111111111','admin','Results test');
create temporary table result_delivery_baseline as select count(*) as total from public.livewire_push_deliveries;
set local role authenticated;
select set_config('request.jwt.claim.sub','b8541111-1111-4111-8111-111111111111',true);
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,pick,reviewed,status)
values('b8541111-1111-4111-8111-111111111121',2200,18,'NFL:123','Test','team','','Other','Legacy','Story','Legacy combined pick',true,'published');
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,picks,reviewed,status)
values('b8541111-1111-4111-8111-111111111122',2200,18,'NFL:123','Test','team','','Other','Separate','Story',
'[{"id":"b8541111-1111-4111-8111-111111111131","text":"Team ML","result":"hit"},
{"id":"b8541111-1111-4111-8111-111111111132","text":"Player TD","result":"miss"}]',true,'published');
do $$
begin
  assert exists(select 1 from public.angles where id='b8541111-1111-4111-8111-111111111121'
    and jsonb_array_length(picks)=1 and picks->0->>'result'='pending' and published_at is not null),'Legacy pick migrated pending';
  assert exists(select 1 from public.angles where id='b8541111-1111-4111-8111-111111111122'
    and picks->0->>'result'='pending' and picks->1->>'result'='pending'),'New picks always start pending';
end;
$$;
reset role;
create temporary table result_publication_baseline as select published_at from public.angles where id='b8541111-1111-4111-8111-111111111122';
create temporary table result_push_baseline as select count(*) as total from public.livewire_push_deliveries;
set local role authenticated;
update public.angles set picks=jsonb_set(jsonb_set(picks,'{0,result}','"hit"'),'{1,result}','"miss"'),revision=revision+1
where id='b8541111-1111-4111-8111-111111111122' and revision=1;
do $$
begin
  assert exists(select 1 from public.livewire_posts where angle_id='b8541111-1111-4111-8111-111111111122'
    and admin_picks->0->>'result'='hit' and admin_picks->1->>'result'='miss' and admin_pick='Team ML' and body='Story'),'Independent grades mirror';
  update public.angles set picks='[]',revision=2 where id='b8541111-1111-4111-8111-111111111122' and revision=1;
  assert not found,'Stale revisions do not overwrite grades';
  begin
    update public.angles set picks='[{"id":"invalid","text":"Bad","result":"win"}]',revision=revision+1 where id='b8541111-1111-4111-8111-111111111122';
    raise exception 'Invalid picks accepted';
  exception when raise_exception then
    if sqlerrm <> 'Each admin pick needs a unique ID, 1-500 characters, and a valid result' then raise; end if;
  end;
end;
$$;
update public.angles set title='Unrelated edit',revision=revision+1 where id='b8541111-1111-4111-8111-111111111122';
update public.angles set picks=jsonb_build_array(picks->1,picks->0),revision=revision+1 where id='b8541111-1111-4111-8111-111111111122';
do $$
begin
  assert exists(select 1 from public.angles where id='b8541111-1111-4111-8111-111111111122'
    and picks->0->>'result'='miss' and picks->1->>'result'='hit'),'Unrelated edits and reorder retain results';
end;
$$;
update public.angles set picks=jsonb_set(picks,'{0,text}','"Different TD"'),revision=revision+1 where id='b8541111-1111-4111-8111-111111111122';
do $$
begin
  assert exists(select 1 from public.angles where id='b8541111-1111-4111-8111-111111111122'
    and picks->0->>'result'='pending' and picks->1->>'result'='hit'),'Changed text resets only that result';
end;
$$;
select set_config('request.jwt.claim.sub','b8541111-1111-4111-8111-111111111112',true);
do $$
begin
  update public.angles set picks='[]',revision=revision+1 where id='b8541111-1111-4111-8111-111111111122';
  assert not found,'Members cannot grade';
end;
$$;
reset role;
do $$
begin
  assert (select published_at from public.angles where id='b8541111-1111-4111-8111-111111111122')=(select published_at from result_publication_baseline),'Grading preserves first publication order';
  assert (select count(*) from public.livewire_push_deliveries)=(select total from result_push_baseline),'Grading never pushes again';
end;
$$;
set local role anon;
do $$
begin
  assert exists(select 1 from public.angles where id='b8541111-1111-4111-8111-111111111122' and picks->1->>'result'='hit'),'Guests read public grades';
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','b8541111-1111-4111-8111-111111111111',true);
update public.angles set status='draft',revision=revision+1 where id='b8541111-1111-4111-8111-111111111122';
set local role anon;
do $$
begin
  assert not exists(select 1 from public.angles where id='b8541111-1111-4111-8111-111111111122'),'Unpublished results private';
  assert not exists(select 1 from public.livewire_posts where angle_id='b8541111-1111-4111-8111-111111111122'),'Unpublished mirror removed';
end;
$$;
reset role;
select 'Angle results: separate picks, grading, revisions, reset, mirror, publication order, permissions, and single notification passed' as result;
rollback;
