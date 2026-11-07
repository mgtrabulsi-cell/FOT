import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import test from 'node:test';
test('soccer migration preserves permissions, locks, manual review, settlement/audit and NFL/NBA archives', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create table public.livewire_roles(user_id uuid,role text);`);
    for (const name of ['gamewaire', 'gamewaire-publishing', 'gamewaire-team-leans', 'gamewaire-schedule',
      'gamewaire-lean-results', 'gamewaire-saved-lean-publishing', 'gamewaire-soccer', 'gamewaire-soccer'])
      await db.exec(name === 'gamewaire-schedule'
        ? readFileSync(new URL(`../supabase/${name}.sql`, import.meta.url), 'utf8').split('create extension if not exists pg_cron;')[0] + 'commit;'
        : readFileSync(new URL(`../supabase/${name}.sql`, import.meta.url), 'utf8'));
    for (const name of ['gamewaire-saved-lean-publishing', 'gamewaire-soccer'])
      await db.exec(readFileSync(new URL(`../supabase/tests/${name}.sql`, import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../supabase/gamewaire-model-schedule.sql', import.meta.url), 'utf8')
      .split("select cron.unschedule(jobid)")[0] + 'commit;');
    for (const name of ['gamewaire-soccer-daily-schedule', 'gamewaire-soccer-daily-schedule'])
      await db.exec(readFileSync(new URL(`../supabase/${name}.sql`, import.meta.url), 'utf8'));
    for (const name of ['gamewaire-model-schedule', 'gamewaire-soccer-daily-schedule', 'gamewaire-saved-lean-publishing'])
      await db.exec(readFileSync(new URL(`../supabase/tests/${name}.sql`, import.meta.url), 'utf8'));
  } finally { await db.close(); }
});
