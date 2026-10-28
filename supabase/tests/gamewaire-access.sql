begin;
insert into auth.users(id) values ('b9706666-6666-4666-8666-666666666661');
insert into public.livewire_roles(user_id,role,display_name)
values ('b9706666-6666-4666-8666-666666666661','admin','GamewAIre access test');
insert into public.gamewaire_runs(id,sport,event_id,event_start,matchup,settings,status)
values ('b9706666-6666-4666-8666-666666666662','NBA','access-test',now()+interval '1 day','Access test','{}','no_qualifying');
insert into public.gamewaire_schedule_batches(id,sport,game_date,status,note)
values ('b9706666-6666-4666-8666-666666666663','NBA','2200-01-01','ready','Access test');
insert into public.gamewaire_schedule_jobs(batch_id,sport,event_id,event_start,matchup,selection_note)
values ('b9706666-6666-4666-8666-666666666663','NBA','access-test',now()+interval '1 day','Access test','Access test');
select set_config('test.gamewaire_account',(select user_id::text from public.gamewaire_admin_account),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','b9706666-6666-4666-8666-666666666661',true);
do $$ begin
  assert not public.gamewaire_can_admin(),'Other admin cannot manage GamewAIre';
  assert public.livewire_role()='admin','Other admin privileges retained';
  assert not exists(select 1 from public.gamewaire_runs),'Other admin cannot read candidate reports';
  assert not exists(select 1 from public.gamewaire_schedule_batches),'Other admin cannot read schedule batches';
  assert not exists(select 1 from public.gamewaire_schedule_jobs),'Other admin cannot read schedule jobs';
  perform 1 from public.gamewaire_publications;
  perform 1 from public.gamewaire_picks;
  perform 1 from public.gamewaire_team_leans;
  begin
    update public.gamewaire_admin_account set user_id=auth.uid();
    raise exception 'Admin changed GamewAIre account';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Becoming an owner must not grant access to the pinned account.
reset role;
update public.livewire_roles set role='owner' where user_id='b9706666-6666-4666-8666-666666666661';
set local role authenticated;
do $$ begin
  assert not public.gamewaire_can_admin(),'Another owner still cannot manage GamewAIre';
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.gamewaire_account'),true);
do $$ begin
  assert public.gamewaire_can_admin(),'Designated account retains access';
  assert exists(select 1 from public.gamewaire_runs where event_id='access-test'),'Designated account sees reports';
  assert exists(select 1 from public.gamewaire_schedule_batches where id='b9706666-6666-4666-8666-666666666663'),'Designated account sees batches';
  assert exists(select 1 from public.gamewaire_schedule_jobs where event_id='access-test'),'Designated account sees jobs';
end $$;
rollback;
