begin;

create or replace function public.publish_fantasy_board(
  board_season integer, board_week integer, board_picks jsonb, expected_revision integer, board_kind text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare current_revision integer; pick jsonb;
begin
  if public.livewire_role() is null then raise exception 'Admin access is required to publish matchups'; end if;
  if public.account_deletion_in_progress() then raise exception 'Account deletion is in progress'; end if;
  if board_kind is null or board_kind not in ('top','hate') then raise exception 'Choose a valid Fantasy board'; end if;
  if board_season is null or board_season not between 2000 and 2200
    or board_week is null or board_week not between 1 and 18 then
    raise exception 'Choose a valid NFL season and week';
  end if;
  if board_picks is null or jsonb_typeof(board_picks) <> 'array' then raise exception 'Players must be a list'; end if;
  if jsonb_array_length(board_picks) > 16 then raise exception 'Publish up to four players per position'; end if;
  for pick in select value from jsonb_array_elements(board_picks) loop
    if jsonb_typeof(pick) <> 'object'
      or coalesce(pick->>'position', '') not in ('QB','RB','WR','TE')
      or jsonb_typeof(pick->'id') is distinct from 'string'
      or jsonb_typeof(pick->'teamId') is distinct from 'string'
      or jsonb_typeof(pick->'gameId') is distinct from 'string'
      or coalesce(pick->>'id', '') !~ '^[0-9]{1,15}$'
      or coalesce(pick->>'teamId', '') !~ '^[0-9]{1,10}$'
      or coalesce(pick->>'gameId', '') !~ '^NFL:[0-9]{1,15}$'
      or coalesce(char_length(btrim(pick->>'name')), 0) not between 1 and 120
      or jsonb_typeof(pick->'name') is distinct from 'string'
      or jsonb_typeof(pick->'headshot') is distinct from 'string'
      or char_length(pick->>'headshot') > 2048
      or ((pick->>'headshot') <> '' and (pick->>'headshot') !~ '^https://a[.]espncdn[.]com/')
      or (pick - array['id','name','position','teamId','gameId','headshot','breakdown']) <> '{}'::jsonb then
      raise exception 'Invalid player selection';
    end if;
    if pick ? 'breakdown' then
      if jsonb_typeof(pick->'breakdown') is distinct from 'string' then
        raise exception 'Player breakdown must be text';
      end if;
      if (select count(*) from regexp_matches(pick->>'breakdown',
        U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', 'g')) > 300 then
        raise exception 'Each player breakdown must be 300 words or fewer';
      end if;
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(board_picks) p group by p->>'position' having count(*) > 4) then
    raise exception 'Publish up to four players per position';
  end if;
  if exists(select 1 from jsonb_array_elements(board_picks) p group by p->>'id' having count(*) > 1) then
    raise exception 'A player can only be selected once';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(board_season, board_week);
  select revision into current_revision from public.matchup_boards
    where season = board_season and week = board_week and board_type = board_kind;
  if expected_revision is null or expected_revision <> coalesce(current_revision, 0) then
    raise exception 'Another admin updated this week. Reload the published board before publishing';
  end if;
  insert into public.matchup_boards(season,week,board_type,picks,revision,updated_by)
  values(board_season,board_week,board_kind,board_picks,1,auth.uid())
  on conflict(season,week,board_type) do update set picks=excluded.picks,
    revision=public.matchup_boards.revision+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  returning revision into current_revision;
  return current_revision;
end;
$$;
revoke all on function public.publish_fantasy_board(integer,integer,jsonb,integer,text) from public, anon;
grant execute on function public.publish_fantasy_board(integer,integer,jsonb,integer,text) to authenticated;

commit;
