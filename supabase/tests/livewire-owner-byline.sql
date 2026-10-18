begin;
insert into auth.users(id) values
('c6541111-1111-4111-8111-111111111111'), ('c6541111-1111-4111-8111-111111111112');
insert into public.livewire_roles(user_id,role,display_name) values
('c6541111-1111-4111-8111-111111111111','owner','Owner test'),
('c6541111-1111-4111-8111-111111111112','admin','Admin test');

set local role authenticated;
select set_config('request.jwt.claim.sub','c6541111-1111-4111-8111-111111111111',true);
select public.save_livewire_post('Owner body',null,null,'Owner test post');
do $$
declare post_id uuid;
begin
  select id into post_id from public.livewire_posts
  where author_id=auth.uid() and title='Owner test post' and author_name='From The Analyst''s Desk';
  assert post_id is not null, 'New owner posts use the desk byline';
  perform public.save_livewire_post('Edited owner body',null,post_id,'Owner test post');
  assert exists(select 1 from public.livewire_posts where id=post_id
    and body='Edited owner body' and author_name='From The Analyst''s Desk'), 'Owner edits retain byline';
end;
$$;
select set_config('request.jwt.claim.sub','c6541111-1111-4111-8111-111111111112',true);
select public.save_livewire_post('Admin body',null,null,'Admin test post');
do $$
begin
  assert exists(select 1 from public.livewire_posts where author_id=auth.uid()
    and title='Admin test post' and author_name='Admin test'), 'Other admins keep their names';
end;
$$;
select set_config('request.jwt.claim.sub','c6541111-1111-4111-8111-111111111111',true);
do $$
declare target uuid;
begin
  select id into target from public.livewire_posts
  where author_id='c6541111-1111-4111-8111-111111111112' and title='Admin test post';
  perform public.save_livewire_post('Owner edited admin body',null,target,'Admin test post');
  assert exists(select 1 from public.livewire_posts where id=target
    and author_name='Admin test' and author_id='c6541111-1111-4111-8111-111111111112'),
    'Owner edits do not reattribute other admins';
end;
$$;
reset role;
select 'LIVEWIRE owner byline and other admin names passed' as result;
rollback;
