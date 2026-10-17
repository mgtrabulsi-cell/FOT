begin;
insert into auth.users(id) values
 ('d9502222-2222-4222-8222-222222222231'),
 ('d9502222-2222-4222-8222-222222222232'),
 ('d9502222-2222-4222-8222-222222222233');
insert into public.livewire_roles(user_id, role, display_name) values
 ('d9502222-2222-4222-8222-222222222231', 'owner', 'View test owner'),
 ('d9502222-2222-4222-8222-222222222232', 'admin', 'View test admin');
insert into public.livewire_posts(id, author_name, title, body)
values ('d9502222-2222-4222-8222-222222222221', 'View test', 'View headline', 'View test body');
set local role anon;
do $$
declare first_edit timestamptz; total bigint;
begin
  select updated_at into first_edit from public.livewire_posts where id = 'd9502222-2222-4222-8222-222222222221';
  total := public.record_livewire_view('d9502222-2222-4222-8222-222222222221');
  assert total = 1, 'Guests register views';
  total := public.record_livewire_view('d9502222-2222-4222-8222-222222222221');
  assert total = 2, 'Repeat appearances register again';
  assert (select updated_at = first_edit from public.livewire_posts where id = 'd9502222-2222-4222-8222-222222222221'), 'Views must not mark posts edited';
  begin
    update public.livewire_posts set view_count = 100 where id = 'd9502222-2222-4222-8222-222222222221';
    raise exception 'Direct count overwrite allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_livewire_view('d9502222-2222-4222-8222-222222222222');
    raise exception 'Missing post accepted';
  exception when raise_exception then
    if sqlerrm <> 'Post is no longer available' then raise; end if;
  end;
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9502222-2222-4222-8222-222222222233', true);
do $$
begin
  assert public.record_livewire_view('d9502222-2222-4222-8222-222222222221') = 3, 'Members register views';
  assert public.record_livewire_view('d9502222-2222-4222-8222-222222222221') = 4, 'Member repeats still count';
end;
$$;
select set_config('request.jwt.claim.sub', 'd9502222-2222-4222-8222-222222222232', true);
do $$
begin
  assert public.record_livewire_view('d9502222-2222-4222-8222-222222222221') = 5, 'Admins register views';
  assert public.record_livewire_view('d9502222-2222-4222-8222-222222222221') = 6, 'Admin repeats still count';
end;
$$;
select set_config('request.jwt.claim.sub', 'd9502222-2222-4222-8222-222222222231', true);
do $$
begin
  assert public.record_livewire_view('d9502222-2222-4222-8222-222222222221') = 7, 'Owner first view counts';
  assert public.record_livewire_view('d9502222-2222-4222-8222-222222222221') = 7, 'Owner repeat does not count';
  begin
    delete from public.livewire_owner_views;
    raise exception 'Owner deleted view receipts directly';
  exception when insufficient_privilege then null;
  end;
  assert (select view_count from public.livewire_posts where id = 'd9502222-2222-4222-8222-222222222221') = 7, 'Totals are publicly readable';
end;
$$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  assert public.record_livewire_view('d9502222-2222-4222-8222-222222222221') = 8, 'Guests still count after owner view';
  assert public.record_livewire_view('d9502222-2222-4222-8222-222222222221') = 9, 'Guest repeats still count';
  begin
    perform 1 from public.livewire_owner_views;
    raise exception 'Guest read owner receipts';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9502222-2222-4222-8222-222222222231', true);
do $$
begin
  assert public.record_livewire_view('d9502222-2222-4222-8222-222222222221') = 9, 'Owner repeat returns latest total without incrementing';
end;
$$;
reset role;
do $$
begin
  assert (select count(*) from public.livewire_owner_views where user_id = 'd9502222-2222-4222-8222-222222222231') = 1, 'One receipt per owner/post';
  delete from auth.users where id = 'd9502222-2222-4222-8222-222222222231';
  assert not exists(select 1 from public.livewire_owner_views where user_id = 'd9502222-2222-4222-8222-222222222231'), 'Account deletion removes owner receipt';
end;
$$;
rollback;
