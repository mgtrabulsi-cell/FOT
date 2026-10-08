create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'gamewire-poll-live-games';

select cron.schedule(
  'gamewire-poll-live-games',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-gamewire-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-secret')
      ),
      body := '{}'::jsonb
    );
  $$
);