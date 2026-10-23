begin;
insert into auth.users(id,email,created_at) values
 ('f9503333-3333-4333-8333-333333333331','guest-owner@example.test',now()),
 ('f9503333-3333-4333-8333-333333333332','guest-member@example.test',now());
insert into public.livewire_roles(user_id,role,display_name) values
 ('f9503333-3333-4333-8333-333333333331','owner','Guest test owner');
set local role anon;
select public.record_guest_site_open('f9503333-3333-4333-8333-333333333339');
select public.record_guest_site_open('f9503333-3333-4333-8333-333333333339');
do $$ begin
  begin perform 1 from public.guest_site_opens; raise exception 'Guest read private table';
  exception when insufficient_privilege then null; end;
  begin perform public.owner_guest_activity(); raise exception 'Guest read aggregates';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$ begin
  assert (select open_count=1 from public.guest_site_opens where session_id='f9503333-3333-4333-8333-333333333339'), 'Rapid repeats deduplicate';
end; $$;
update public.guest_site_opens set last_opened_at=now()-interval '31 minutes'
where session_id='f9503333-3333-4333-8333-333333333339';
set local role anon;
select public.record_guest_site_open('f9503333-3333-4333-8333-333333333339');
reset role;
do $$ begin
  assert (select open_count=2 from public.guest_site_opens where session_id='f9503333-3333-4333-8333-333333333339'), 'Later return counts';
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','f9503333-3333-4333-8333-333333333332',true);
do $$ begin
  begin perform public.owner_guest_activity(); raise exception 'Member read aggregates';
  exception when raise_exception then if sqlerrm <> 'Owner access is required' then raise; end if; end;
end; $$;
select set_config('request.jwt.claim.sub','f9503333-3333-4333-8333-333333333331',true);
do $$ begin
  assert (select sessions>=1 and total_opens>=2 and active_week>=1 from public.owner_guest_activity()), 'Owner sees guest totals';
end; $$;
rollback;
