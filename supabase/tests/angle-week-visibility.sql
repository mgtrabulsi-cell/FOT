begin;
do $$
declare story public.angles;
begin
  story := jsonb_populate_record(null::public.angles, jsonb_build_object(
    'season', 2200, 'week', 7, 'section', 'angle', 'status', 'published', 'game_id', 'NBA:0', 'published_at', now()));
  assert public.angle_visible_in_week(story, 2200, 8), 'New non-NFL story crosses weeks';
  assert public.angle_visible_in_week(story, 2199, 1), 'New non-NFL story crosses selected seasons';
  story.published_at := now() - interval '168 hours' + interval '1 millisecond';
  assert public.angle_visible_in_week(story, 2200, 8), 'Visible immediately before expiry, including DST weeks';
  story.published_at := now() - interval '168 hours';
  assert not public.angle_visible_in_week(story, 2200, 8), 'Expires at exactly 168 hours';
  assert public.angle_visible_in_week(story, 2200, 7), 'Expired post stays archived in original week';
  story.published_at := now() + interval '1 second';
  assert not public.angle_visible_in_week(story, 2200, 8), 'No future publication boost';
  story.published_at := now();
  story.game_id := 'COMBO:0';
  assert public.angle_visible_in_week(story, 2200, 8), 'Combo follows the seven-day cross-week rule';
  story.published_at := now() - interval '168 hours';
  assert not public.angle_visible_in_week(story, 2200, 8), 'Combo expires at 168 hours';
  assert public.angle_visible_in_week(story, 2200, 7), 'Combo remains in its original week';
  story.published_at := now();
  story.game_id := 'NFL:123';
  assert not public.angle_visible_in_week(story, 2200, 8), 'NFL remains week-specific';
  story.game_id := 'NHL:0';
  story.section := 'news';
  assert not public.angle_visible_in_week(story, 2200, 8), 'Fantasy News remains week-specific';
  story.section := 'angle';
  story.status := 'draft';
  assert not public.angle_visible_in_week(story, 2200, 8), 'Drafts remain week-specific';
end;
$$;
insert into auth.users(id) values ('a9571111-1111-4111-8111-111111111111');
insert into public.livewire_roles(user_id,role,display_name)
values ('a9571111-1111-4111-8111-111111111111','admin','Week visibility test');
set local role authenticated;
select set_config('request.jwt.claim.sub','a9571111-1111-4111-8111-111111111111',true);
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,status,section,news_types)
values
 ('a9571111-1111-4111-8111-111111111121',2200,7,'NBA:0','Test','team','','Other','Recent NBA','Story',true,'published','angle','{}'),
 ('a9571111-1111-4111-8111-111111111122',2200,7,'NFL:123','Test','team','','Other','Recent NFL','Story',true,'published','angle','{}'),
 ('a9571111-1111-4111-8111-111111111123',2200,7,'NHL:0','Test','team','','Other','Private NHL','',false,'draft','angle','{}'),
 ('a9571111-1111-4111-8111-111111111124',2200,7,'NHL:0','Test','team','','Other','Fantasy NHL','Story',true,'published','news','{news}');
reset role;
-- Publication timestamps are immutable to editors; age only this rollback fixture.
alter table public.angles disable trigger angle_picks_validation;
update public.angles set published_at = now() - interval '1 hour', revision = revision + 1
where id = 'a9571111-1111-4111-8111-111111111121';
alter table public.angles enable trigger angle_picks_validation;
set local role anon;
do $$
begin
  assert exists(select 1 from public.angle_week_feed(2200,8,'angle') where id='a9571111-1111-4111-8111-111111111121'), 'Guest sees recent NBA across weeks';
  assert not exists(select 1 from public.angle_week_feed(2200,8,'angle') where id in ('a9571111-1111-4111-8111-111111111122','a9571111-1111-4111-8111-111111111123')), 'No NFL or draft crossover';
  assert not exists(select 1 from public.angle_week_feed(2200,7,'angle') where id='a9571111-1111-4111-8111-111111111123'), 'Feed preserves draft RLS';
  assert not exists(select 1 from public.angle_week_feed(2200,8,'news') where id='a9571111-1111-4111-8111-111111111124'), 'No Fantasy News crossover';
  assert exists(select 1 from public.analyst_unread_items(2200,8) where kind='angle' and key='a9571111-1111-4111-8111-111111111121'), 'Unread matches feed';
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a9571111-1111-4111-8111-111111111111',true);
update public.angles set title='Edited NBA',revision=revision+1 where id='a9571111-1111-4111-8111-111111111121';
do $$
begin
  assert (select published_at = now() - interval '1 hour' from public.angles where id='a9571111-1111-4111-8111-111111111121'), 'Editing preserves original clock';
  perform public.mark_analyst_read('angle','a9571111-1111-4111-8111-111111111121');
  assert not exists(select 1 from public.analyst_unread_items(2200,8) where key='a9571111-1111-4111-8111-111111111121'), 'Read receipt follows post across weeks';
  assert exists(select 1 from public.angle_week_feed(2200,7,'angle') where id='a9571111-1111-4111-8111-111111111123'), 'Admin retains original-week draft access';
end;
$$;
reset role;
alter table public.angles disable trigger angle_picks_validation;
update public.angles set published_at=now() - interval '168 hours',revision=revision+1 where id='a9571111-1111-4111-8111-111111111121';
alter table public.angles enable trigger angle_picks_validation;
set local role anon;
do $$
begin
  assert not exists(select 1 from public.angle_week_feed(2200,8,'angle') where id='a9571111-1111-4111-8111-111111111121'), 'Expired story leaves other weeks';
  assert exists(select 1 from public.angle_week_feed(2200,7,'angle') where id='a9571111-1111-4111-8111-111111111121'), 'Expired story remains archived';
end;
$$;
select 'Angle week visibility: exact expiry, archive, sections, RLS, edits and unread passed' as result;
reset role;
rollback;
