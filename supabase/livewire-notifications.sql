begin;

create table if not exists public.livewire_push_deliveries (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.livewire_posts(id) on delete cascade,
  user_id uuid not null,
  endpoint text not null,
  subject text not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  unique(post_id, endpoint),
  foreign key(user_id, endpoint) references public.user_push_subscriptions(user_id, endpoint) on delete cascade
);
alter table public.livewire_push_deliveries add column if not exists primary_theme text
  check (primary_theme is null or primary_theme in ('news','fantasy','betting'));
alter table public.livewire_push_deliveries enable row level security;
revoke all on public.livewire_push_deliveries from public, anon, authenticated;
grant all on public.livewire_push_deliveries to service_role;
grant usage, select on sequence public.livewire_push_deliveries_id_seq to service_role;
create index if not exists livewire_push_pending_idx on public.livewire_push_deliveries(next_attempt_at)
  where delivered_at is null;

create or replace function public.queue_livewire_push() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.title is not null then
    insert into public.livewire_push_deliveries(post_id, user_id, endpoint, subject, primary_theme)
    select new.id, user_id, endpoint, new.title, new.themes[1] from public.user_push_subscriptions
    on conflict(post_id, endpoint) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.queue_livewire_push() from public, anon, authenticated;
drop trigger if exists livewire_new_post_push on public.livewire_posts;
create trigger livewire_new_post_push after insert on public.livewire_posts
  for each row execute function public.queue_livewire_push();

create or replace function public.claim_livewire_push()
returns setof public.livewire_push_deliveries
language sql security definer set search_path = ''
as $$
  update public.livewire_push_deliveries as delivery
  set attempts = delivery.attempts + 1, next_attempt_at = now() + interval '5 minutes'
  where delivery.id in (
    select id from public.livewire_push_deliveries
    where delivered_at is null and next_attempt_at <= now()
    order by next_attempt_at, id
    for update skip locked limit 100
  )
  returning delivery.*;
$$;
revoke all on function public.claim_livewire_push() from public, anon, authenticated;
grant execute on function public.claim_livewire_push() to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'gamewire-livewire-push';
select cron.schedule(
  'gamewire-livewire-push',
  '* * * * *',
  $job$
    select net.http_post(
      url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-url'),
        '/poll-live-games', '/send-livewire-push'),
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-gamewire-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-secret')),
      body := '{}'::jsonb
    );
  $job$
);
commit;
