begin;
insert into auth.users(id) values ('d8541111-1111-4111-8111-111111111111'),('d8541111-1111-4111-8111-111111111112');
insert into public.livewire_roles(user_id,role,display_name)
values('d8541111-1111-4111-8111-111111111111','admin','Review attachment test');
set local role authenticated;
select set_config('request.jwt.claim.sub','d8541111-1111-4111-8111-111111111111',true);
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,picks,reviewed,status)
values('d8541111-1111-4111-8111-111111111121',2200,17,'NBA:0','Test Away @ Home','team','','Other','Original picks','Original analysis',
'[{"id":"d8541111-1111-4111-8111-111111111131","text":"Original straight","result":"pending","category":"straight"},
{"id":"d8541111-1111-4111-8111-111111111132","text":"Original parlay","result":"pending","category":"parlay"},
{"id":"d8541111-1111-4111-8111-111111111133","text":"Pending sprinkle","result":"pending","category":"sprinkle"}]',true,'published'),
('d8541111-1111-4111-8111-111111111123',2200,17,'NFL:123','Unpublished','team','','Other','Private draft','Draft',
'[{"id":"d8541111-1111-4111-8111-111111111134","text":"Private pick","result":"pending"}]',true,'draft');
update public.angles set picks=jsonb_set(jsonb_set(picks,'{0,result}','"hit"'),'{1,result}','"miss"'),revision=revision+1
where id='d8541111-1111-4111-8111-111111111121';
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,review_picks,reviewed,status)
values('d8541111-1111-4111-8111-111111111122',2200,18,'NFL:123','Review week','team','','Other','Review post','Lessons learned',
'[{"story_id":"d8541111-1111-4111-8111-111111111121","pick_id":"d8541111-1111-4111-8111-111111111131","text":"FORGED","result":"miss","category":"parlay"}]',true,'published');
do $$
declare saved jsonb; baseline_revision integer;
begin
  select review_picks,revision into saved,baseline_revision from public.angles where id='d8541111-1111-4111-8111-111111111122';
  assert saved->0->>'text'='Original straight' and saved->0->>'result'='hit' and saved->0->>'category'='straight',
    'Server resolves original text, result and category, ignoring client claims';
  assert saved->0->>'week'='17' and saved->0->>'game_id'='NBA:0','Original week and sport retained';
  assert exists(select 1 from public.angles where id='d8541111-1111-4111-8111-111111111121' and picks->0->>'result'='hit' and revision=2),
    'Attaching never modifies the original pick or revision';
  assert exists(select 1 from public.angles where id='d8541111-1111-4111-8111-111111111122' and picks='[]' and pick=''),
    'Review adds no countable picks';
  assert exists(select 1 from public.livewire_posts where angle_id='d8541111-1111-4111-8111-111111111122' and admin_picks='[]' and review_picks=saved),
    'LIVEWIRE mirrors review separately from countable picks';
  begin
    update public.angles set review_picks=saved||saved,revision=revision+1 where id='d8541111-1111-4111-8111-111111111122';
    raise exception 'Duplicate accepted';
  exception when raise_exception then
    if sqlerrm <> 'A settled pick can only appear once per review post' then raise; end if;
  end;
  begin
    update public.angles set review_picks='[{"story_id":"d8541111-1111-4111-8111-111111111121","pick_id":"d8541111-1111-4111-8111-111111111133"}]',revision=revision+1
    where id='d8541111-1111-4111-8111-111111111122';
    raise exception 'Pending accepted';
  exception when raise_exception then
    if sqlerrm <> 'Only settled Hit or Miss picks can be reviewed' then raise; end if;
  end;
  begin
    update public.angles set review_picks='[{"story_id":"d8541111-1111-4111-8111-111111111123","pick_id":"d8541111-1111-4111-8111-111111111134"}]',revision=revision+1
    where id='d8541111-1111-4111-8111-111111111122';
    raise exception 'Draft accepted';
  exception when raise_exception then
    if sqlerrm <> 'The original story is no longer published. Choose another settled pick' then raise; end if;
  end;
  begin
    update public.angles set review_picks='[{"story_id":"d8541111-1111-4111-8111-111111111122","pick_id":"d8541111-1111-4111-8111-111111111131"}]',revision=revision+1
    where id='d8541111-1111-4111-8111-111111111122';
    raise exception 'Self reference accepted';
  exception when raise_exception then
    if sqlerrm <> 'Choose a settled pick from another published story' then raise; end if;
  end;
  begin
    update public.angles set review_picks='{}',revision=revision+1 where id='d8541111-1111-4111-8111-111111111122';
    raise exception 'Object accepted';
  exception when raise_exception then
    if sqlerrm <> 'Attach at most 20 settled picks for review' then raise; end if;
  end;
  assert exists(select 1 from public.angles where id='d8541111-1111-4111-8111-111111111122' and revision=baseline_revision and review_picks=saved),
    'Rejected writes leave working review intact';
end;
$$;
reset role;
create temporary table review_push_baseline as select count(*) total from public.livewire_push_deliveries;
create temporary table review_x_baseline as select count(*) total from public.x_publications;
set local role authenticated;
-- Adding a second reference and changing only its submitted metadata cannot regrade either original.
update public.angles set review_picks=review_picks||'[{"story_id":"d8541111-1111-4111-8111-111111111121","pick_id":"d8541111-1111-4111-8111-111111111132"}]'::jsonb,revision=revision+1
where id='d8541111-1111-4111-8111-111111111122';
update public.angles set review_picks=jsonb_set(review_picks,'{0,result}','"miss"'),revision=revision+1
where id='d8541111-1111-4111-8111-111111111122';
update public.angles set picks=jsonb_set(picks,'{0,result}','"miss"'),revision=revision+1
where id='d8541111-1111-4111-8111-111111111121';
delete from public.angles where id='d8541111-1111-4111-8111-111111111121';
update public.angles set narrative='Review still editable',revision=revision+1 where id='d8541111-1111-4111-8111-111111111122';
do $$
begin
  assert exists(select 1 from public.angles where id='d8541111-1111-4111-8111-111111111122'
    and review_picks->0->>'result'='hit' and review_picks->1->>'result'='miss' and jsonb_array_length(review_picks)=2 and picks='[]'),
    'Review snapshots survive tampering, source corrections/deletion, and editing';
end;
$$;
select set_config('request.jwt.claim.sub','d8541111-1111-4111-8111-111111111112',true);
do $$
begin
  update public.angles set review_picks='[]',revision=revision+1 where id='d8541111-1111-4111-8111-111111111122';
  assert not found,'Members cannot edit review references';
end;
$$;
reset role;
do $$
begin
  assert (select count(*) from public.livewire_push_deliveries) <= (select total from review_push_baseline),'Review edits do not rebroadcast alerts';
  assert (select count(*) from public.x_publications) <= (select total from review_x_baseline),'Review edits do not queue tweets';
end;
$$;
select 'Review canonicalization, settled-only selection, no duplicate records, LIVEWIRE, snapshots, permissions, and no repeat alerts/tweets passed' as result;
rollback;
