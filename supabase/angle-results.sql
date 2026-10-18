begin;
alter table public.angles add column if not exists picks jsonb not null default '[]';
alter table public.angles add column if not exists published_at timestamptz;
alter table public.livewire_posts add column if not exists admin_picks jsonb not null default '[]';
grant update(picks) on public.angles to authenticated;
create index if not exists angles_results_idx on public.angles(published_at desc,id desc) where status='published';

create or replace function public.validate_angle_picks() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare item jsonb; previous jsonb; normalized jsonb := '[]';
begin
  if jsonb_typeof(new.picks) is distinct from 'array' then raise exception 'Admin picks must be a list'; end if;
  -- Keep older clients' single-pick edits compatible without dropping additional picks.
  if (tg_op='INSERT' and new.picks='[]' and btrim(new.pick)<>'')
    or (tg_op='UPDATE' and new.picks=old.picks and new.pick<>old.pick) then
    if btrim(new.pick)='' then
      new.picks := new.picks - 0;
    elsif jsonb_array_length(new.picks)=0 then
      new.picks := jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'text',new.pick,'result','pending'));
    else
      new.picks := jsonb_set(new.picks,'{0,text}',to_jsonb(new.pick));
    end if;
  end if;
  for item in select value from jsonb_array_elements(new.picks) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'id') is distinct from 'string'
      or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'text') is distinct from 'string'
      or char_length(btrim(item->>'text')) not between 1 and 500
      or jsonb_typeof(item->'result') is distinct from 'string'
      or (item->>'result') not in ('pending','hit','miss') then
      raise exception 'Each admin pick needs a unique ID, 1-500 characters, and a valid result';
    end if;
    previous := null;
    if tg_op='UPDATE' then
      select value into previous from jsonb_array_elements(old.picks) where value->>'id'=item->>'id';
    end if;
    if previous is null or btrim(previous->>'text')<>btrim(item->>'text') then
      item := jsonb_set(item,'{result}','"pending"');
    end if;
    normalized := normalized || jsonb_build_array(jsonb_build_object('id',lower(item->>'id'),'text',btrim(item->>'text'),'result',item->>'result'));
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(normalized)) <> jsonb_array_length(normalized) then
    raise exception 'Each admin pick needs a unique ID';
  end if;
  new.picks := normalized;
  new.pick := coalesce(normalized->0->>'text','');
  if tg_op='UPDATE' then new.published_at := old.published_at; else new.published_at := null; end if;
  if new.published_at is null and new.status='published' then
    select first_published_at into new.published_at from public.angle_push_publications where angle_id=new.id;
    new.published_at := coalesce(new.published_at,clock_timestamp());
  end if;
  return new;
end;
$$;
revoke all on function public.validate_angle_picks() from public,anon,authenticated;

-- Backfill as one pick: free-form legacy text cannot safely be split into separate bets.
update public.angles set picks=case when btrim(pick)='' then '[]'::jsonb else
  jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'text',pick,'result','pending')) end,
  published_at=(select first_published_at from public.angle_push_publications where angle_id=angles.id),
  revision=revision+1
where picks='[]' and (btrim(pick)<>'' or published_at is null);
drop trigger if exists angle_picks_validation on public.angles;
create trigger angle_picks_validation before insert or update on public.angles
for each row execute function public.validate_angle_picks();

create or replace function public.sync_angle_livewire() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' then
    delete from public.livewire_posts where angle_id=new.id;
    return new;
  end if;
  insert into public.livewire_posts(angle_id,author_id,author_name,title,body,source_url,themes,created_at,updated_at,image_paths,admin_pick,admin_picks)
  values(new.id,new.created_by,'From The Analyst''s Desk',new.title,
    concat_ws(E'\n\n',new.narrative,
      case when btrim(new.evidence)<>'' then 'The supporting context'||E'\n'||new.evidence end,
      case when btrim(new.counterpoint)<>'' then 'The other side'||E'\n'||new.counterpoint end),
    nullif(new.source_url,''),array['news'],coalesce(new.published_at,new.updated_at),
    new.updated_at,new.image_paths,new.pick,new.picks)
  on conflict(angle_id) do update set
    author_id=excluded.author_id,author_name=excluded.author_name,title=excluded.title,body=excluded.body,
    source_url=excluded.source_url,updated_at=excluded.updated_at,image_paths=excluded.image_paths,
    admin_pick=excluded.admin_pick,admin_picks=excluded.admin_picks;
  return new;
end;
$$;
update public.livewire_posts post set admin_picks=story.picks
from public.angles story where post.angle_id=story.id;
notify pgrst,'reload schema';
commit;
