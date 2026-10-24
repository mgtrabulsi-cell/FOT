begin;
alter table public.angles add column if not exists review_picks jsonb not null default '[]'::jsonb;
grant update (review_picks) on public.angles to authenticated;
alter table public.livewire_posts add column if not exists review_picks jsonb not null default '[]'::jsonb;

create or replace function public.validate_angle_review_picks() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare item jsonb; original public.angles; pick jsonb; normalized jsonb := '[]'; previous jsonb;
begin
  if tg_op = 'UPDATE' and new.review_picks = old.review_picks then return new; end if;
  if jsonb_typeof(new.review_picks) is distinct from 'array' or jsonb_array_length(new.review_picks) > 20 then
    raise exception 'Attach at most 20 settled picks for review';
  end if;
  for item in select value from jsonb_array_elements(new.review_picks) loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(item->>'story_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(item->>'pick_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (item->>'story_id')::uuid = new.id then raise exception 'Choose a settled pick from another published story'; end if;
    previous := null;
    if tg_op = 'UPDATE' then
      select value into previous from jsonb_array_elements(old.review_picks)
      where value->>'story_id' = lower(item->>'story_id') and value->>'pick_id' = lower(item->>'pick_id');
    end if;
    -- Keep existing review snapshots stable even if an original is later removed or regraded.
    if previous is not null then
      normalized := normalized || jsonb_build_array(previous);
    else
      select * into original from public.angles where id = (item->>'story_id')::uuid and status = 'published' for share;
      if not found then raise exception 'The original story is no longer published. Choose another settled pick'; end if;
      select value into pick from jsonb_array_elements(original.picks) where value->>'id' = lower(item->>'pick_id');
      if pick is null or pick->>'result' not in ('hit','miss') then raise exception 'Only settled Hit or Miss picks can be reviewed'; end if;
      normalized := normalized || jsonb_build_array(jsonb_build_object(
        'story_id', original.id, 'pick_id', lower(pick->>'id'), 'text', pick->>'text', 'result', pick->>'result',
        'category', coalesce(pick->>'category','straight'), 'title', original.title, 'matchup', original.matchup,
        'game_id', original.game_id, 'season', original.season, 'week', original.week));
    end if;
  end loop;
  if (select count(distinct (value->>'story_id',value->>'pick_id')) from jsonb_array_elements(normalized)) <> jsonb_array_length(normalized) then
    raise exception 'A settled pick can only appear once per review post';
  end if;
  new.review_picks := normalized;
  return new;
end;
$$;
revoke all on function public.validate_angle_review_picks() from public,anon,authenticated;
drop trigger if exists validate_angle_review_picks on public.angles;
create trigger validate_angle_review_picks before insert or update on public.angles
for each row execute function public.validate_angle_review_picks();

create or replace function public.sync_angle_livewire() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' then
    delete from public.livewire_posts where angle_id = new.id;
    return new;
  end if;
  insert into public.livewire_posts(angle_id,author_id,author_name,title,body,source_url,themes,created_at,updated_at,image_paths,admin_pick,admin_picks,review_picks)
  values(new.id,new.created_by,'From The Analyst''s Desk',new.title,
    concat_ws(E'\n\n',new.narrative,
      case when btrim(new.evidence)<>'' then 'The supporting context'||E'\n'||new.evidence end,
      case when btrim(new.counterpoint)<>'' then 'The other side'||E'\n'||new.counterpoint end),
    nullif(new.source_url,''),new.themes,coalesce(new.published_at,new.updated_at),
    new.updated_at,new.image_paths,new.pick,new.picks,new.review_picks)
  on conflict(angle_id) do update set
    author_id=excluded.author_id,author_name=excluded.author_name,title=excluded.title,body=excluded.body,
    source_url=excluded.source_url,updated_at=excluded.updated_at,image_paths=excluded.image_paths,
    admin_pick=excluded.admin_pick,admin_picks=excluded.admin_picks,themes=excluded.themes,review_picks=excluded.review_picks;
  return new;
end;
$$;
revoke all on function public.sync_angle_livewire() from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
