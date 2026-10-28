begin;
insert into auth.users(id) values
 ('a9704444-4444-4444-8444-444444444441'),
 ('a9704444-4444-4444-8444-444444444442'),
 ('a9704444-4444-4444-8444-444444444443');
insert into public.livewire_roles(user_id,role,display_name) values
 ('a9704444-4444-4444-8444-444444444441','owner','View exclusion test owner'),
 ('a9704444-4444-4444-8444-444444444442','admin','View exclusion test admin');
select set_config('test.exclusion_post',(select id::text from public.angles where status='published' limit 1),true);
do $$ begin
  assert current_setting('test.exclusion_post') <> '', 'Published fixture required';
end $$;
select set_config('test.before_count',coalesce((select view_count::text from public.angle_view_counts
  where angle_id=current_setting('test.exclusion_post')::uuid),'0'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','a9704444-4444-4444-8444-444444444442',true);
do $$ begin
  assert public.record_angle_view(current_setting('test.exclusion_post')::uuid)=current_setting('test.before_count')::bigint,'Admin view excluded';
  assert public.record_angle_view(current_setting('test.exclusion_post')::uuid)=current_setting('test.before_count')::bigint,'Admin repeat excluded';
  assert public.record_site_open() is null,'Admin site opens excluded';
  perform public.admin_post_viewers('angle',current_setting('test.exclusion_post')::uuid);
end $$;
select set_config('request.jwt.claim.sub','a9704444-4444-4444-8444-444444444441',true);
do $$ begin
  assert public.record_angle_view(current_setting('test.exclusion_post')::uuid)=current_setting('test.before_count')::bigint,'Owner excluded';
  assert public.record_site_open() is null,'Owner opens excluded';
end $$;
select set_config('request.jwt.claim.sub','a9704444-4444-4444-8444-444444444443',true);
do $$ begin
  assert public.record_angle_view(current_setting('test.exclusion_post')::uuid) is null,'Member receives no count';
  assert public.record_site_open()=1,'Member site open counted';
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  assert public.record_angle_view(current_setting('test.exclusion_post')::uuid) is null,'Guest receives no count';
end $$;
reset role;
do $$ begin
  assert (select view_count from public.angle_view_counts where angle_id=current_setting('test.exclusion_post')::uuid)
    =current_setting('test.before_count')::bigint+2,'Only member and guest incremented';
  assert not exists(select 1 from public.post_view_receipts where user_id in (
    'a9704444-4444-4444-8444-444444444441','a9704444-4444-4444-8444-444444444442')),'Staff created no receipts';
  assert not exists(select 1 from public.site_opens where user_id in (
    'a9704444-4444-4444-8444-444444444441','a9704444-4444-4444-8444-444444444442')),'Staff created no site-open rows';
  assert exists(select 1 from pg_trigger where tgname='livewire_retired_read_only' and tgenabled='O'),'Retired archive remains protected';
end $$;
rollback;
