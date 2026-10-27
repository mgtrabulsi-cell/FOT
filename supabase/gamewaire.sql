begin;
create table if not exists public.gamewaire_runs (
  id uuid primary key default gen_random_uuid(),
  sport text not null check (sport in ('NFL', 'NBA')),
  event_id text not null,
  event_start timestamptz not null,
  matchup text not null,
  settings jsonb not null,
  status text not null check (status in ('in_progress','completed','no_qualifying','insufficient_data','stale_odds','provider_error','setup_required')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists gamewaire_runs_event on public.gamewaire_runs (sport, event_id, created_at desc);
create unique index if not exists gamewaire_one_running_event on public.gamewaire_runs (sport, event_id) where status = 'in_progress';
create table if not exists public.gamewaire_picks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.gamewaire_runs(id),
  fingerprint text not null unique,
  sport text not null check (sport in ('NFL','NBA')),
  event_id text not null,
  event_start timestamptz not null,
  market text not null,
  subject text not null,
  side text not null,
  line numeric,
  american numeric not null check (abs(american) >= 100),
  probability numeric not null check (probability between 0 and 1),
  push_probability numeric not null check (push_probability between 0 and 1 and probability + push_probability <= 1.000000001),
  data jsonb not null,
  result text not null default 'pending' check (result in ('pending','win','loss','push','void')),
  closing_american numeric check (abs(closing_american) >= 100),
  closing_line numeric,
  closing_at timestamptz,
  withdrawn boolean not null default false,
  settlement_note text,
  settled_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists gamewaire_picks_history on public.gamewaire_picks (created_at desc, id);
create table if not exists public.gamewaire_limits (
  scope text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  bucket timestamptz not null,
  attempts integer not null
);
alter table public.gamewaire_runs enable row level security;
alter table public.gamewaire_picks enable row level security;
alter table public.gamewaire_limits enable row level security;
revoke all on public.gamewaire_runs, public.gamewaire_picks, public.gamewaire_limits from anon, authenticated;
grant select on public.gamewaire_runs, public.gamewaire_picks to authenticated;
grant all on public.gamewaire_runs, public.gamewaire_picks, public.gamewaire_limits to service_role;
drop policy if exists "Members read GamewAIre runs" on public.gamewaire_runs;
create policy "Members read GamewAIre runs" on public.gamewaire_runs for select to authenticated using (true);
drop policy if exists "Members read GamewAIre picks" on public.gamewaire_picks;
create policy "Members read GamewAIre picks" on public.gamewaire_picks for select to authenticated using (true);
create or replace function public.gamewaire_claim(target_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare amount integer; current_bucket timestamptz := date_trunc('hour', now());
begin
  insert into public.gamewaire_limits as limits (scope,bucket,attempts) values ('global',current_bucket,1)
  on conflict (scope) do update set bucket = excluded.bucket,
    attempts = case when limits.bucket = excluded.bucket then limits.attempts + 1 else 1 end
  returning attempts into amount;
  if amount > 20 then return false; end if;
  insert into public.gamewaire_limits as limits (scope,user_id,bucket,attempts) values (target_user::text,target_user,current_bucket,1)
  on conflict (scope) do update set bucket = excluded.bucket,
    attempts = case when limits.bucket = excluded.bucket then limits.attempts + 1 else 1 end
  returning attempts into amount;
  return amount <= 6;
end $$;
revoke all on function public.gamewaire_claim(uuid) from public, anon, authenticated;
grant execute on function public.gamewaire_claim(uuid) to service_role;
create or replace function public.gamewaire_finish(target_run uuid, final_status text, report jsonb, candidates jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare candidate jsonb; run public.gamewaire_runs;
begin
  select * into run from public.gamewaire_runs where id = target_run for update;
  if not found or run.status <> 'in_progress' then raise exception 'Analysis is no longer in progress'; end if;
  for candidate in select value from jsonb_array_elements(candidates) loop
    insert into public.gamewaire_picks (run_id,fingerprint,sport,event_id,event_start,market,subject,side,line,american,probability,push_probability,data)
    values (target_run, concat_ws('|',candidate->>'key',candidate->>'book',candidate->>'american',candidate->>'modelVersion'),
      run.sport,run.event_id,run.event_start,candidate->>'market',candidate->>'subject',candidate->>'side',
      (candidate->>'line')::numeric,(candidate->>'american')::numeric,(candidate->>'probability')::numeric,
      (candidate->>'pushProbability')::numeric,candidate)
    on conflict (fingerprint) do nothing;
  end loop;
  update public.gamewaire_runs set status = final_status, payload = report, finished_at = now() where id = target_run;
end $$;
revoke all on function public.gamewaire_finish(uuid,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.gamewaire_finish(uuid,text,jsonb,jsonb) to service_role;
create table if not exists public.gamewaire_pick_changes (
  id bigint generated always as identity primary key,
  pick_id uuid not null references public.gamewaire_picks(id),
  changed_at timestamptz not null default now(),
  previous jsonb not null,
  updated jsonb not null
);
alter table public.gamewaire_pick_changes enable row level security;
revoke all on public.gamewaire_pick_changes from anon, authenticated;
grant all on public.gamewaire_pick_changes to service_role;
grant usage, select on sequence public.gamewaire_pick_changes_id_seq to service_role;
create or replace function public.gamewaire_audit_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.gamewaire_pick_changes (pick_id,previous,updated) values (old.id,to_jsonb(old),to_jsonb(new));
  return new;
end $$;
revoke all on function public.gamewaire_audit_change() from public, anon, authenticated;
drop trigger if exists gamewaire_pick_change on public.gamewaire_picks;
create trigger gamewaire_pick_change after update on public.gamewaire_picks for each row execute function public.gamewaire_audit_change();
notify pgrst, 'reload schema';
commit;
