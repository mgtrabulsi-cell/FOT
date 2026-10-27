begin;
create table if not exists public.gamewaire_publications (
  sport text not null check (sport in ('NFL','NBA')),
  event_id text not null,
  run_id uuid not null references public.gamewaire_runs(id),
  event_start timestamptz not null,
  matchup text not null,
  picks jsonb not null check (jsonb_typeof(picks) = 'array' and jsonb_array_length(picks) between 1 and 4),
  published_at timestamptz not null default now(),
  primary key (sport,event_id)
);
alter table public.gamewaire_publications enable row level security;
revoke all on public.gamewaire_publications from anon, authenticated;
grant select on public.gamewaire_publications to authenticated;
grant all on public.gamewaire_publications to service_role;
drop policy if exists "Members read published GamewAIre games" on public.gamewaire_publications;
create policy "Members read published GamewAIre games" on public.gamewaire_publications for select to authenticated using (true);
drop policy if exists "Members read GamewAIre runs" on public.gamewaire_runs;
drop policy if exists "Admins read candidate GamewAIre runs" on public.gamewaire_runs;
create policy "Admins read candidate GamewAIre runs" on public.gamewaire_runs for select to authenticated using (
  exists (select 1 from public.livewire_roles where user_id = auth.uid() and role in ('admin','owner'))
);

-- Candidate generation is private and does not create published performance records.
create or replace function public.gamewaire_finish(target_run uuid, final_status text, report jsonb, candidates jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.gamewaire_runs set status = final_status, payload = report, finished_at = now()
  where id = target_run and status = 'in_progress';
  if not found then raise exception 'Analysis is no longer in progress'; end if;
end $$;
revoke all on function public.gamewaire_finish(uuid,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.gamewaire_finish(uuid,text,jsonb,jsonb) to service_role;

create or replace function public.gamewaire_publish(target_run uuid, selected_keys text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare run public.gamewaire_runs; chosen jsonb; candidate jsonb; amount integer;
begin
  if selected_keys is null or cardinality(selected_keys) not between 1 and 4
    or (select count(distinct value) from unnest(selected_keys) value) <> cardinality(selected_keys)
    then raise exception 'Select one to four unique candidates'; end if;
  select * into run from public.gamewaire_runs where id = target_run for update;
  if not found or run.status <> 'completed' or run.event_start <= now()
    then raise exception 'Select a completed analysis for an upcoming game'; end if;
  select jsonb_agg(value order by position) into chosen
    from jsonb_array_elements(run.payload->'picks') with ordinality as items(value,position)
    where value->>'key' = any(selected_keys);
  if chosen is null or jsonb_array_length(chosen) <> cardinality(selected_keys)
    then raise exception 'Selections must come from this analysis'; end if;
  if (select count(*) from jsonb_array_elements(chosen) where value->>'market' not like 'player_%') > 1
    or exists (select 1 from jsonb_array_elements(chosen) where value->>'market' like 'player_%'
      group by lower(regexp_replace(value->>'subject','[^a-zA-Z0-9]','','g')) having count(*) > 1)
    then raise exception 'Select at most one market per player and one team market'; end if;
  for candidate in select value from jsonb_array_elements(chosen) loop
    if (candidate->>'updatedAt')::timestamptz < now() - interval '10 minutes'
      or (candidate->>'updatedAt')::timestamptz > now() + interval '1 minute'
      or (candidate->>'dataAt')::timestamptz < now() - interval '1 hour'
      then raise exception 'Candidate prices or data are stale. Analyze again before publishing'; end if;
    insert into public.gamewaire_picks (run_id,fingerprint,sport,event_id,event_start,market,subject,side,line,american,probability,push_probability,data)
    values (target_run,concat_ws('|',candidate->>'key',candidate->>'book',candidate->>'american',candidate->>'modelVersion'),
      run.sport,run.event_id,run.event_start,candidate->>'market',candidate->>'subject',candidate->>'side',
      (candidate->>'line')::numeric,(candidate->>'american')::numeric,(candidate->>'probability')::numeric,
      (candidate->>'pushProbability')::numeric,candidate)
    on conflict (fingerprint) do nothing;
    select count(*) into amount from public.gamewaire_picks
      where fingerprint = concat_ws('|',candidate->>'key',candidate->>'book',candidate->>'american',candidate->>'modelVersion')
      and (withdrawn or result <> 'pending');
    if amount > 0 then raise exception 'A withdrawn or settled selection cannot be published again'; end if;
  end loop;
  insert into public.gamewaire_publications (sport,event_id,run_id,event_start,matchup,picks,published_at)
    values (run.sport,run.event_id,target_run,run.event_start,run.matchup,chosen,now())
  on conflict (sport,event_id) do update set run_id = excluded.run_id,event_start = excluded.event_start,
    matchup = excluded.matchup,picks = excluded.picks,published_at = excluded.published_at;
end $$;
revoke all on function public.gamewaire_publish(uuid,text[]) from public, anon, authenticated;
grant execute on function public.gamewaire_publish(uuid,text[]) to service_role;
notify pgrst, 'reload schema';
commit;
