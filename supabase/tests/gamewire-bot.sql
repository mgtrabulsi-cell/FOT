begin;
do $$
declare owner_id uuid; member_id uuid; next_request boolean;
begin
  assert not has_table_privilege('anon','public.gamewire_bot_cache','select');
  assert not has_table_privilege('authenticated','public.gamewire_bot_cache','select');
  assert not has_table_privilege('authenticated','public.gamewire_bot_usage','insert');
  assert not has_table_privilege('authenticated','public.gamewire_fantasy_rankings','select');
  assert not has_table_privilege('anon','public.gamewire_fantasy_rankings','insert');
  assert has_table_privilege('service_role','public.gamewire_fantasy_rankings','select');
  assert not has_function_privilege('anon','public.gamewire_bot_claim(uuid)','execute');
  assert not has_function_privilege('authenticated','public.gamewire_bot_claim(uuid)','execute');
  assert has_function_privilege('service_role','public.gamewire_bot_claim(uuid)','execute');
  assert not has_function_privilege('anon','public.gamewire_bot_save_rankings(integer,integer,text,text,jsonb)','execute');
  assert not has_function_privilege('authenticated','public.gamewire_bot_save_rankings(integer,integer,text,text,jsonb)','execute');
  assert has_function_privilege('service_role','public.gamewire_bot_save_rankings(integer,integer,text,text,jsonb)','execute');
  perform public.gamewire_bot_save_rankings(2200,18,'ppr','RB',
    '[{"id":"123","teamId":"23","name":"First Player"},{"id":"456","teamId":"5","name":"Second Player"}]'::jsonb);
  assert (select count(*)=2 from public.gamewire_fantasy_rankings where season=2200 and week=18 and scoring_format='ppr' and position='RB');
  assert (select rank=1 from public.gamewire_fantasy_rankings where season=2200 and week=18 and scoring_format='ppr' and position='RB' and player_id='123');
  perform public.gamewire_bot_save_rankings(2200,18,'ppr','RB','[{"id":"456","teamId":"5","name":"Second Player"}]'::jsonb);
  assert (select count(*)=1 from public.gamewire_fantasy_rankings where season=2200 and week=18 and scoring_format='ppr' and position='RB');
  begin
    perform public.gamewire_bot_save_rankings(2200,18,'ppr','RB',
      '[{"id":"456","teamId":"5","name":"Duplicate"},{"id":"456","teamId":"5","name":"Duplicate"}]'::jsonb);
    raise exception 'Duplicate rankings must not publish';
  exception when raise_exception then
    if sqlerrm='Duplicate rankings must not publish' then raise; end if;
  end;
  assert (select count(*)=1 from public.gamewire_fantasy_rankings where season=2200 and week=18 and scoring_format='ppr' and position='RB'), 'Invalid publication preserves the prior list';
  assert (select relrowsecurity from pg_class where oid='public.gamewire_bot_cache'::regclass);
  assert (select relrowsecurity from pg_class where oid='public.gamewire_bot_usage'::regclass);
  select user_id into owner_id from public.gamewaire_admin_account;
  assert owner_id is not null;
  assert not public.gamewire_bot_claim('00000000-0000-0000-0000-000000000000');
  delete from public.gamewire_bot_usage where user_id=owner_id;
  for i in 1..60 loop
    next_request := public.gamewire_bot_claim(owner_id);
    assert next_request, 'First sixty cache-miss refresh claims must succeed';
  end loop;
  assert not public.gamewire_bot_claim(owner_id), 'The sixty-first refresh must be rejected atomically';
  assert (select requests=60 from public.gamewire_bot_usage where user_id=owner_id and hour=date_trunc('hour',now()));
  select id into member_id from auth.users
    where id<>owner_id and not coalesce(is_anonymous,false) and deleted_at is null
      and (banned_until is null or banned_until<=now()) limit 1;
  assert member_id is not null, 'A real member account must exist for rollout validation';
  delete from public.gamewire_bot_usage where user_id=member_id;
  for i in 1..60 loop
    assert public.gamewire_bot_claim(member_id), 'Members receive the same independent refresh allowance';
  end loop;
  assert not public.gamewire_bot_claim(member_id), 'Member refresh limits are enforced atomically';
  delete from public.gamewire_bot_usage where user_id=member_id;
  update auth.users set banned_until=now()+interval '1 hour' where id=member_id;
  assert not public.gamewire_bot_claim(member_id), 'Banned accounts cannot claim refreshes';
  update auth.users set banned_until=null, deleted_at=now() where id=member_id;
  assert not public.gamewire_bot_claim(member_id), 'Deleted accounts cannot claim refreshes';
  update auth.users set deleted_at=null, is_anonymous=true where id=member_id;
  assert not public.gamewire_bot_claim(member_id), 'Anonymous accounts cannot claim refreshes';
end;
$$;
rollback;
