begin;
insert into auth.users(id, email) values
 ('d6802222-2222-4222-8222-222222222221', 'livewire-owner@example.invalid'),
 ('d6802222-2222-4222-8222-222222222222', 'livewire-admin@example.invalid'),
 ('d6802222-2222-4222-8222-222222222223', 'livewire-reader@example.invalid');
insert into public.livewire_roles values
 ('d6802222-2222-4222-8222-222222222221', 'owner', 'Test owner'),
 ('d6802222-2222-4222-8222-222222222222', 'admin', 'Test admin');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd6802222-2222-4222-8222-222222222222', true);
select public.save_livewire_post('LIVEWIRE permission test', 'https://example.invalid/news');
do $$
declare target uuid;
begin
  target := public.save_livewire_post('Own draft');
  perform public.save_livewire_post('Own revised post', null, target);
  assert (select body from public.livewire_posts where id = target) = 'Own revised post', 'Admin can edit own posts';
  perform public.delete_livewire_post(target);
  assert not exists(select 1 from public.livewire_posts where id = target), 'Admin can delete own posts';
end;
$$;
do $$
begin
  assert (select count(*) from public.livewire_roles) = 1, 'Admin must only see their own role';
  begin
    perform public.manage_livewire_admin('livewire-reader@example.invalid');
    raise exception 'Admin granted a role';
  exception when raise_exception then
    if sqlerrm <> 'Only the owner can manage admins' then raise; end if;
  end;
  begin
    perform public.save_livewire_post('test', 'javascript:alert(1)');
    raise exception 'Unsafe link accepted';
  exception when raise_exception then
    if sqlerrm <> 'Use a valid http or https news link' then raise; end if;
  end;
  begin
    perform public.save_livewire_post(repeat('x', 501));
    raise exception 'Oversized post accepted';
  exception when raise_exception then
    if sqlerrm <> 'Posts must contain 1 to 500 characters' then raise; end if;
  end;
  begin
    insert into public.livewire_roles values(auth.uid(), 'owner', 'Forged owner');
    raise exception 'Direct role writes allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd6802222-2222-4222-8222-222222222223', true);
do $$
begin
  assert (select count(*) from public.livewire_roles) = 0, 'Reader must not see roles';
  assert exists(select 1 from public.livewire_posts where body = 'LIVEWIRE permission test'), 'Reader can read feed';
  begin
    perform public.save_livewire_post('Unauthorized');
    raise exception 'Reader published';
  exception when raise_exception then
    if sqlerrm <> 'Admin access is required to publish' then raise; end if;
  end;
  begin
    insert into public.livewire_posts(body, author_name) values('Spoofed', 'Owner');
    raise exception 'Direct post writes allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.delete_livewire_post((select id from public.livewire_posts where body = 'LIVEWIRE permission test'));
    raise exception 'Reader deleted a post';
  exception when raise_exception then
    if sqlerrm <> 'Admin access is required' then raise; end if;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd6802222-2222-4222-8222-222222222221', true);
select public.manage_livewire_admin('livewire-reader@example.invalid');
select public.save_livewire_post('Owner post');
select set_config('request.jwt.claim.sub', 'd6802222-2222-4222-8222-222222222223', true);
do $$
declare target uuid;
begin
  select id into target from public.livewire_posts where body = 'Owner post';
  begin
    perform public.save_livewire_post('Changed', null, target);
    raise exception 'Admin edited another author';
  exception when raise_exception then
    if sqlerrm <> 'Post not found or editing is not permitted' then raise; end if;
  end;
  begin
    perform public.delete_livewire_post(target);
    raise exception 'Admin deleted another author';
  exception when raise_exception then
    if sqlerrm <> 'Post not found or deletion is not permitted' then raise; end if;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd6802222-2222-4222-8222-222222222221', true);
do $$
declare target uuid;
begin
  select id into target from public.livewire_posts where body = 'LIVEWIRE permission test';
  perform public.save_livewire_post('Owner moderated', null, target);
  perform public.delete_livewire_post(target);
  perform public.manage_livewire_admin(null, 'd6802222-2222-4222-8222-222222222222');
  begin
    perform public.manage_livewire_admin(null, auth.uid());
    raise exception 'Owner removed';
  exception when raise_exception then
    if sqlerrm <> 'Admin not found; owner access cannot be removed here' then raise; end if;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd6802222-2222-4222-8222-222222222222', true);
do $$
begin
  begin
    perform public.save_livewire_post('Revoked admin');
    raise exception 'Revoked admin published';
  exception when raise_exception then
    if sqlerrm <> 'Admin access is required to publish' then raise; end if;
  end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  assert exists(select 1 from public.livewire_posts where body = 'Owner post'), 'Guests can read feed';
  begin
    perform public.save_livewire_post('Guest post');
    raise exception 'Guest published';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
