begin;
insert into auth.users(id) values ('a8541111-1111-4111-8111-111111111111'), ('a8542222-2222-4222-8222-222222222222');
insert into public.livewire_roles(user_id,role,display_name) values
 ('a8541111-1111-4111-8111-111111111111','admin','Graphic test 1'),
 ('a8542222-2222-4222-8222-222222222222','admin','Graphic test 2');
set local role authenticated;
select set_config('request.jwt.claim.sub','a8541111-1111-4111-8111-111111111111',true);
do $$
declare
  body jsonb;
  saved record;
  changed record;
begin
  select jsonb_build_object('kind','start','position','QB','slots',jsonb_agg(jsonb_build_object(
    'reason','Verified admin opinion',
    'player',jsonb_build_object('id',n::text,'name','Player ' || n,'position','QB','teamId','9','teamAbbr','GB',
      'headshot','https://a.espncdn.com/photo.png','opponent','DET','opponentLogo','https://a.espncdn.com/logo.png','matchup','VS')
  ))) into body from generate_series(1,4) n;
  select * into saved from public.save_fantasy_graphic(null,2200,18,body,0,'draft');
  if saved.revision <> 1 or saved.published_content is not null then raise exception 'Draft lifecycle failed'; end if;
  perform set_config('test.graphic_id', saved.id::text, true);
  perform set_config('request.jwt.claim.sub','a8542222-2222-4222-8222-222222222222',true);
  select * into changed from public.save_fantasy_graphic(saved.id,2200,18,body,1,'publish');
  if changed.revision <> 2 or changed.published_content <> body then raise exception 'Another admin could not publish shared draft'; end if;
  begin
    perform public.save_fantasy_graphic(saved.id,2200,18,body,1,'draft');
    raise exception 'Stale write accepted';
  exception when raise_exception then
    if sqlerrm not like 'Another admin updated%' then raise; end if;
  end;
  body := jsonb_set(body,'{slots,0,reason}','"Private changed reasoning"');
  select * into changed from public.save_fantasy_graphic(saved.id,2200,18,body,2,'draft');
  if changed.published_content->'slots'->0->>'reason' <> 'Verified admin opinion' then raise exception 'Draft changed published artwork'; end if;
  begin
    perform public.save_fantasy_graphic(null,2200,18,jsonb_set(body,'{slots,0,player,headshot}','"https://example.com/bad.png"'),0,'publish');
    raise exception 'Unsafe image accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid player selection' then raise; end if;
  end;
  begin
    perform public.save_fantasy_graphic(null,2200,18,jsonb_set(body,'{slots,0,player}','null'),0,'publish');
    raise exception 'Incomplete publish accepted';
  exception when raise_exception then
    if sqlerrm <> 'Select all four players before publishing' then raise; end if;
  end;
  perform public.save_fantasy_graphic(null,2200,18,body,0,'draft');
end;
$$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare visible record; total integer;
begin
  select count(*) into total from public.list_fantasy_graphics(2200,18);
  if total <> 1 then raise exception 'Public reader can see a draft'; end if;
  select * into visible from public.list_fantasy_graphics(2200,18);
  if visible.content->'slots'->0->>'reason' <> 'Verified admin opinion' then raise exception 'Public reader can see draft changes'; end if;
  begin
    perform * from public.fantasy_graphics;
    raise exception 'Direct table read accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_fantasy_graphic(null,2200,18,'{}',0,'draft');
    raise exception 'Public write accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','a8542222-2222-4222-8222-222222222222',true);
do $$
declare saved record;
begin
  select * into saved from public.list_fantasy_graphics(2200,18) where id = current_setting('test.graphic_id')::uuid;
  perform public.save_fantasy_graphic(saved.id,2200,18,saved.content,saved.revision,'unpublish');
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.save_fantasy_graphic(null,2200,18,saved.content,0,'draft');
    raise exception 'Non-admin write accepted';
  exception when raise_exception then
    if sqlerrm <> 'Admin access is required' then raise; end if;
  end;
  if exists(select 1 from public.list_fantasy_graphics(2200,18)) then raise exception 'Unpublished graphic remains public'; end if;
end;
$$;
reset role;
select 'Fantasy graphics: shared admins, version conflicts, draft isolation, validation, public reads, and unpublishing passed' as result;
rollback;
