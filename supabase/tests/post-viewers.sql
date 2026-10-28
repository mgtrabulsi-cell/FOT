begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('a9703333-3333-4333-8333-333333333331','viewer-owner@example.test','{"display_name":"Owner"}'),
 ('a9703333-3333-4333-8333-333333333332','viewer-admin@example.test','{"display_name":"Viewer Admin"}'),
 ('a9703333-3333-4333-8333-333333333333','viewer-member@example.test','{"display_name":"Viewer Member"}');
insert into public.livewire_roles(user_id,role,display_name) values
 ('a9703333-3333-4333-8333-333333333331','owner','Viewer Owner'),
 ('a9703333-3333-4333-8333-333333333332','admin','Viewer Admin');
-- Use an existing published post without committing any fixture changes.
do $$ begin
  assert exists(select 1 from public.angles where status='published'), 'Published fixture required';
end; $$;
select set_config('test.viewer_post',(select id::text from public.angles where status='published' limit 1),true);
select set_config('test.viewer_livewire',(select id::text from public.livewire_posts limit 1),true);
set local role anon;
select public.record_angle_view(current_setting('test.viewer_post')::uuid);
select public.record_livewire_view(current_setting('test.viewer_livewire')::uuid);
do $$ begin
  begin perform public.admin_post_viewers('angle',current_setting('test.viewer_post')::uuid); raise exception 'Guest read identities';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.post_view_receipts; raise exception 'Guest read receipts';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a9703333-3333-4333-8333-333333333333',true);
select public.record_angle_view(current_setting('test.viewer_post')::uuid);
select public.record_livewire_view(current_setting('test.viewer_livewire')::uuid);
do $$ begin
  begin perform public.admin_post_viewers('angle',current_setting('test.viewer_post')::uuid); raise exception 'Member read identities';
  exception when raise_exception then if sqlerrm <> 'Admin access is required' then raise; end if; end;
end; $$;
select set_config('request.jwt.claim.sub','a9703333-3333-4333-8333-333333333331',true);
select public.record_angle_view(current_setting('test.viewer_post')::uuid);
select public.record_livewire_view(current_setting('test.viewer_livewire')::uuid);
select set_config('request.jwt.claim.sub','a9703333-3333-4333-8333-333333333332',true);
select public.record_angle_view(current_setting('test.viewer_post')::uuid);
select public.record_angle_view(current_setting('test.viewer_post')::uuid);
select public.record_livewire_view(current_setting('test.viewer_livewire')::uuid);
select public.record_livewire_view(current_setting('test.viewer_livewire')::uuid);
select public.record_site_open();
do $$
declare summary jsonb;
begin
  summary:=public.admin_post_viewers('angle',current_setting('test.viewer_post')::uuid);
  assert (summary->>'guest_views')::bigint>=1,'Guests counted';
  assert summary->'viewers' @> '[{"display_name":"Viewer Member","views":1}]'::jsonb,'Member attributed';
  assert not summary->'viewers' @> '[{"display_name":"Owner"}]'::jsonb,'Owner excluded';
  assert not summary->'viewers' @> '[{"display_name":"Viewer Admin"}]'::jsonb,'Admin excluded';
  summary:=public.admin_post_viewers('livewire',current_setting('test.viewer_livewire')::uuid);
  assert (summary->>'guest_views')::bigint>=1,'LIVEWIRE guests counted';
  assert summary->'viewers' @> '[{"display_name":"Viewer Member","views":1}]'::jsonb,'LIVEWIRE member attributed';
  assert not summary->'viewers' @> '[{"display_name":"Owner"}]'::jsonb,'LIVEWIRE owner excluded';
  assert not summary->'viewers' @> '[{"display_name":"Viewer Admin"}]'::jsonb,'LIVEWIRE admin excluded';
end; $$;
reset role;
do $$ begin
  assert not exists(select 1 from public.site_opens where user_id='a9703333-3333-4333-8333-333333333332'),'Admin site opens excluded';
  assert not exists(select 1 from public.post_view_receipts where user_id in (
    'a9703333-3333-4333-8333-333333333331','a9703333-3333-4333-8333-333333333332')),'Staff views create no receipts';
end; $$;
delete from auth.users where id='a9703333-3333-4333-8333-333333333333';
do $$ begin
  assert exists(select 1 from public.post_view_receipts where surface='angle'
    and post_id=current_setting('test.viewer_post')::uuid and user_id is null and not guest),'Deleted viewer anonymized';
end; $$;
rollback;
