begin;

alter table public.angles add column if not exists post_to_x boolean not null default false;
alter table public.angles alter column post_to_x set default false;

create table if not exists public.x_publishing_settings (
  id boolean primary key default true check(id),
  enabled boolean not null default false
);
insert into public.x_publishing_settings(id) values(true) on conflict do nothing;
alter table public.x_publishing_settings enable row level security;
revoke all on public.x_publishing_settings from public,anon,authenticated;
grant all on public.x_publishing_settings to service_role;
grant select on public.x_publishing_settings to authenticated;
drop policy if exists "Admins see X connection status" on public.x_publishing_settings;
create policy "Admins see X connection status" on public.x_publishing_settings for select to authenticated
  using(public.livewire_role() is not null and not public.account_deletion_in_progress());

create table if not exists public.x_publications (
  id bigint generated always as identity primary key,
  source_type text not null check(source_type in ('angle','livewire')),
  source_id uuid not null,
  status text not null check(status in ('pending','skipped','sending','sent','failed','unknown','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tweet_id text,
  last_error text,
  unique(source_type,source_id)
);
alter table public.x_publications enable row level security;
revoke all on public.x_publications from public,anon,authenticated;
grant select on public.x_publications to authenticated;
grant all on public.x_publications to service_role;
grant usage,select on sequence public.x_publications_id_seq to service_role;
drop policy if exists "Admins see X delivery status" on public.x_publications;
create policy "Admins see X delivery status" on public.x_publications for select to authenticated
  using(public.livewire_role() is not null and not public.account_deletion_in_progress());
create index if not exists x_publications_pending_idx on public.x_publications(id) where status='pending';

-- Installation never broadcasts historic content, even after it is edited or republished.
insert into public.x_publications(source_type,source_id,status,last_error)
select 'angle',id,'skipped','Published before X integration' from public.angles where published_at is not null
on conflict do nothing;
insert into public.x_publications(source_type,source_id,status,last_error)
select 'livewire',id,'skipped','Published before X integration' from public.livewire_posts where angle_id is null
on conflict do nothing;

create or replace function public.queue_x_publication() returns trigger
language plpgsql security definer set search_path=''
as $$
declare kind text; selected boolean; connected boolean;
begin
  if tg_table_name='angles' then
    kind := 'angle';
    if new.status <> 'published' then
      update public.x_publications set status='cancelled',updated_at=now(),last_error='Story is no longer published'
        where source_type=kind and source_id=new.id and status='pending';
      return new;
    end if;
    selected := new.post_to_x;
  else
    if new.angle_id is not null then return new; end if;
    kind := 'livewire';
    selected := coalesce(nullif(current_setting('gamewire.post_to_x',true),''),'false')::boolean;
  end if;
  select enabled into connected from public.x_publishing_settings where id;
  insert into public.x_publications(source_type,source_id,status,last_error)
  values(kind,new.id,case when selected and connected then 'pending' else 'skipped' end,
    case when not selected then 'Post to X was unchecked' when not connected then 'X connection is not enabled; not queued' end)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.queue_x_publication() from public,anon,authenticated;
drop trigger if exists angle_x_publication on public.angles;
create trigger angle_x_publication after insert or update on public.angles
for each row execute function public.queue_x_publication();
drop trigger if exists livewire_x_publication on public.livewire_posts;
create trigger livewire_x_publication after insert on public.livewire_posts
for each row execute function public.queue_x_publication();

create or replace function public.save_livewire_post_to_x(
  post_body text, post_source text, post_id uuid, post_title text, post_images text[], post_themes text[], post_to_x boolean)
returns uuid language plpgsql security invoker set search_path=''
as $$
declare result uuid;
begin
  if post_to_x is null then raise exception 'Choose whether to post to X'; end if;
  perform set_config('gamewire.post_to_x',post_to_x::text,true);
  result := public.save_livewire_post(post_body,post_source,post_id,post_title,post_images,post_themes);
  perform set_config('gamewire.post_to_x','',true);
  return result;
end;
$$;
revoke all on function public.save_livewire_post_to_x(text,text,uuid,text,text[],text[],boolean) from public,anon;
grant execute on function public.save_livewire_post_to_x(text,text,uuid,text,text[],text[],boolean) to authenticated;

create or replace function public.claim_x_publications()
returns setof public.x_publications language plpgsql security definer set search_path=''
as $$
begin
  if not exists(select 1 from public.x_publishing_settings where id and enabled) then return; end if;
  -- A lost response can mean X accepted the tweet. Never retry an ambiguous send automatically.
  update public.x_publications set status='unknown',updated_at=now(),
    last_error='Dispatch interrupted. Check the X account before attempting to repost.'
    where status='sending' and updated_at < now()-interval '5 minutes';
  return query update public.x_publications p set status='sending',updated_at=now()
    where p.id in (select id from public.x_publications where status='pending'
      order by id for update skip locked limit 1)
    returning p.*;
end;
$$;
revoke all on function public.claim_x_publications() from public,anon,authenticated;
grant execute on function public.claim_x_publications() to service_role;

select cron.unschedule(jobid) from cron.job where jobname='gamewire-x-publishing';
select cron.schedule('gamewire-x-publishing','* * * * *',$job$
  select net.http_post(
    url:=replace((select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-url'),
      '/poll-live-games','/send-x-posts'),
    headers:=jsonb_build_object('Content-Type','application/json','x-gamewire-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-secret')),
    body:='{}'::jsonb);
$job$);
notify pgrst,'reload schema';
commit;
