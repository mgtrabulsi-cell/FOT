import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
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
    for (let iteration = 0; iteration < 2; iteration++)
      await db.exec(readFileSync(new URL('../supabase/gamewaire-prop-upgrade.sql', import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../supabase/tests/gamewaire-prop-upgrade.sql', import.meta.url), 'utf8'));
    for (let iteration = 0; iteration < 2; iteration++)
      await db.exec(readFileSync(new URL('../supabase/gamewaire-champions-history.sql', import.meta.url), 'utf8'));
    const functions = await db.query(`select pg_get_functiondef(oid) as definition from pg_proc where oid in
      ('public.gamewaire_publish_lean(uuid)'::regprocedure, 'public.gamewaire_soccer_publication_guard()'::regprocedure,
      'public.gamewaire_schedule_plan(text,date,jsonb,text,text,text)'::regprocedure, 'public.gamewaire_schedule_claim()'::regprocedure)`);
    assert.equal(functions.rows.length, 4);
    assert.ok(functions.rows.every(row => !row.definition.includes("'soccer-probability-v3'")));
    assert.ok(functions.rows.some(row => row.definition.includes("'soccer-probability-v4'")));
  } finally { await db.close(); }
});
