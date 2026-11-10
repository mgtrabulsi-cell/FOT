begin;
alter table public.gamewaire_picks add column if not exists is_automatic boolean not null default false;
create table if not exists public.gamewaire_automatic_picks (
  sport text not null check (sport in ('NFL','NBA')),
  event_id text not null,
  run_id uuid not null references public.gamewaire_runs(id),
  candidate jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (sport,event_id)
);
alter table public.gamewaire_automatic_picks enable row level security;
revoke all on public.gamewaire_automatic_picks from public,anon,authenticated;
grant all on public.gamewaire_automatic_picks to service_role;

create or replace function public.gamewaire_track_automatic_pick(target_run uuid, candidate jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare source public.gamewaire_runs; inserted integer;
begin
  select * into source from public.gamewaire_runs where id=target_run;
  if not found or source.sport not in ('NBA','NFL')
    or source.status not in ('completed','no_qualifying') then
    raise exception 'Automatic pick requires a finished saved analysis';
  end if;
  if candidate is null or not (
    coalesce(candidate=source.payload->'teamLean'->'pick',false)
    or coalesce(candidate=source.payload->'winnerLean'->'pick',false))
    or coalesce(candidate->>'market' not in ('h2h','spreads'),true)
    or coalesce(candidate->>'sport'<>source.sport,true)
    or coalesce(candidate->>'eventId'<>source.event_id,true)
    or coalesce((candidate->>'start')::timestamptz<>source.event_start,true)
    or coalesce(candidate->'identifiers'->>'espnEventId','') !~ '^[0-9]+$' then
    raise exception 'Automatic pick must match its verified source selection';
  end if;
  if source.event_start<=now() then return false; end if;
  if coalesce((candidate->>'dataAt')::timestamptz>=source.event_start,true)
    or coalesce((candidate->>'updatedAt')::timestamptz>=source.event_start,true)
    or source.created_at>=source.event_start then
    raise exception 'Automatic pick must have pregame evidence and prices';
  end if;
  insert into public.gamewaire_automatic_picks(sport,event_id,run_id,candidate)
    values(source.sport,source.event_id,target_run,candidate)
    on conflict(sport,event_id) do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then return false; end if;
  insert into public.gamewaire_picks(run_id,fingerprint,sport,event_id,event_start,market,subject,side,line,
    american,probability,push_probability,data,is_top_pick,is_game_lean,is_automatic)
  values(target_run,concat_ws('|',candidate->>'key',candidate->>'book',candidate->>'american',candidate->>'modelVersion'),
    source.sport,source.event_id,source.event_start,candidate->>'market',candidate->>'subject',candidate->>'side',
    (candidate->>'line')::numeric,(candidate->>'american')::numeric,(candidate->>'probability')::numeric,
    (candidate->>'pushProbability')::numeric,candidate,false,false,true)
  on conflict(fingerprint) do update set is_automatic=true where not gamewaire_picks.is_automatic;
  return true;
end $$;
revoke all on function public.gamewaire_track_automatic_pick(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gamewaire_track_automatic_pick(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
