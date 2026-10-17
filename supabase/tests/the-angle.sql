begin;
insert into auth.users(id) values
 ('d9521111-1111-4111-8111-111111111111'), ('d9521111-1111-4111-8111-111111111112');
insert into public.livewire_roles(user_id, role, display_name)
values ('d9521111-1111-4111-8111-111111111111', 'admin', 'Angle test');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9521111-1111-4111-8111-111111111111', true);
insert into public.angles(id, season, week, game_id, matchup, kind, subject, category, title)
values ('d9521111-1111-4111-8111-111111111121', 2200, 18, 'NFL:123', 'Test away @ Test home', 'player', 'Test player', 'Former team', 'Private draft');
do $$
begin
  assert exists(select 1 from public.angles where id = 'd9521111-1111-4111-8111-111111111121'), 'Admin sees drafts';
  begin
    update public.angles set status = 'published', revision = revision + 1 where id = 'd9521111-1111-4111-8111-111111111121';
    raise exception 'Incomplete angle was published';
  exception when check_violation then null;
  end;
end;
$$;
set local role anon;
do $$
begin
  assert not exists(select 1 from public.angles where id = 'd9521111-1111-4111-8111-111111111121'), 'Guest cannot read drafts';
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9521111-1111-4111-8111-111111111112', true);
do $$
begin
  assert not exists(select 1 from public.angles where id = 'd9521111-1111-4111-8111-111111111121'), 'Member cannot read drafts';
  begin
    insert into public.angles(season, week, game_id, matchup, kind, subject, category, title)
    values (2200,18,'NFL:123','Test matchup','team','Test','Other','Unauthorized');
    raise exception 'Member created an angle';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd9521111-1111-4111-8111-111111111111', true);
update public.angles set narrative = 'An original editorial summary', evidence = 'Verified source context',
 counterpoint = 'A small sample is not predictive', source_url = 'https://www.espn.com/nfl/',
 source_label = 'ESPN', reviewed = true, status = 'published', revision = revision + 1
where id = 'd9521111-1111-4111-8111-111111111121' and revision = 1;
do $$
declare affected integer;
begin
  update public.angles set title = 'Stale edit', revision = 2 where id = 'd9521111-1111-4111-8111-111111111121' and revision = 1;
  get diagnostics affected = row_count;
  assert affected = 0, 'Stale revision cannot overwrite current angle';
  begin
    update public.angles set title = 'No revision increment' where id = 'd9521111-1111-4111-8111-111111111121';
    raise exception 'Revision was not enforced';
  exception when raise_exception then
    if sqlerrm = 'Revision was not enforced' then raise; end if;
  end;
end;
$$;
set local role anon;
do $$
begin
  assert exists(select 1 from public.angles where id = 'd9521111-1111-4111-8111-111111111121' and status = 'published'), 'Guest reads published angle';
end;
$$;
reset role;
delete from auth.users where id = 'd9521111-1111-4111-8111-111111111111';
do $$
begin
  assert not exists(select 1 from public.angles where id = 'd9521111-1111-4111-8111-111111111121'), 'Account deletion removes authored angles';
end;
$$;
select 'Angle draft isolation, publication, revision, and deletion tests passed' as result;
rollback;
