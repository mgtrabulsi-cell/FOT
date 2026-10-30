begin;

create table if not exists public.gamewire_fantasy_rankings (
  season integer not null check (season between 2000 and 2200),
  week integer not null check (week between 1 and 18),
  scoring_format text not null check (scoring_format in ('ppr','half','standard')),
  position text not null check (position in ('QB','RB','WR','TE')),
  player_id text not null check (player_id ~ '^[0-9]{1,12}$'),
  team_id text not null check (team_id ~ '^[0-9]{1,2}$'),
  player_name text not null check (char_length(btrim(player_name)) between 1 and 120),
  rank integer not null check (rank between 1 and 30),
  published_at timestamptz not null default now(),
  primary key(season,week,scoring_format,position,player_id),
  unique(season,week,scoring_format,position,rank)
);
alter table public.gamewire_fantasy_rankings enable row level security;
revoke all on public.gamewire_fantasy_rankings from public, anon, authenticated;
grant select, insert, update, delete on public.gamewire_fantasy_rankings to service_role;

create table if not exists public.gamewire_bot_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null
);
alter table public.gamewire_bot_cache enable row level security;
revoke all on public.gamewire_bot_cache from public, anon, authenticated;
grant select, insert, update, delete on public.gamewire_bot_cache to service_role;

create table if not exists public.gamewire_bot_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  hour timestamptz not null,
  requests integer not null check (requests > 0),
  primary key(user_id,hour)
);
alter table public.gamewire_bot_usage enable row level security;
revoke all on public.gamewire_bot_usage from public, anon, authenticated;
grant select, insert, update, delete on public.gamewire_bot_usage to service_role;

create or replace function public.gamewire_bot_claim(target_user uuid) returns boolean
language plpgsql security definer set search_path=''
as $$
declare claimed integer;
begin
  if not exists (
    select 1 from auth.users u
    where u.id=target_user and not coalesce(u.is_anonymous,false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  ) then return false; end if;
  delete from public.gamewire_bot_usage where hour < now()-interval '2 days';
  delete from public.gamewire_bot_cache where expires_at < now()-interval '1 day';
  insert into public.gamewire_bot_usage(user_id,hour,requests)
  values(target_user,date_trunc('hour',now()),1)
  on conflict(user_id,hour) do update set requests=public.gamewire_bot_usage.requests+1
  where public.gamewire_bot_usage.requests < 60
  returning requests into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.gamewire_bot_claim(uuid) from public, anon, authenticated;
grant execute on function public.gamewire_bot_claim(uuid) to service_role;

create or replace function public.gamewire_bot_save_rankings(
  target_season integer, target_week integer, target_format text, target_position text, players jsonb
) returns timestamptz
language plpgsql security definer set search_path=''
as $$
declare published timestamptz := clock_timestamp();
begin
  if target_season not between 2000 and 2200 or target_week not between 1 and 18
    or target_format not in ('ppr','half','standard') or target_position not in ('QB','RB','WR','TE')
    or target_season is null or target_week is null or target_format is null or target_position is null
    or jsonb_typeof(players) is distinct from 'array' then
    raise exception 'Invalid weekly ranking scope';
  end if;
  if jsonb_array_length(players) not between 1 and 30
    or exists (select 1 from jsonb_array_elements(players) p
      where coalesce(p->>'id','') !~ '^[0-9]{1,12}$' or coalesce(p->>'teamId','') !~ '^[0-9]{1,2}$'
        or char_length(btrim(coalesce(p->>'name',''))) not between 1 and 120)
    or (select count(distinct p->>'id') from jsonb_array_elements(players) p) <> jsonb_array_length(players) then
    raise exception 'Invalid or duplicate ranked players';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    target_season::text || ':' || target_week::text || ':' || target_format || ':' || target_position, 0));
  delete from public.gamewire_fantasy_rankings
    where season=target_season and week=target_week and scoring_format=target_format and position=target_position;
  insert into public.gamewire_fantasy_rankings(season,week,scoring_format,position,player_id,team_id,player_name,rank,published_at)
    select target_season,target_week,target_format,target_position,p->>'id',p->>'teamId',p->>'name',ordinality,published
    from jsonb_array_elements(players) with ordinality as entries(p,ordinality);
  return published;
end;
$$;
revoke all on function public.gamewire_bot_save_rankings(integer,integer,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.gamewire_bot_save_rankings(integer,integer,text,text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
