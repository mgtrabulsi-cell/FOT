begin;
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
do $$
begin
  assert public.record_livewire_view('d9502222-2222-4222-8222-222222222221') = 3, 'Members register views';
  assert (select view_count from public.livewire_posts where id = 'd9502222-2222-4222-8222-222222222221') = 3, 'Totals are publicly readable';
end;
$$;
reset role;
rollback;
