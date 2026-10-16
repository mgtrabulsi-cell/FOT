begin;
insert into auth.users(id) values
 ('d8002222-2222-4222-8222-222222222221'),
 ('d8002222-2222-4222-8222-222222222222');
insert into public.livewire_roles values ('d8002222-2222-4222-8222-222222222221', 'admin', 'Matchup editor');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd8002222-2222-4222-8222-222222222221', true);
do $$
declare picks jsonb; revision integer; grouped jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', i::text, 'name', 'Player ' || i, 'position', 'QB',
    'teamId', '1', 'gameId', 'NFL:123', 'headshot', '') order by i) into picks from generate_series(1,4) i;
  revision := public.publish_matchup_board(2199, 6, picks, 0);
  assert revision = 1;
  assert (select board.picks->0->>'id' from public.matchup_boards board where season = 2199 and week = 6) = '1';
  begin
    perform public.publish_matchup_board(2199, 6, picks, 0);
    raise exception 'Stale revision accepted';
  exception when raise_exception then
    if sqlerrm <> 'Another admin updated this week. Reload the published board before publishing' then raise; end if;
  end;
  begin
    perform public.publish_matchup_board(2199, 6, picks || jsonb_build_array(jsonb_build_object('id','5','name','Fifth','position','QB','teamId','1','gameId','NFL:123','headshot','')), 1);
    raise exception 'Fifth QB accepted';
  exception when raise_exception then
    if sqlerrm <> 'Publish up to four players per position' then raise; end if;
  end;
  begin
    perform public.publish_matchup_board(2199, 6, jsonb_build_array(picks->0, picks->0), 1);
    raise exception 'Duplicate player accepted';
  exception when raise_exception then
    if sqlerrm <> 'A player can only be selected once' then raise; end if;
  end;
  begin
    perform public.publish_matchup_board(2199, 6, jsonb_build_array((picks->0) || '{"id":1}'::jsonb), 1);
    raise exception 'Numeric player ID accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid player selection' then raise; end if;
  end;
  grouped := picks;
  for pos in 1..3 loop
    grouped := grouped || (
      select jsonb_agg(jsonb_build_object('id', (pos * 4 + i)::text, 'name', 'Player', 'position', (array['RB','WR','TE'])[pos],
        'teamId', '1', 'gameId', 'NFL:123', 'headshot', '') order by i) from generate_series(1,4) i
    );
  end loop;
  revision := public.publish_matchup_board(2199, 6, grouped, 1);
  assert revision = 2;
  assert (select jsonb_array_length(board.picks) from public.matchup_boards board where season = 2199 and week = 6) = 16;
  revision := public.publish_matchup_board(2199, 6, jsonb_build_array(picks->3, picks->0, picks->1, picks->2), 2);
  assert (select board.picks->0->>'id' from public.matchup_boards board where season = 2199 and week = 6) = '4', 'Editorial ordering persists';
  perform public.publish_matchup_board(2199, 7, '[]', 0);
  assert (select jsonb_array_length(board.picks) from public.matchup_boards board where season = 2199 and week = 6) = 4, 'Weeks stay isolated';
end;
$$;
select set_config('request.jwt.claim.sub', 'd8002222-2222-4222-8222-222222222222', true);
do $$
begin
  begin
    perform public.publish_matchup_board(2199, 6, '[]', 3);
    raise exception 'Reader published a board';
  exception when raise_exception then
    if sqlerrm <> 'Admin access is required to publish matchups' then raise; end if;
  end;
  begin
    update public.matchup_boards set picks = '[]' where season = 2199;
    raise exception 'Direct write accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  assert (select count(*) from public.matchup_boards where season = 2199) = 2, 'Guests can read published boards';
end;
$$;
reset role;
rollback;
