begin;
insert into auth.users(id) values ('e8541111-1111-4111-8111-111111111111');
insert into public.livewire_roles(user_id,role,display_name)
values ('e8541111-1111-4111-8111-111111111111','admin','CFB UFC test');
set local role authenticated;
select set_config('request.jwt.claim.sub','e8541111-1111-4111-8111-111111111111',true);
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,status,picks)
select id::uuid,2200,17,sport||':0',sport||' matchup','team','','Other',sport||' pick','Test analysis',true,'published',
jsonb_build_array(jsonb_build_object('id',pick_id,'text',sport||' selection','result','pending','category','straight'))
from (values
('e8541111-1111-4111-8111-111111111121','CFB','e8541111-1111-4111-8111-111111111131'),
('e8541111-1111-4111-8111-111111111122','UFC','e8541111-1111-4111-8111-111111111132')) as fixtures(id,sport,pick_id);
update public.angles set picks=jsonb_set(picks,'{0,result}','"hit"'),revision=revision+1
where id in ('e8541111-1111-4111-8111-111111111121','e8541111-1111-4111-8111-111111111122');
do $$
declare story public.angles;
begin
  for story in select * from public.angles where id in
    ('e8541111-1111-4111-8111-111111111121','e8541111-1111-4111-8111-111111111122') loop
    story.published_at := now()-interval '1 second';
    assert public.angle_visible_in_week(story,2200,18),'New sports cross week boundaries';
    assert story.picks->0->>'result'='hit','New sports settle normally';
    assert exists(select 1 from public.livewire_posts where angle_id=story.id and admin_picks=story.picks),'LIVEWIRE mirrors picks';
    story.published_at := now()-interval '169 hours';
    assert not public.angle_visible_in_week(story,2200,18),'New sports expire after seven days';
    assert public.angle_visible_in_week(story,2200,17),'Original-week archive remains';
  end loop;
end;
$$;
select 'CFB/UFC create, settle, mirror, cross-week visibility and archive checks passed' as result;
rollback;
