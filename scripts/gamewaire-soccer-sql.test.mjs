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
    for (const name of ['gamewaire-full-analysis', 'gamewaire-prop-upgrade', 'gamewaire-champions-history',
      'gamewaire-champions-weekly', 'gamewaire-champions-weekly'])
      await db.exec(readFileSync(new URL(`../supabase/${name}.sql`, import.meta.url), 'utf8'));
    const currentGuard = await db.query("select pg_get_functiondef('public.gamewaire_soccer_publication_guard()'::regprocedure) as definition");
    assert.ok(currentGuard.rows[0].definition.includes("'soccer-probability-v5'"));
    await db.exec('delete from public.gamewaire_schedule_jobs; delete from public.gamewaire_schedule_batches; delete from public.gamewaire_soccer_schedule_budget;');
    const monday = (await db.query("select date_trunc('week',(now()+interval '7 days') at time zone 'America/New_York')::date::text as date")).rows[0].date;
    const tuesday = new Date(`${monday}T12:00:00Z`); tuesday.setUTCDate(tuesday.getUTCDate() + 1);
    const sunday = new Date(`${monday}T12:00:00Z`); sunday.setUTCDate(sunday.getUTCDate() + 6);
    const events = [tuesday, sunday].map((date, index) => ({ event_id: `weekly-${index}`, event_start: date.toISOString(), matchup: 'A @ B', selection_note: 'Weekly' }));
    await db.query('select public.gamewaire_schedule_plan($1,$2::date,$3::jsonb,null,$4,$5)',
      ['Champions League', monday, JSON.stringify(events), 'Weekly Monday plan', 'soccer-probability-v4']);
    const jobs = await db.query("select event_id from public.gamewaire_schedule_jobs where sport='Champions League'");
    assert.equal(jobs.rows.length, 2);
    await assert.rejects(db.query('select public.gamewaire_schedule_plan($1,$2::date,$3::jsonb,null,$4,$5)',
      ['Champions League', tuesday.toISOString().slice(0, 10), JSON.stringify(events), 'Wrong weekday', 'soccer-probability-v4']), /Invalid/);
    const outside = new Date(`${monday}T12:00:00Z`); outside.setUTCDate(outside.getUTCDate() + 7);
    await assert.rejects(db.query('select public.gamewaire_schedule_plan($1,$2::date,$3::jsonb,null,$4,$5)',
      ['Champions League', monday, JSON.stringify([{ ...events[0], event_start: outside.toISOString() }]), 'Outside week', 'soccer-probability-v4']), /Invalid scheduled game/);
    const claimed = (await db.query('select public.gamewaire_schedule_claim() as job')).rows[0].job;
    assert.equal(claimed.sport, 'Champions League');
    await db.query("update public.gamewaire_schedule_jobs set status='completed',finished_at=now(),provider_usage='{\"creditsRemaining\":4}'::jsonb where id=$1", [claimed.id]);
    assert.equal((await db.query('select public.gamewaire_schedule_claim() as job')).rows[0].job, null);
    const skipped = await db.query("select error from public.gamewaire_schedule_jobs where status='skipped'");
    assert.ok(skipped.rows.some(row => row.error.includes('below 5 credits')));
  } finally { await db.close(); }
});
