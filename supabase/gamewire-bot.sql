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

notify pgrst,'reload schema';
commit;
