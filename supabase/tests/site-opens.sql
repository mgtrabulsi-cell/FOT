begin;
insert into auth.users(id, email, created_at, raw_user_meta_data) values
 ('d9503333-3333-4333-8333-333333333331', 'opens-owner@example.test', now(), '{"display_name":"Opens owner"}'),
 ('d9503333-3333-4333-8333-333333333332', 'opens-admin@example.test', now(), '{}'),
 ('d9503333-3333-4333-8333-333333333333', 'opens-member@example.test', now(), '{"display_name":" Member "}');
insert into public.livewire_roles(user_id, role, display_name) values
 ('d9503333-3333-4333-8333-333333333331', 'owner', 'Opens owner'),
 ('d9503333-3333-4333-8333-333333333332', 'admin', 'Opens admin');
insert into public.user_push_subscriptions(user_id, endpoint, subscription, notify_scores) values
 ('d9503333-3333-4333-8333-333333333333', 'https://example.invalid/owner-status-1', '{}', true),
 ('d9503333-3333-4333-8333-333333333333', 'https://example.invalid/owner-status-2', '{}', false),
 ('d9503333-3333-4333-8333-333333333331', 'https://example.invalid/owner-status-3', '{}', false);

set local role anon;
do $$
begin
  begin
    perform public.record_site_open();
    raise exception 'Guest recorded an open';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_user_activity();
    raise exception 'Guest listed users';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9503333-3333-4333-8333-333333333333', true);
do $$
begin
  assert public.record_site_open() = 1, 'First open counts';
  assert public.record_site_open() = 1, 'Rapid repeat open is throttled';
  begin
    perform 1 from public.site_opens;
    raise exception 'Member read open counts directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.owner_user_activity();
    raise exception 'Member listed users';
  exception when raise_exception then
    if sqlerrm <> 'Owner access is required' then raise; end if;
  end;
end;
$$;
reset role;
update public.site_opens set last_opened_at = now() - interval '1 minute' where user_id = 'd9503333-3333-4333-8333-333333333333';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9503333-3333-4333-8333-333333333333', true);
do $$ begin assert public.record_site_open() = 2, 'Later open counts again'; end; $$;
select set_config('request.jwt.claim.sub', 'd9503333-3333-4333-8333-333333333332', true);
do $$
begin
  begin
    perform public.owner_user_activity();
    raise exception 'Admin listed users';
  exception when raise_exception then
    if sqlerrm <> 'Owner access is required' then raise; end if;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd9503333-3333-4333-8333-333333333331', true);
do $$
declare member record; admin record;
begin
  assert public.record_site_open() is null, 'Owner opens are excluded';
  select * into member from public.owner_user_activity() a where a.user_id = 'd9503333-3333-4333-8333-333333333333';
  assert member.open_count = 2 and member.email = 'opens-member@example.test' and member.display_name = 'Member', 'Owner sees member opens';
  assert member.notification_devices = 2 and member.score_alert_devices = 1, 'Count devices, not opens, and distinguish score preference';
  select * into admin from public.owner_user_activity() a where a.user_id = 'd9503333-3333-4333-8333-333333333332';
  assert admin.open_count = 0 and admin.last_opened_at is null and admin.display_name is null, 'Users without opens are listed with zero';
  assert admin.notification_devices = 0 and admin.score_alert_devices = 0, 'No subscriptions means no registered devices';
  assert exists(select 1 from public.owner_user_activity() a where a.user_id = 'd9503333-3333-4333-8333-333333333331'
    and a.notification_devices = 1 and a.score_alert_devices = 0), 'Owner devices still show without counting owner opens';
end;
$$;
reset role;
delete from public.user_push_subscriptions where endpoint = 'https://example.invalid/owner-status-1';
set local role authenticated;
do $$
begin
  assert exists(select 1 from public.owner_user_activity() a where a.user_id = 'd9503333-3333-4333-8333-333333333333'
    and a.notification_devices = 1 and a.score_alert_devices = 0), 'Removed subscriptions disappear from dashboard';
end;
$$;
reset role;

do $$
begin
  assert not exists(select 1 from public.site_opens where user_id = 'd9503333-3333-4333-8333-333333333331'), 'No owner analytics row created';
  delete from auth.users where id = 'd9503333-3333-4333-8333-333333333333';
  assert not exists(select 1 from public.site_opens where user_id = 'd9503333-3333-4333-8333-333333333333'), 'Account deletion removes open counts';
end;
$$;
rollback;
