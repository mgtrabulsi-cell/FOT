begin;

do $$
declare item record;
begin
  for item in select conname from pg_constraint
    where conrelid = 'public.angles'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%reviewed%' and pg_get_constraintdef(oid) like '%published%'
  loop
    execute format('alter table public.angles drop constraint %I', item.conname);
  end loop;
end;
$$;
alter table public.angles add constraint angles_published_check check (
  status <> 'published' or (reviewed and char_length(btrim(title)) > 0 and char_length(btrim(narrative)) > 0)
);

alter table public.livewire_push_deliveries alter column post_id drop not null;
alter table public.livewire_push_deliveries add column if not exists angle_id uuid references public.angles(id) on delete cascade;
create unique index if not exists storyline_push_device_idx on public.livewire_push_deliveries(angle_id, endpoint);
alter table public.livewire_push_deliveries drop constraint if exists push_delivery_content_check;
alter table public.livewire_push_deliveries add constraint push_delivery_content_check check (
  (post_id is not null and angle_id is null) or (post_id is null and angle_id is not null)
);

create table if not exists public.angle_push_publications (
  angle_id uuid primary key references public.angles(id) on delete cascade,
  first_published_at timestamptz not null default now()
);
alter table public.angle_push_publications enable row level security;
revoke all on public.angle_push_publications from public, anon, authenticated;
grant all on public.angle_push_publications to service_role;
-- Existing published stories are not broadcast when installing this feature.
insert into public.angle_push_publications(angle_id)
select id from public.angles where status = 'published' on conflict do nothing;

create or replace function public.queue_angle_push() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' then
    delete from public.livewire_push_deliveries where angle_id = new.id and delivered_at is null;
    return new;
  end if;
  insert into public.angle_push_publications(angle_id) values (new.id) on conflict do nothing;
  if found then
    insert into public.livewire_push_deliveries(angle_id, user_id, endpoint, subject)
    select new.id, user_id, endpoint, new.title from public.user_push_subscriptions
    on conflict(angle_id, endpoint) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.queue_angle_push() from public, anon, authenticated;
drop trigger if exists angle_first_publication_push on public.angles;
create trigger angle_first_publication_push after insert or update on public.angles
for each row execute function public.queue_angle_push();

notify pgrst, 'reload schema';
commit;
