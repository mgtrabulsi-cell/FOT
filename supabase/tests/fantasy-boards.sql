begin;
insert into auth.users(id) values
 ('a9581111-1111-4111-8111-111111111111'),('a9581111-1111-4111-8111-111111111112');
insert into public.livewire_roles(user_id,role,display_name)
values('a9581111-1111-4111-8111-111111111111','admin','Fantasy test');
set local role authenticated;
select set_config('request.jwt.claim.sub','a9581111-1111-4111-8111-111111111111',true);
do $$
declare picks jsonb := '[{"id":"123","name":"Test QB","position":"QB","teamId":"1","gameId":"NFL:123","headshot":""}]';
begin
  assert public.publish_matchup_board(2198,6,picks,0)=1,'Legacy publisher creates Top Performers';
  assert public.publish_fantasy_board(2198,6,picks,0,'hate')=1,'Hate Watch has its own revision';
  assert (select count(*) from public.matchup_boards where season=2198 and week=6)=2,'Independent boards coexist';
  assert exists(select 1 from public.fantasy_unread_items(2198,6) where kind='picks' and key='2198:6:1:123'),'Top unread';
  assert exists(select 1 from public.fantasy_unread_items(2198,6) where kind='hate' and key='2198:6:1:123'),'Hate unread';
  perform public.mark_fantasy_read('hate','2198:6:1:123');
  perform public.mark_fantasy_read('hate','2198:6:1:123');
  assert not exists(select 1 from public.fantasy_unread_items(2198,6) where kind='hate'),'Idempotent Hate receipt';
  assert exists(select 1 from public.fantasy_unread_items(2198,6) where kind='picks'),'Hate does not clear Top';
  perform public.mark_fantasy_read('picks','2198:6:1:123');
  assert not exists(select 1 from public.fantasy_unread_items(2198,6) where kind in ('hate','picks')),'Both independently read';
  assert public.publish_fantasy_board(2198,6,picks,1,'hate')=2,'Hate revision increments';
  assert (select revision from public.matchup_boards where season=2198 and week=6 and board_type='top')=1,'Top untouched';
  begin
    perform public.publish_fantasy_board(2198,6,picks,1,'hate');
    raise exception 'Stale Hate revision accepted';
  exception when raise_exception then
    if sqlerrm <> 'Another admin updated this week. Reload the published board before publishing' then raise; end if;
  end;
  begin
    perform public.publish_fantasy_board(2198,6,picks,0,'invalid');
    raise exception 'Invalid board accepted';
  exception when raise_exception then
    if sqlerrm <> 'Choose a valid Fantasy board' then raise; end if;
  end;
  begin
    perform public.publish_fantasy_board(2198,6,picks || picks,2,'hate');
    raise exception 'Duplicate Hate players accepted';
  exception when raise_exception then
    if sqlerrm <> 'A player can only be selected once' then raise; end if;
  end;
  begin
    perform public.mark_fantasy_read('hate','2198:6:2:999');
    raise exception 'Unpublished Hate player marked read';
  exception when insufficient_privilege then null; end;
  assert public.publish_fantasy_board(2198,7,'[]',0,'hate')=1,'Separate week';
  assert exists(select 1 from public.fantasy_unread_items(2198,7) where kind='hate' and key='2198:7:1:empty'),'Empty board notice';
  perform public.mark_fantasy_read('hate','2198:7:1:empty');
  assert not exists(select 1 from public.fantasy_unread_items(2198,7) where kind='hate'),'Empty notice read';
end;
$$;
select set_config('request.jwt.claim.sub','a9581111-1111-4111-8111-111111111112',true);
do $$
begin
  assert exists(select 1 from public.fantasy_unread_items(2198,6) where kind='hate'),'Member receipt is separate';
  begin
    perform public.publish_fantasy_board(2198,6,'[]',2,'hate');
    raise exception 'Member published Hate';
  exception when raise_exception then
    if sqlerrm <> 'Admin access is required to publish matchups' then raise; end if;
  end;
  begin
    update public.matchup_boards set picks='[]' where season=2198 and board_type='hate';
    raise exception 'Direct write accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  assert (select count(*) from public.matchup_boards where season=2198 and week=6)=2,'Guests see both boards';
  assert exists(select 1 from public.fantasy_unread_items(2198,6) where kind='hate'),'Guest unread targets';
  begin
    perform public.publish_fantasy_board(2198,6,'[]',2,'hate');
    raise exception 'Guest published Hate';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
delete from public.matchup_boards where season=2198 and week=6 and board_type='hate';
do $$
begin
  assert not exists(select 1 from public.matchup_reads where season=2198 and week=6 and board_type='hate'),'Hate deletion cascades its receipts';
  assert exists(select 1 from public.matchup_reads where season=2198 and week=6 and board_type='top'),'Top receipts retained';
end;
$$;
select 'Fantasy boards: independent publication, revisions, reads, empty notices, permissions and cascades passed' as result;
rollback;
