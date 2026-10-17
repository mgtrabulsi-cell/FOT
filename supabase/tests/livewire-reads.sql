begin;
insert into auth.users(id) values
 ('d9511111-1111-4111-8111-111111111111'),
 ('d9511111-1111-4111-8111-111111111112');
insert into public.livewire_posts(id, author_name, title, body) values
 ('d9511111-1111-4111-8111-111111111121', 'Read test', 'Unread test', 'Read status test');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9511111-1111-4111-8111-111111111111', true);
do $$
declare before_count bigint;
begin
  before_count := public.livewire_unread_count();
  insert into public.livewire_reads(user_id, post_id) values
    (auth.uid(), 'd9511111-1111-4111-8111-111111111121');
  assert public.livewire_unread_count() = before_count - 1, 'Seen post reduces unread count';
  insert into public.livewire_reads(user_id, post_id) values
    (auth.uid(), 'd9511111-1111-4111-8111-111111111121') on conflict do nothing;
  assert public.livewire_unread_count() = before_count - 1, 'Repeated receipt is idempotent';
  begin
    insert into public.livewire_reads(user_id, post_id) values
      ('d9511111-1111-4111-8111-111111111112', 'd9511111-1111-4111-8111-111111111121');
    raise exception 'Allowed another user receipt';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd9511111-1111-4111-8111-111111111112', true);
do $$
begin
  assert not exists(select 1 from public.livewire_reads), 'Another account cannot see receipts';
  assert public.livewire_unread_count() = (select count(*) from public.livewire_posts), 'Another account keeps all posts unread';
end;
$$;
reset role;
delete from public.livewire_posts where id = 'd9511111-1111-4111-8111-111111111121';
do $$
begin
  assert not exists(select 1 from public.livewire_reads where post_id = 'd9511111-1111-4111-8111-111111111121'), 'Post deletion removes receipts';
end;
$$;
set local role anon;
do $$
begin
  begin
    perform public.livewire_unread_count();
    raise exception 'Guest can read private unread totals';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
