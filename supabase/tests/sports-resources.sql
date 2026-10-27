begin;
insert into public.sports_resources(resource_key,payload) values ('test-resource','{"events":[]}') on conflict(resource_key) do nothing;
set local role anon;
select resource_key from public.sports_resources where resource_key='test-resource';
do $$
begin
  begin
    insert into public.sports_resources(resource_key,payload) values ('forbidden','{}');
    raise exception 'Anonymous sports writes must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
do $$
begin
  begin
    delete from public.sports_resources where resource_key='test-resource';
    raise exception 'Authenticated sports writes must be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
