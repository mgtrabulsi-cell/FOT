begin;
insert into auth.users(id) values ('a9561111-1111-4111-8111-111111111111');
insert into public.livewire_roles(user_id,role,display_name)
values ('a9561111-1111-4111-8111-111111111111','admin','Theme test');
insert into public.user_push_subscriptions(user_id,endpoint,subscription,notify_scores)
values ('a9561111-1111-4111-8111-111111111111','https://example.invalid/angle-theme-test','{}',false);
set local role authenticated;
select set_config('request.jwt.claim.sub','a9561111-1111-4111-8111-111111111111',true);
insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,status,themes)
values ('a9561111-1111-4111-8111-111111111121',2200,18,'NFL:123','Test','team','','Other','Betting first','Story',true,'published',array['betting','fantasy','news']);
do $$
begin
  assert (select themes = array['betting','fantasy','news'] from public.livewire_posts where angle_id='a9561111-1111-4111-8111-111111111121'), 'Mirror retains exact ordered themes';
  begin
    update public.angles set themes=array['news','news'],revision=revision+1 where id='a9561111-1111-4111-8111-111111111121';
    raise exception 'Duplicate themes accepted';
  exception when check_violation then null; end;
  begin
    update public.angles set themes='{}',revision=revision+1 where id='a9561111-1111-4111-8111-111111111121';
    raise exception 'Empty themes accepted';
  exception when check_violation then null; end;
  begin
    update public.angles set themes=array['other'],revision=revision+1 where id='a9561111-1111-4111-8111-111111111121';
    raise exception 'Invalid themes accepted';
  exception when check_violation then null; end;
  begin
    update public.angles set themes='[0:1]={betting,news}'::text[],revision=revision+1 where id='a9561111-1111-4111-8111-111111111121';
    raise exception 'Nonstandard theme positions accepted';
  exception when check_violation then null; end;
end;
$$;
reset role;
do $$
begin
  assert (select primary_theme='betting' from public.livewire_push_deliveries where angle_id='a9561111-1111-4111-8111-111111111121' and endpoint='https://example.invalid/angle-theme-test'), 'First selected theme queues, regardless of display order';
end;
$$;
set local role authenticated;
update public.angles set themes=array['fantasy','news'],revision=revision+1 where id='a9561111-1111-4111-8111-111111111121';
do $$
begin
  assert (select themes=array['fantasy','news'] from public.livewire_posts where angle_id='a9561111-1111-4111-8111-111111111121'), 'Retagged mirror updates';
end;
$$;
reset role;
do $$
begin
  assert (select primary_theme='betting' from public.livewire_push_deliveries where angle_id='a9561111-1111-4111-8111-111111111121' and endpoint='https://example.invalid/angle-theme-test'), 'Editing does not rewrite first publication snapshot';
  assert (select count(*) from public.livewire_push_deliveries where angle_id='a9561111-1111-4111-8111-111111111121' and endpoint='https://example.invalid/angle-theme-test')=1, 'No duplicate notifications';
end;
$$;
select 'Angle ordered themes, mirrored filters, validation, first-publication snapshots and no duplicate alerts passed' as result;
rollback;
