begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname='gamewire-gamewaire-results';
select cron.schedule('gamewire-gamewaire-results','*/5 * * * *',$job$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-url'),'/poll-live-games','/gamewaire'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-gamewire-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='gamewire-poll-secret')),
    body := '{"action":"settlePublished"}'::jsonb,timeout_milliseconds := 180000
  );
$job$);
commit;
