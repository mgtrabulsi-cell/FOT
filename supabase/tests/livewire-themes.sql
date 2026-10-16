begin;
insert into auth.users(id) values
 ('d9102222-2222-4222-8222-222222222221'),
 ('d9102222-2222-4222-8222-222222222222');
insert into public.livewire_roles values
 ('d9102222-2222-4222-8222-222222222221', 'admin', 'Theme admin');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9102222-2222-4222-8222-222222222221', true);
do $$
declare target uuid; invalid text[];
begin
  target := public.save_livewire_post('Theme test', null, null, 'Theme headline', '{}', array['news','fantasy','betting']);
  assert (select themes from public.livewire_posts where id = target) = array['news','fantasy','betting'];
  perform public.save_livewire_post('Legacy edit', null, target, 'Theme headline', '{}');
  assert (select cardinality(themes) from public.livewire_posts where id = target) = 3, 'Legacy edits preserve themes';
  perform public.save_livewire_post('Edited themes', null, target, 'Theme headline', '{}', array['fantasy']);
  assert (select themes from public.livewire_posts where id = target) = array['fantasy'];
  perform public.save_livewire_post('Cleared themes', null, target, 'Theme headline', '{}', '{}');
  assert (select cardinality(themes) from public.livewire_posts where id = target) = 0;
  foreach invalid slice 1 in array array[['news','news'],['unknown','news'],['news',null]] loop
    begin
      perform public.save_livewire_post('Invalid', null, target, 'Theme headline', '{}', invalid);
      raise exception 'Invalid themes accepted';
    exception when raise_exception then
      if sqlerrm <> 'Choose News, Fantasy, and Betting at most once each' then raise; end if;
    end;
  end loop;
  target := public.save_livewire_post('Legacy post');
  assert (select cardinality(themes) from public.livewire_posts where id = target) = 0, 'Legacy posts remain untagged';
end;
$$;
select set_config('request.jwt.claim.sub', 'd9102222-2222-4222-8222-222222222222', true);
do $$
begin
  begin
    perform public.save_livewire_post('Forbidden', null, null, 'Forbidden', '{}', array['news']);
    raise exception 'Reader published themes';
  exception when raise_exception then
    if sqlerrm <> 'Admin access is required to publish' then raise; end if;
  end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  assert exists(select 1 from public.livewire_posts where author_name = 'Theme admin'), 'Guests can read tagged posts';
end;
$$;
reset role;
rollback;
