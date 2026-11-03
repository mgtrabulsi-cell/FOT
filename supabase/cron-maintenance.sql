begin;
-- pg_cron keeps one bookkeeping row per job run; with several every-minute jobs
-- this table grows unbounded and eventually stalls the scheduler. Purge history
-- older than two days now and nightly thereafter.
select cron.unschedule(jobid) from cron.job where jobname = 'gamewire-cron-cleanup';
select cron.schedule('gamewire-cron-cleanup', '17 9 * * *', $job$
  delete from cron.job_run_details where end_time < now() - interval '2 days';
$job$);
delete from cron.job_run_details where end_time < now() - interval '2 days';
commit;
