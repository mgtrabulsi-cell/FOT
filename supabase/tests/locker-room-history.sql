begin;

insert into auth.users (id) values
  ('d6702222-2222-4222-8222-222222222221'),
  ('d6702222-2222-4222-8222-222222222222');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd6702222-2222-4222-8222-222222222221', true);

select public.save_locker_room_history(2026, 5, '[
  {"key":"score:test","payload":{"kind":"score","id":"score:test"},"observed_at":"2026-10-10T12:00:00Z"},
  {"key":"player:test","payload":{"kind":"player","game":{"status":"FINAL"},"stats":{"targets":9}},"observed_at":"2026-10-10T12:00:00Z"}
]'::jsonb);
select public.save_locker_room_history(2026, 6, '[
  {"key":"score:test","payload":{"kind":"score","id":"week-six"},"observed_at":"2026-10-14T12:00:00Z"}
]'::jsonb);
select public.save_locker_room_history(2026, 5, '[
  {"key":"player:test","payload":{"kind":"player","game":{"status":"LIVE"},"stats":{"targets":2}},"observed_at":"2026-10-14T12:00:00Z"},
  {"key":"score:test","payload":{"kind":"score","id":"stale"},"observed_at":"2026-10-09T12:00:00Z"}
]'::jsonb);

do $$
begin
  assert (select count(*) from public.locker_room_history) = 3, 'Week entries must not overwrite each other';
  assert (select payload->>'id' from public.locker_room_history where week = 5 and entry_key = 'score:test') = 'score:test', 'Older writes must not replace newer data';
  assert (select payload->'game'->>'status' from public.locker_room_history where week = 5 and entry_key = 'player:test') = 'FINAL', 'Live data must not replace final stats';
end;
$$;

select set_config('request.jwt.claim.sub', 'd6702222-2222-4222-8222-222222222222', true);
do $$
begin
  assert (select count(*) from public.locker_room_history) = 0, 'Another account must not see history';
  begin
    perform public.save_locker_room_history(2026, 5, '[]'::jsonb, 'd6702222-2222-4222-8222-222222222221');
    raise exception 'An account-mismatched save must fail';
  exception when raise_exception then
    if sqlerrm <> 'Sign in to save Locker Room history' then raise; end if;
  end;
end;
$$;
select public.save_locker_room_history(2026, 5, '[
  {"key":"score:test","payload":{"kind":"score","id":"second-account"},"observed_at":"2026-10-14T12:00:00Z"}
]'::jsonb);
do $$
begin
  assert (select count(*) from public.locker_room_history) = 1, 'Accounts must have independent history';
end;
$$;

reset role;
rollback;
