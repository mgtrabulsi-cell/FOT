begin;
create table if not exists public.sports_resources (
  resource_key text primary key check (length(resource_key) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.sports_resources enable row level security;
revoke all on public.sports_resources from anon, authenticated;
grant select on public.sports_resources to anon, authenticated;
grant all on public.sports_resources to service_role;
drop policy if exists "Public sports resources are readable" on public.sports_resources;
create policy "Public sports resources are readable" on public.sports_resources for select to anon, authenticated using (true);

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'gamewire-sports-resources';
select cron.schedule('gamewire-sports-resources', '7 * * * *', $job$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-url'),
      '/poll-live-games', '/sync-sports-resources'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-gamewire-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-secret')),
    body := '{}'::jsonb, timeout_milliseconds := 180000
  );
$job$);
notify pgrst, 'reload schema';
commit;
