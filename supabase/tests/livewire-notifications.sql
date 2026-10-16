begin;
insert into auth.users(id) values
 ('d6902222-2222-4222-8222-222222222221'),
 ('d6902222-2222-4222-8222-222222222222');
insert into public.livewire_roles values('d6902222-2222-4222-8222-222222222221', 'admin', 'Push test');
insert into public.user_push_subscriptions(user_id, endpoint, subscription, notify_scores) values
 ('d6902222-2222-4222-8222-222222222221', 'https://example.invalid/livewire-one', '{}', true),
 ('d6902222-2222-4222-8222-222222222222', 'https://example.invalid/livewire-two', '{}', false);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd6902222-2222-4222-8222-222222222221', true);
select public.save_livewire_post('Test body', null, null, 'Push test headline', '{}', array['fantasy','news']);
do $$
begin
  begin
    perform public.claim_livewire_push();
    raise exception 'Member claimed notification queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.livewire_push_deliveries;
    raise exception 'Member read private notification queue';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
declare target uuid; original bigint; first_claim bigint[]; second_claim bigint[];
begin
  select id into target from public.livewire_posts where title = 'Push test headline';
  assert (select count(*) from public.livewire_push_deliveries where post_id = target and endpoint like 'https://example.invalid/livewire-%') = 2,
    'All enabled subscriptions receive LIVEWIRE, regardless of score preference or favorites';
  assert (select count(*) from public.livewire_push_deliveries where post_id = target and subject <> 'Push test headline') = 0,
    'Notification subject matches the headline';
  assert not exists(select 1 from public.livewire_push_deliveries where post_id = target and primary_theme is distinct from 'fantasy'),
    'First selected theme is captured, not alphabetical theme order';
  select count(*) into original from public.livewire_push_deliveries where post_id = target;
  perform public.save_livewire_post('Edited body', null, target, 'Edited title', '{}', array['betting']);
  assert (select count(*) from public.livewire_push_deliveries where post_id = target) = original, 'Editing does not broadcast again';
  assert not exists(select 1 from public.livewire_push_deliveries where post_id = target and primary_theme is distinct from 'fantasy'),
    'Edits do not change the original notification theme';
  select array_agg(id) into first_claim from public.claim_livewire_push();
  select array_agg(id) into second_claim from public.claim_livewire_push();
  assert not coalesce(first_claim && second_claim, false), 'Overlapping workers cannot reclaim leased deliveries';
  assert (select attempts from public.livewire_push_deliveries where post_id = target and endpoint = 'https://example.invalid/livewire-one') = 1,
    'Pending deliveries have a retry lease';
  delete from public.user_push_subscriptions where endpoint = 'https://example.invalid/livewire-two';
  assert not exists(select 1 from public.livewire_push_deliveries where post_id = target and endpoint = 'https://example.invalid/livewire-two'),
    'Disabling a device removes pending notifications';
  update public.livewire_push_deliveries set next_attempt_at = now() - interval '1 second'
    where post_id = target;
  perform public.claim_livewire_push();
  assert (select attempts from public.livewire_push_deliveries where post_id = target and endpoint = 'https://example.invalid/livewire-one') = 2,
    'Failed or interrupted deliveries can be retried';
  update public.livewire_push_deliveries set delivered_at = now(), next_attempt_at = now() - interval '1 second'
    where post_id = target;
  assert not exists(select 1 from public.claim_livewire_push() where post_id = target), 'Successful deliveries are not sent again';
  delete from public.livewire_posts where id = target;
  assert not exists(select 1 from public.livewire_push_deliveries where post_id = target), 'Deleting a post removes pending notifications';
end;
$$;
rollback;
