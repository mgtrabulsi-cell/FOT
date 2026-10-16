begin;
insert into auth.users(id) values
 ('da102222-2222-4222-8222-222222222221'),
 ('da102222-2222-4222-8222-222222222222'),
 ('da102222-2222-4222-8222-222222222223');
insert into public.livewire_roles(user_id, role, display_name) values
 ('da102222-2222-4222-8222-222222222221', 'admin', 'Deletion test'),
 ('da102222-2222-4222-8222-222222222222', 'admin', 'Upload test');
insert into public.user_favorites(user_id, favorites) values
 ('da102222-2222-4222-8222-222222222221', '[]'),
 ('da102222-2222-4222-8222-222222222223', '[]');
insert into public.locker_room_history(user_id, season, week, entry_key, payload, observed_at) values
 ('da102222-2222-4222-8222-222222222221', 2199, 1, 'deletion-test', '{}', now());
insert into public.user_push_subscriptions(user_id, endpoint, subscription) values
 ('da102222-2222-4222-8222-222222222221', 'https://example.invalid/deletion-test', '{}');
insert into public.livewire_posts(author_id, author_name, title, body) values
 ('da102222-2222-4222-8222-222222222221', 'Deletion test', 'Deletion test', 'Private author data');
insert into public.matchup_boards(season, week, updated_by) values
 (2199, 1, 'da102222-2222-4222-8222-222222222221');
insert into storage.objects(bucket_id, name, owner_id) values
 ('livewire-photos', 'da102222-2222-4222-8222-222222222222/draft.png', 'da102222-2222-4222-8222-222222222222');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'da102222-2222-4222-8222-222222222222', true);
do $$
begin
  begin
    perform public.prepare_account_deletion('da102222-2222-4222-8222-222222222221');
    raise exception 'Browser invoked service-only deletion preparation';
  exception when insufficient_privilege then null; end;
  assert not public.account_deletion_in_progress(), 'No deletion before service confirmation';
end;
$$;
reset role;
do $$
begin
  assert (select count(*) from public.prepare_account_deletion('da102222-2222-4222-8222-222222222222')) = 1, 'Unpublished uploads are included';
  begin
    delete from auth.users where id = 'da102222-2222-4222-8222-222222222222';
    raise exception 'Account deleted before storage cleanup';
  exception when raise_exception then
    if sqlerrm <> 'Remove account uploads using the Storage API before deleting this account' then raise; end if;
  end;
end;
$$;
set local role authenticated;
do $$
begin
  assert public.account_deletion_in_progress();
  begin
    insert into storage.objects(bucket_id, name) values ('livewire-photos', 'da102222-2222-4222-8222-222222222222/new.png');
    raise exception 'New upload accepted during deletion';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select * from public.prepare_account_deletion('da102222-2222-4222-8222-222222222221');
delete from auth.users where id = 'da102222-2222-4222-8222-222222222221';
do $$
begin
  assert not exists(select 1 from public.user_favorites where user_id = 'da102222-2222-4222-8222-222222222221');
  assert not exists(select 1 from public.locker_room_history where user_id = 'da102222-2222-4222-8222-222222222221');
  assert not exists(select 1 from public.user_push_subscriptions where user_id = 'da102222-2222-4222-8222-222222222221');
  assert not exists(select 1 from public.livewire_push_deliveries where user_id = 'da102222-2222-4222-8222-222222222221');
  assert not exists(select 1 from public.livewire_roles where user_id = 'da102222-2222-4222-8222-222222222221');
  assert not exists(select 1 from public.livewire_posts where author_name = 'Deletion test');
  assert not exists(select 1 from public.account_deletion_requests where user_id = 'da102222-2222-4222-8222-222222222221');
  assert (select updated_by is null from public.matchup_boards where season = 2199 and week = 1), 'Shared board attribution removed';
  assert exists(select 1 from public.user_favorites where user_id = 'da102222-2222-4222-8222-222222222223'), 'Other accounts untouched';
end;
$$;
rollback;
