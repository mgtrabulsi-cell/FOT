begin;

create table if not exists public.angles (
  id uuid primary key default gen_random_uuid(),
  season integer not null check (season between 2000 and 2200),
  week integer not null check (week between 1 and 18),
  game_id text not null check (game_id ~ '^NFL:[0-9]{1,15}$'),
  matchup text not null check (char_length(btrim(matchup)) between 1 and 200),
  kind text not null check (kind in ('player', 'team')),
  subject text not null check (char_length(subject) <= 120),
  category text not null check (category in ('Former team', 'Head-to-head history', 'Rivalry / rematch', 'Milestone / comeback', 'Birthday', 'Public life event', 'Other')),
  title text not null check (char_length(title) <= 140),
  narrative text not null default '' check (char_length(narrative) <= 1500),
  evidence text not null default '' check (char_length(evidence) <= 1500),
  counterpoint text not null default '' check (char_length(counterpoint) <= 1000),
  pick text not null default '' check (char_length(pick) <= 500),
  source_url text not null default '' check (char_length(source_url) <= 2048 and (source_url = '' or source_url ~* '^https?://[^[:space:]]+$')),
  source_label text not null default '' check (char_length(source_label) <= 120),
  reviewed boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  constraint angles_published_check check (status <> 'published' or (
    reviewed and char_length(btrim(title)) > 0 and char_length(btrim(narrative)) > 0
  ))
);
create index if not exists angles_week_idx on public.angles(season, week, updated_at desc);
alter table public.angles enable row level security;
revoke all on public.angles from public, anon, authenticated;
grant select on public.angles to anon, authenticated;
grant insert, delete on public.angles to authenticated;
grant update (game_id, matchup, kind, subject, category, title, narrative, evidence, counterpoint, pick, source_url, source_label, reviewed, status, revision) on public.angles to authenticated;

drop policy if exists "Public reads published angles" on public.angles;
create policy "Public reads published angles" on public.angles for select to anon, authenticated using (status = 'published');
drop policy if exists "Admins read angle drafts" on public.angles;
create policy "Admins read angle drafts" on public.angles for select to authenticated using (public.livewire_role() in ('owner','admin'));
drop policy if exists "Admins create angles" on public.angles;
create policy "Admins create angles" on public.angles for insert to authenticated
with check (public.livewire_role() in ('owner','admin') and created_by = auth.uid() and revision = 1 and not public.account_deletion_in_progress());
drop policy if exists "Admins edit angles" on public.angles;
create policy "Admins edit angles" on public.angles for update to authenticated
using (public.livewire_role() in ('owner','admin') and not public.account_deletion_in_progress())
with check (public.livewire_role() in ('owner','admin') and not public.account_deletion_in_progress());
drop policy if exists "Admins remove angles" on public.angles;
create policy "Admins remove angles" on public.angles for delete to authenticated
using (public.livewire_role() in ('owner','admin') and not public.account_deletion_in_progress());

create or replace function public.update_angle_revision() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.revision <> old.revision + 1 then raise exception 'Reload this angle before saving another revision'; end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.update_angle_revision() from public, anon, authenticated;
drop trigger if exists angles_revision on public.angles;
create trigger angles_revision before update on public.angles for each row execute function public.update_angle_revision();

notify pgrst, 'reload schema';
commit;
