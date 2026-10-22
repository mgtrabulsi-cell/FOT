begin;
insert into auth.users(id) values
 ('c9581111-1111-4111-8111-111111111111'),('c9581111-1111-4111-8111-111111111112');
insert into public.livewire_roles(user_id,role,display_name)
values('c9581111-1111-4111-8111-111111111111','admin','X test');
update public.x_publishing_settings set enabled=false where id;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9581111-1111-4111-8111-111111111111',true);
do $$
declare post uuid;
begin
  post := public.save_livewire_post_to_x('Body',null,null,'Disconnected','{}','{news}',true);
  assert exists(select 1 from public.x_publications where source_type='livewire' and source_id=post and status='skipped'),'Disconnected never accumulates backlog';
  insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,post_to_x)
    values('c9581111-1111-4111-8111-111111111121',2196,6,'NFL:123','Test','team','Test','Other','Draft','Original text',true,true);
  assert not exists(select 1 from public.x_publications where source_id='c9581111-1111-4111-8111-111111111121'),'Private draft not queued';
end;
$$;
reset role;
update public.x_publishing_settings set enabled=true where id;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9581111-1111-4111-8111-111111111111',true);
do $$
declare post uuid; skipped uuid; mirror uuid;
begin
  update public.angles set status='published',revision=revision+1 where id='c9581111-1111-4111-8111-111111111121';
  assert exists(select 1 from public.x_publications where source_type='angle' and source_id='c9581111-1111-4111-8111-111111111121' and status='pending'),'First Angle publication queued';
  select id into mirror from public.livewire_posts where angle_id='c9581111-1111-4111-8111-111111111121';
  assert mirror is not null,'Angle mirrors to LIVEWIRE';
  assert not exists(select 1 from public.x_publications where source_type='livewire' and source_id=mirror),'Mirror never duplicates tweet';
  update public.angles set title='Edited',revision=revision+1 where id='c9581111-1111-4111-8111-111111111121';
  assert (select count(*) from public.x_publications where source_id='c9581111-1111-4111-8111-111111111121')=1,'Edits do not queue again';
  update public.angles set status='draft',revision=revision+1 where id='c9581111-1111-4111-8111-111111111121';
  assert exists(select 1 from public.x_publications where source_id='c9581111-1111-4111-8111-111111111121' and status='cancelled'),'Unpublish cancels unsent tweet';
  update public.angles set status='published',revision=revision+1 where id='c9581111-1111-4111-8111-111111111121';
  assert exists(select 1 from public.x_publications where source_id='c9581111-1111-4111-8111-111111111121' and status='cancelled'),'Republish does not send again';
  insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,status,section,news_types,themes,post_to_x)
    values('c9581111-1111-4111-8111-111111111122',2196,6,'NFL:123','Test','team','Test','Other','News','Original text',true,'published','news','{news}','{fantasy}',true);
  assert exists(select 1 from public.x_publications where source_id='c9581111-1111-4111-8111-111111111122' and status='pending'),'Fantasy News queues';
  insert into public.angles(id,season,week,game_id,matchup,kind,subject,category,title,narrative,reviewed,status,post_to_x)
    values('c9581111-1111-4111-8111-111111111123',2196,6,'NFL:123','Test','team','Test','Other','Skipped','Original text',true,'published',false);
  assert exists(select 1 from public.x_publications where source_id='c9581111-1111-4111-8111-111111111123' and status='skipped'),'Unchecked story skips';
  post := public.save_livewire_post_to_x('Body',null,null,'Queued','{}','{news}',true);
  assert exists(select 1 from public.x_publications where source_id=post and status='pending'),'Standalone LIVEWIRE queues';
  perform public.save_livewire_post_to_x('Edited',null,post,'Edited','{}','{news}',true);
  assert (select count(*) from public.x_publications where source_id=post)=1,'LIVEWIRE edit never duplicates';
  skipped := public.save_livewire_post_to_x('Body',null,null,'Skipped','{}','{news}',false);
  assert exists(select 1 from public.x_publications where source_id=skipped and status='skipped'),'Unchecked LIVEWIRE skips';
  begin
    update public.x_publishing_settings set enabled=false where id;
    raise exception 'Admin changed system connection setting';
  exception when insufficient_privilege then null; end;
  begin
    update public.x_publications set status='sent' where source_id=post;
    raise exception 'Admin forged sent status';
  exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub','c9581111-1111-4111-8111-111111111112',true);
do $$
begin
  assert not exists(select 1 from public.x_publications),'Members cannot read publishing internals';
  assert not exists(select 1 from public.x_publishing_settings),'Members cannot read connection controls';
  begin
    perform public.claim_x_publications();
    raise exception 'Member claimed publication queue';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_livewire_post_to_x('Body',null,null,'Denied','{}','{}',true);
    raise exception 'Member published LIVEWIRE';
  exception when raise_exception then
    if sqlerrm <> 'Admin access is required to publish' then raise; end if;
  end;
end;
$$;
reset role;
-- Restrict claims to these transaction fixtures, never touch real queued posts.
update public.x_publications set status='skipped' where source_id not in
  (select id from public.livewire_posts where author_id='c9581111-1111-4111-8111-111111111111')
  and source_id not in ('c9581111-1111-4111-8111-111111111121','c9581111-1111-4111-8111-111111111122','c9581111-1111-4111-8111-111111111123');
set local role service_role;
do $$
declare first_count integer; second_count integer;
begin
  select count(*) into first_count from public.claim_x_publications();
  assert first_count=2,'Claims exactly two eligible fixture publications';
  select count(*) into second_count from public.claim_x_publications();
  assert second_count=0,'Already claimed posts never resend';
  update public.x_publications set updated_at=now()-interval '6 minutes' where status='sending';
  perform public.claim_x_publications();
  assert (select count(*) from public.x_publications where status='unknown')>=2,'Expired claims become uncertain, never pending again';
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.x_publications;
    raise exception 'Guest read private delivery history';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'X publishing: first publication, checkboxes, mirrors, no backlog, cancellation, claims and permissions passed' as result;
rollback;
