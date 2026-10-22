begin;
insert into auth.users(id) values
 ('b9581111-1111-4111-8111-111111111111'),('b9581111-1111-4111-8111-111111111112');
insert into public.livewire_roles(user_id,role,display_name)
values('b9581111-1111-4111-8111-111111111111','admin','Breakdown test');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9581111-1111-4111-8111-111111111111',true);
do $$
declare pick jsonb := '{"id":"123","name":"Test QB","position":"QB","teamId":"1","gameId":"NFL:123","headshot":""}';
  kind text; bad jsonb; expected integer;
begin
  foreach kind in array array['top','hate'] loop
    assert public.publish_fantasy_board(2197,6,jsonb_build_array(pick),0,kind)=1,'Legacy picks supported';
    assert public.publish_fantasy_board(2197,6,jsonb_build_array(pick || jsonb_build_object('breakdown',repeat('word ',300))),1,kind)=2,'Exactly 300 words accepted';
    assert (select picks->0->>'breakdown' from public.matchup_boards where season=2197 and week=6 and board_type=kind)=repeat('word ',300),'Breakdown retained';
    expected := 2;
    foreach bad in array array[
      jsonb_build_object('breakdown',repeat('word ',301)),
      jsonb_build_object('breakdown',repeat('word' || chr(160),301)),
      jsonb_build_object('breakdown',repeat('word' || chr(8195),301))
    ] loop
      begin
        perform public.publish_fantasy_board(2197,6,jsonb_build_array(pick || bad),expected,kind);
        raise exception 'Over-limit breakdown accepted';
      exception when raise_exception then
        if sqlerrm <> 'Each player breakdown must be 300 words or fewer' then raise; end if;
      end;
    end loop;
    foreach bad in array array['{"breakdown":null}'::jsonb,'{"breakdown":42}'::jsonb,'{"breakdown":[]}'::jsonb] loop
      begin
        perform public.publish_fantasy_board(2197,6,jsonb_build_array(pick || bad),expected,kind);
        raise exception 'Invalid breakdown type accepted';
      exception when raise_exception then
        if sqlerrm <> 'Player breakdown must be text' then raise; end if;
      end;
    end loop;
    begin
      perform public.publish_fantasy_board(2197,6,jsonb_build_array(pick || '{"unexpected":""}'),expected,kind);
      raise exception 'Unexpected field accepted';
    exception when raise_exception then
      if sqlerrm <> 'Invalid player selection' then raise; end if;
    end;
    assert public.publish_fantasy_board(2197,6,jsonb_build_array(pick || '{"breakdown":"Updated analysis\nSecond paragraph"}'),2,kind)=3,'Edits update revision';
    begin
      perform public.publish_fantasy_board(2197,6,jsonb_build_array(pick || '{"breakdown":"Stale analysis"}'),2,kind);
      raise exception 'Stale edit accepted';
    exception when raise_exception then
      if sqlerrm <> 'Another admin updated this week. Reload the published board before publishing' then raise; end if;
    end;
    assert public.publish_fantasy_board(2197,7,jsonb_build_array(pick || '{"breakdown":""}'),0,kind)=1,'Empty breakdown accepted in another week';
  end loop;
end;
$$;
select set_config('request.jwt.claim.sub','b9581111-1111-4111-8111-111111111112',true);
do $$
begin
  assert (select picks->0->>'breakdown' from public.matchup_boards where season=2197 and week=6 and board_type='top')=E'Updated analysis\nSecond paragraph','Member reads published breakdown';
  begin
    perform public.publish_fantasy_board(2197,6,'[]',3,'top');
    raise exception 'Member modified breakdown';
  exception when raise_exception then
    if sqlerrm <> 'Admin access is required to publish matchups' then raise; end if;
  end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  assert (select picks->0->>'breakdown' from public.matchup_boards where season=2197 and week=6 and board_type='hate')=E'Updated analysis\nSecond paragraph','Guest reads published breakdown';
  begin
    perform public.publish_fantasy_board(2197,6,'[]',3,'hate');
    raise exception 'Guest modified breakdown';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'Fantasy breakdown boundaries, publication, edit conflicts and permissions passed' as result;
rollback;
