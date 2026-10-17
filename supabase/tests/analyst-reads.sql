begin;
insert into auth.users(id) values
 ('d9541111-1111-4111-8111-111111111111'), ('d9541111-1111-4111-8111-111111111112');
insert into public.livewire_roles(user_id,role,display_name) values
 ('d9541111-1111-4111-8111-111111111111','admin','Read rollback test');
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,status,created_by) values
 ('d9541111-1111-4111-8111-111111111121',2200,18,'NFL:123','Test matchup','team','','Other','Story one','Story',true,'published','d9541111-1111-4111-8111-111111111111'),
 ('d9541111-1111-4111-8111-111111111122',2200,18,'NFL:123','Test matchup','team','','Other','Story two','Story',true,'published','d9541111-1111-4111-8111-111111111111'),
 ('d9541111-1111-4111-8111-111111111123',2200,18,'NFL:123','Test matchup','team','','Other','Draft','',false,'draft','d9541111-1111-4111-8111-111111111111'),
 ('d9541111-1111-4111-8111-111111111124',2200,17,'NFL:123','Test matchup','team','','Other','Other week','Story',true,'published','d9541111-1111-4111-8111-111111111111');
insert into public.matchup_boards(season,week,picks,revision) values
 (2200,18,'[{"id":"11","name":"Test QB","position":"QB","teamId":"1","gameId":"NFL:123","headshot":""},{"id":"12","name":"Test RB","position":"RB","teamId":"1","gameId":"NFL:123","headshot":""}]',1);
set local role authenticated;
select set_config('request.jwt.claim.sub','d9541111-1111-4111-8111-111111111112',true);
do $$
begin
  assert (select count(*) from public.analyst_unread_items(2200,18)) = 4,'Two published stories and two picks, no drafts or other weeks';
  perform public.mark_analyst_read('angle','d9541111-1111-4111-8111-111111111121');
  perform public.mark_analyst_read('angle','d9541111-1111-4111-8111-111111111121');
  assert (select count(*) from public.analyst_unread_items(2200,18) where kind='angle') = 1,'Idempotent read leaves other story unread';
  perform public.mark_analyst_read('picks','2200:18:1:11');
  assert (select count(*) from public.analyst_unread_items(2200,18) where kind='picks') = 1,'Offscreen second pick remains unread';
  begin
    perform public.mark_analyst_read('angle','d9541111-1111-4111-8111-111111111123');
    raise exception 'Draft marked read';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mark_analyst_read('picks','2200:18:2:11');
    raise exception 'Future revision marked read';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mark_analyst_read('picks','2200:18:1:99');
    raise exception 'Nonexistent player marked read';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.angle_reads(user_id,angle_id) values
      ('d9541111-1111-4111-8111-111111111111','d9541111-1111-4111-8111-111111111122');
    raise exception 'Wrote another account receipt';
  exception when insufficient_privilege then null; end;
  perform public.mark_analyst_read('angle','d9541111-1111-4111-8111-111111111122');
  perform public.mark_analyst_read('picks','2200:18:1:12');
  assert not exists(select 1 from public.analyst_unread_items(2200,18)),'Every visible item clears unread';
end;
$$;
select set_config('request.jwt.claim.sub','d9541111-1111-4111-8111-111111111111',true);
do $$
begin
  assert not exists(select 1 from public.angle_reads),'Other account cannot see receipts';
  assert (select count(*) from public.analyst_unread_items(2200,18))=4,'Other account stays unread';
end;
$$;
reset role;
update public.matchup_boards set revision=2 where season=2200 and week=18;
set local role authenticated;
select set_config('request.jwt.claim.sub','d9541111-1111-4111-8111-111111111112',true);
do $$
begin
  assert (select count(*) from public.analyst_unread_items(2200,18))=2,'New published version unread, stories stay read';
end;
$$;
reset role;
update public.matchup_boards set revision=3,picks='[]' where season=2200 and week=18;
set local role authenticated;
do $$
begin
  assert exists(select 1 from public.analyst_unread_items(2200,18) where key='2200:18:3:empty'),'Published cleared board has readable notice';
  perform public.mark_analyst_read('picks','2200:18:3:empty');
  assert not exists(select 1 from public.analyst_unread_items(2200,18)),'Viewing empty-board update clears it';
end;
$$;
set local role anon;
do $$
begin
  assert not exists(select 1 from public.angle_reads),'Guests cannot read account receipts';
  assert (select count(*) from public.analyst_unread_items(2200,18))=3,'Guests get public targets only';
  begin
    perform public.mark_analyst_read('angle','d9541111-1111-4111-8111-111111111121');
    raise exception 'Guest wrote synced receipt';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
delete from auth.users where id='d9541111-1111-4111-8111-111111111112';
do $$
begin
  assert not exists(select 1 from public.angle_reads where user_id='d9541111-1111-4111-8111-111111111112'),'Account receipt cascade';
  assert not exists(select 1 from public.matchup_reads where user_id='d9541111-1111-4111-8111-111111111112'),'Account picks cascade';
end;
$$;
select 'Analyst receipts: isolation, visibility, revisions, weekly scope, guest targets, and cascades passed' as result;
rollback;
