create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists public.score_push_poll_leases (
  sport text primary key check(sport in ('NFL','NFL_PLAYS','NBA')),
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.score_push_poll_leases enable row level security;
revoke all on public.score_push_poll_leases from public,anon,authenticated;

create or replace function public.claim_score_push_poll(target_sport text,target_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare claimed text;
begin
  if target_sport not in ('NFL','NFL_PLAYS','NBA') or target_sport is null or target_token is null then
    raise exception 'Invalid score notification poll identity';
  end if;
  insert into public.score_push_poll_leases(sport,token,expires_at)
    values(target_sport,target_token,clock_timestamp()+interval '3 minutes')
  on conflict(sport) do update set token=excluded.token,expires_at=excluded.expires_at
    where public.score_push_poll_leases.expires_at<clock_timestamp()
  returning sport into claimed;
  return claimed is not null;
end $$;

create or replace function public.release_score_push_poll(target_sport text,target_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  delete from public.score_push_poll_leases where sport=target_sport and token=target_token;
end $$;
revoke all on function public.claim_score_push_poll(text,uuid),public.release_score_push_poll(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_score_push_poll(text,uuid),public.release_score_push_poll(text,uuid) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'gamewire-poll-live-games';

select cron.schedule(
  'gamewire-poll-live-games',
  '15 seconds',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-gamewire-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
notify pgrst,'reload schema';