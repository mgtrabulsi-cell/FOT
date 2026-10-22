begin;

create table if not exists public.fantasy_graphics (
  id uuid primary key default gen_random_uuid(),
  season integer not null check (season between 2000 and 2200),
  week integer not null check (week between 1 and 18),
  content jsonb not null,
  published_content jsonb,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists fantasy_graphics_week on public.fantasy_graphics(season, week);
alter table public.fantasy_graphics enable row level security;
revoke all on public.fantasy_graphics from public, anon, authenticated;

-- Only RPCs expose rows, so a public reader cannot retrieve unpublished draft content.
create or replace function public.list_fantasy_graphics(graphic_season integer, graphic_week integer)
returns table(id uuid, season integer, week integer, revision integer, updated_at timestamptz, content jsonb, published_content jsonb)
language sql stable security definer set search_path = ''
as $$
  select g.id, g.season, g.week, g.revision, g.updated_at,
    case when public.livewire_role() in ('admin','owner') then g.content else g.published_content end,
    g.published_content
  from public.fantasy_graphics g
  where g.season = graphic_season and g.week = graphic_week
    and (public.livewire_role() in ('admin','owner') or g.published_content is not null)
  order by g.updated_at desc, g.id;
$$;
revoke all on function public.list_fantasy_graphics(integer, integer) from public;
grant execute on function public.list_fantasy_graphics(integer, integer) to anon, authenticated;

create or replace function public.save_fantasy_graphic(
  graphic_id uuid, graphic_season integer, graphic_week integer, graphic_content jsonb,
  expected_revision integer, graphic_action text
)
returns setof public.fantasy_graphics
language plpgsql security definer set search_path = ''
as $$
declare
  target_id uuid := coalesce(graphic_id, gen_random_uuid());
  current_row public.fantasy_graphics;
  slot jsonb;
  player jsonb;
begin
  if coalesce(public.livewire_role(), '') not in ('admin','owner') then raise exception 'Admin access is required'; end if;
  if graphic_season is null or graphic_season not between 2000 and 2200
    or graphic_week is null or graphic_week not between 1 and 18 then raise exception 'Choose a valid season and week'; end if;
  if graphic_action is null or graphic_action not in ('draft','publish','unpublish') then raise exception 'Invalid graphic action'; end if;
  if graphic_content is null or jsonb_typeof(graphic_content) <> 'object'
    or coalesce(graphic_content->>'kind', '') not in ('start','sit')
    or coalesce(graphic_content->>'position', '') not in ('QB','RB','WR','TE')
    or jsonb_typeof(graphic_content->'slots') is distinct from 'array' then raise exception 'Invalid graphic layout'; end if;
  if jsonb_array_length(graphic_content->'slots') <> 4 then raise exception 'Use exactly four player slots'; end if;
  for slot in select value from jsonb_array_elements(graphic_content->'slots') loop
    if jsonb_typeof(slot) <> 'object' or jsonb_typeof(slot->'reason') is distinct from 'string'
      or char_length(slot->>'reason') > 650
      or not (slot ? 'player') then raise exception 'Invalid reasoning or player slot'; end if;
    player := slot->'player';
    if player = 'null'::jsonb then
      if graphic_action = 'publish' then raise exception 'Select all four players before publishing'; end if;
      continue;
    end if;
    if jsonb_typeof(player) <> 'object'
      or jsonb_typeof(player->'id') is distinct from 'string' or coalesce(player->>'id', '') !~ '^[0-9]{1,15}$'
      or jsonb_typeof(player->'teamId') is distinct from 'string' or coalesce(player->>'teamId', '') !~ '^[0-9]{1,10}$'
      or jsonb_typeof(player->'name') is distinct from 'string' or coalesce(char_length(player->>'name'), 0) not between 1 and 120 or btrim(player->>'name') = ''
      or jsonb_typeof(player->'teamAbbr') is distinct from 'string' or coalesce(char_length(player->>'teamAbbr'), 0) not between 1 and 12 or btrim(player->>'teamAbbr') = ''
      or jsonb_typeof(player->'position') is distinct from 'string' or player->>'position' <> graphic_content->>'position'
      or jsonb_typeof(player->'opponent') is distinct from 'string' or char_length(player->>'opponent') > 12
      or coalesce(player->>'matchup', '') not in ('VS','@','BYE','TBD')
      or jsonb_typeof(player->'headshot') is distinct from 'string'
      or char_length(player->>'headshot') > 2048
      or ((player->>'headshot') <> '' and (player->>'headshot') !~ '^https://a[.]espncdn[.]com/[^[:space:]]*$')
      or jsonb_typeof(player->'opponentLogo') is distinct from 'string'
      or char_length(player->>'opponentLogo') > 2048
      or ((player->>'opponentLogo') <> '' and (player->>'opponentLogo') !~ '^https://a[.]espncdn[.]com/[^[:space:]]*$')
      then raise exception 'Invalid player selection'; end if;
    if graphic_action = 'publish' and (btrim(slot->>'reason') = '' or player->>'headshot' = '') then
      raise exception 'Each player needs reasoning and a photo before publishing';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(graphic_content->'slots') s where s->'player' <> 'null'::jsonb
    group by s->'player'->>'id' having count(*) > 1) then raise exception 'Choose each player only once'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_id::text, 0));
  select * into current_row from public.fantasy_graphics where id = target_id for update;
  if expected_revision is null or expected_revision <> coalesce(current_row.revision, 0)
    or (graphic_id is not null and current_row.id is null) then
    raise exception 'Another admin updated this graphic. Save your text elsewhere, then reopen the latest shared draft';
  end if;
  if current_row.id is not null and (current_row.season <> graphic_season or current_row.week <> graphic_week) then
    raise exception 'This graphic belongs to a different season or week';
  end if;
  insert into public.fantasy_graphics(id, season, week, content, published_content, updated_by)
    values(target_id, graphic_season, graphic_week, graphic_content,
      case when graphic_action = 'publish' then graphic_content else null end, auth.uid())
  on conflict(id) do update set content = excluded.content,
    published_content = case when graphic_action = 'publish' then excluded.content
      when graphic_action = 'unpublish' then null else public.fantasy_graphics.published_content end,
    revision = public.fantasy_graphics.revision + 1, updated_at = clock_timestamp(), updated_by = auth.uid();
  return query select * from public.fantasy_graphics where id = target_id;
end;
$$;
revoke all on function public.save_fantasy_graphic(uuid,integer,integer,jsonb,integer,text) from public, anon;
grant execute on function public.save_fantasy_graphic(uuid,integer,integer,jsonb,integer,text) to authenticated;

commit;
