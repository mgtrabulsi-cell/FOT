begin;
insert into auth.users(id) values
('c9541111-1111-4111-8111-111111111111'),
('c9541111-1111-4111-8111-111111111112'),
('c9541111-1111-4111-8111-111111111113');
insert into public.livewire_roles(user_id,role,display_name) values
('c9541111-1111-4111-8111-111111111111','owner','View test owner'),
('c9541111-1111-4111-8111-111111111112','admin','View test admin');
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,status,created_by) values
('c9541111-1111-4111-8111-111111111121',2200,18,'NFL:123','Test','team','','Other','View test','Story',true,'published','c9541111-1111-4111-8111-111111111111'),
('c9541111-1111-4111-8111-111111111122',2200,18,'NFL:123','Test','team','','Other','Draft test','',false,'draft','c9541111-1111-4111-8111-111111111111');
set local role anon;
do $$
begin
  assert public.record_angle_view('c9541111-1111-4111-8111-111111111121') is null,'Guests count without receiving totals';
  begin
    perform * from public.angle_view_counts;
    raise exception 'Guest accessed counts';
  exception when insufficient_privilege then null; end;
  begin
    perform public.record_angle_view('c9541111-1111-4111-8111-111111111122');
    raise exception 'Draft counted';
  exception when raise_exception then
    if sqlerrm <> 'Storyline is no longer published' then raise; end if;
  end;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9541111-1111-4111-8111-111111111113',true);
do $$
begin
  assert public.record_angle_view('c9541111-1111-4111-8111-111111111121') is null,'Members do not receive counts';
  assert not exists(select 1 from public.angle_view_counts),'Members cannot read totals';
end;
$$;
select set_config('request.jwt.claim.sub','c9541111-1111-4111-8111-111111111111',true);
do $$
begin
  assert public.record_angle_view('c9541111-1111-4111-8111-111111111121')=2,'Owner first view excluded';
  assert public.record_angle_view('c9541111-1111-4111-8111-111111111121')=2,'Owner repeat excluded';
  assert (select view_count from public.angle_view_counts where angle_id='c9541111-1111-4111-8111-111111111121')=2,'Owner reads audience counts';
end;
$$;
select set_config('request.jwt.claim.sub','c9541111-1111-4111-8111-111111111112',true);
do $$
begin
  assert public.record_angle_view('c9541111-1111-4111-8111-111111111121')=3,'Admin records view';
  assert (select view_count from public.angle_view_counts where angle_id='c9541111-1111-4111-8111-111111111121')=3,'Admin reads counts';
  begin
    update public.angle_view_counts set view_count=999;
    raise exception 'Admin changed total directly';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
delete from public.angles where id='c9541111-1111-4111-8111-111111111121';
do $$
begin
  assert not exists(select 1 from public.angle_view_counts where angle_id='c9541111-1111-4111-8111-111111111121'),'Count cascades';
  assert not exists(select 1 from public.angle_owner_views where angle_id='c9541111-1111-4111-8111-111111111121'),'Owner receipt cascades';
end;
$$;
select 'Angle views: guest/member privacy, admin/owner access, owner exclusion, draft exclusion, and cascades passed' as result;
rollback;
