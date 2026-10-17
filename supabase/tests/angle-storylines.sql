begin;
insert into auth.users(id) values
 ('d9531111-1111-4111-8111-111111111111'), ('d9531111-1111-4111-8111-111111111112');
insert into public.livewire_roles(user_id, role, display_name)
values ('d9531111-1111-4111-8111-111111111111', 'admin', 'Storyline rollback test');
insert into public.user_push_subscriptions(user_id, endpoint, subscription, notify_scores) values
 ('d9531111-1111-4111-8111-111111111111', 'https://example.invalid/storyline-one', '{}', true),
 ('d9531111-1111-4111-8111-111111111112', 'https://example.invalid/storyline-two', '{}', false);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9531111-1111-4111-8111-111111111111', true);
insert into public.angles(id, season, week, game_id, matchup, kind, subject, category, title)
values ('d9531111-1111-4111-8111-111111111121', 2200, 18, 'NFL:123', 'Test matchup', 'team', '', 'Other', 'Headline only');
do $$
begin
  begin
    update public.angles set status = 'published', reviewed = true, revision = revision + 1
    where id = 'd9531111-1111-4111-8111-111111111121';
    raise exception 'Missing storyline was published';
  exception when check_violation then null;
  end;
  begin
    perform count(*) from public.angle_push_publications;
    raise exception 'Member read private publication receipts';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
begin
  assert not exists(select 1 from public.livewire_push_deliveries where angle_id = 'd9531111-1111-4111-8111-111111111121'), 'Draft never queues';
end;
$$;
set local role authenticated;
update public.angles set narrative = 'One storyline box', reviewed = true, status = 'published', revision = revision + 1
where id = 'd9531111-1111-4111-8111-111111111121';
reset role;
do $$
begin
  assert (select count(*) from public.livewire_push_deliveries where angle_id = 'd9531111-1111-4111-8111-111111111121'
    and endpoint like 'https://example.invalid/storyline-%') = 2, 'Publication queues both score preferences';
  assert not exists(select 1 from public.livewire_push_deliveries where angle_id = 'd9531111-1111-4111-8111-111111111121'
    and (subject <> 'Headline only' or post_id is not null)), 'Headline snapshot and exclusive content ID';
end;
$$;
set local role authenticated;
update public.angles set title = 'Edited headline', revision = revision + 1
where id = 'd9531111-1111-4111-8111-111111111121';
reset role;
do $$
begin
  assert not exists(select 1 from public.livewire_push_deliveries where angle_id = 'd9531111-1111-4111-8111-111111111121'
    and subject <> 'Headline only'), 'Editing does not change queued title';
  update public.livewire_push_deliveries set delivered_at = now()
  where angle_id = 'd9531111-1111-4111-8111-111111111121' and endpoint = 'https://example.invalid/storyline-one';
end;
$$;
set local role authenticated;
update public.angles set status = 'draft', revision = revision + 1 where id = 'd9531111-1111-4111-8111-111111111121';
reset role;
do $$
begin
  assert not exists(select 1 from public.livewire_push_deliveries where angle_id = 'd9531111-1111-4111-8111-111111111121'
    and delivered_at is null), 'Unpublishing cancels pending';
end;
$$;
set local role authenticated;
update public.angles set status = 'published', revision = revision + 1 where id = 'd9531111-1111-4111-8111-111111111121';
reset role;
do $$
begin
  assert not exists(select 1 from public.livewire_push_deliveries where angle_id = 'd9531111-1111-4111-8111-111111111121'
    and delivered_at is null), 'Republication never rebroadcasts';
  delete from public.user_push_subscriptions where endpoint = 'https://example.invalid/storyline-one';
  assert not exists(select 1 from public.livewire_push_deliveries where angle_id = 'd9531111-1111-4111-8111-111111111121'), 'Unsubscribe cascades';
  delete from public.angles where id = 'd9531111-1111-4111-8111-111111111121';
  assert not exists(select 1 from public.angle_push_publications where angle_id = 'd9531111-1111-4111-8111-111111111121'), 'Deletion clears receipts';
end;
$$;
insert into public.angles(id, season, week, game_id, matchup, kind, subject, category, title, narrative, reviewed, status, created_by)
values ('d9531111-1111-4111-8111-111111111122', 2200, 18, 'NFL:123', 'Test matchup', 'team', '', 'Other',
 'Direct publication', 'Storyline without other boxes', true, 'published', 'd9531111-1111-4111-8111-111111111111');
do $$
begin
  assert exists(select 1 from public.angle_push_publications where angle_id = 'd9531111-1111-4111-8111-111111111122'),
    'Direct published inserts record first publication';
  assert exists(select 1 from public.livewire_push_deliveries where angle_id = 'd9531111-1111-4111-8111-111111111122'
    and endpoint = 'https://example.invalid/storyline-two'), 'Direct publication queues existing enabled devices';
end;
$$;
select 'Storyline publication, simplified fields, notification snapshots, cancellation, permissions, and cascades passed' as result;
rollback;
