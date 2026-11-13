import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { defaultSettings, evaluate, markets, fullAnalysisSettings } from '../supabase/functions/_shared/gamewaire.ts';

const now = Date.parse('2026-11-09T15:00:00Z');
const quote = (sport, i) => ({ key: `${sport}-${i}`, eventId: 'game', sport, start: '2026-11-10T01:00:00Z',
  home: 'Home', away: 'Away', market: sport === 'NBA' ? 'player_points' : 'player_reception_yds',
  subject: `Player ${i}`, side: 'Over', line: 10.5, american: -200, noVig: .5, book: 'Book', updatedAt: new Date(now).toISOString() });
const evidence = (wins, value = 30) => ({ eligible: true, quality: .8, fetchedAt: new Date(now).toISOString(), risks: [],
  samples: Array.from({ length: 12 }, (_, i) => ({ date: new Date(now - (i + 1) * 86400000).toISOString(), value: i < wins ? value : 0 })) });
test('Both sports select the four highest-probability distinct players, not the four highest-value bets', () => {
  for (const sport of ['NBA', 'NFL']) {
    const quotes = Array.from({ length: 6 }, (_, i) => quote(sport, i));
    const data = new Map(quotes.map((q, i) => [q.key, evidence(10 - i)]));
    const duplicate = { ...quotes[0], key: 'same-player', american: 150 };
    data.set(duplicate.key, data.get(quotes[0].key));
    const settings = { ...defaultSettings, markets: [quotes[0].market], minEdge: 1, minEV: 1, recentWeight: 0 };
    const result = evaluate([...quotes.reverse(), duplicate], data, settings, now, 5, 4);
    assert.equal(result.picks.length, 4);
    assert.deepEqual(result.picks.map(p => p.subject), ['Player 0', 'Player 1', 'Player 2', 'Player 3']);
    assert.ok(result.picks.some(p => p.ev < 0), 'Negative-EV higher-probability candidates remain eligible');
    assert.ok(result.picks.every(p => p.projection > p.line && p.probability > .5));
    assert.ok(result.picks.every(p => p.facts.some(f => f.includes('not by positive EV'))));
    assert.equal(new Set(result.picks.map(p => p.subject)).size, 4);
    assert.equal(evaluate(quotes, data, settings, now).picks.length, 0, 'Legacy team/value mode is not silently relaxed');
    const team = { ...quotes[0], key: 'team', subject: 'Home', side: 'Home', market: 'h2h', line: null };
    const full = evaluate([...quotes, team], new Map([...data, [team.key, evidence(12)]]), settings, now, 5, 4);
    assert.equal(full.picks.length, 5);
    assert.equal(full.picks.filter(p => p.market.startsWith('player_')).length, 4);
    assert.equal(full.picks.filter(p => p.market === 'h2h').length, 1);
    assert.deepEqual(fullAnalysisSettings({ ...settings, markets: ['h2h', 'spreads'] }, sport).markets, [...markets[sport]]);
  }
});
test('Full analysis excludes high-hit-rate sides contradicted by projections and does not invent four picks', () => {
  const q = quote('NBA', 0), data = evidence(11, 11);
  const result = evaluate([q], new Map([[q.key, data]]), { ...defaultSettings, markets: [q.market], recentWeight: 0 }, now, 5, 4);
  assert.equal(result.picks.length, 0, '11/12 historical hits are insufficient when the forecast mean is below the line');
  assert.match(result.rejected[0].reason, /projection/);
  for (const invalid of [{ ...data, eligible: false }, { ...data, quality: .5 }, { ...data, samples: data.samples.slice(0, 3) }])
    assert.equal(evaluate([q], new Map([[q.key, invalid]]), { ...defaultSettings, markets: [q.market] }, now, 5, 4).picks.length, 0);
});
test('An Under-supported simulation never becomes an invented Over, and source logs stay unchanged', () => {
  const over = quote('NFL', 0), under = { ...over, key: 'under', side: 'Under' };
  const data = { ...evidence(12, 30), simulationProjection: 5 };
  const snapshot = JSON.stringify(data);
  const result = evaluate([over, under], new Map([[over.key, data], [under.key, data]]),
    { ...defaultSettings, markets: [over.market] }, now, 5, 4);
  assert.equal(result.picks.length, 0);
  assert.ok(result.rejected.some(row => row.key === 'under' && /Over-only/.test(row.reason)));
  assert.equal(JSON.stringify(data), snapshot);
});
test('Full schedule SQL preserves jobs, refreshes once at 60 minutes, bounds retries and enforces the shared budget', async () => {
  const db = new PGlite();
  const file = name => readFileSync(new URL(`../supabase/${name}.sql`, import.meta.url), 'utf8');
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create table public.livewire_roles(user_id uuid,role text);`);
    for (const name of ['gamewaire', 'gamewaire-publishing', 'gamewaire-team-leans', 'gamewaire-schedule', 'gamewaire-model-schedule',
      'gamewaire-lean-results', 'gamewaire-saved-lean-publishing', 'gamewaire-soccer',
      'gamewaire-soccer-daily-schedule', 'gamewaire-full-analysis', 'gamewaire-full-analysis'])
      await db.exec(name === 'gamewaire-schedule' ? file(name).split('create extension if not exists pg_cron;')[0] + 'commit;'
        : name === 'gamewaire-model-schedule' ? file(name).split('select cron.unschedule(jobid)')[0] + 'commit;' : file(name));
    await db.exec(`select public.gamewaire_schedule_plan('NBA',((now()+interval '3 hours') at time zone 'America/New_York')::date,
      jsonb_build_array(jsonb_build_object('event_id','test','event_start',now()+interval '3 hours','matchup','A @ B','selection_note','Full')),
      null,'Full','probability-first-v11');`);
    const claim = async () => (await db.query('select public.gamewaire_schedule_claim() job')).rows[0].job;
    let job = await claim();
    assert.equal(job.phase, 'initial');
    assert.equal(job.attempts, 1);
    await db.exec("update public.gamewaire_schedule_jobs set status='failed',finished_at=now()");
    assert.equal(await claim(), null, 'No early refresh');
    await db.exec("update public.gamewaire_schedule_jobs set event_start=now()+interval '59 minutes',started_at=now()-interval '2 hours'");
    job = await claim();
    assert.equal(job.phase, 'pregame');
    assert.equal(job.attempts, 1);
    await db.exec("update public.gamewaire_schedule_jobs set status='completed',finished_at=now()");
    assert.equal(await claim(), null, 'No third successful run');
    await db.exec("update public.gamewaire_schedule_jobs set status='failed',finished_at=now()-interval '16 minutes'");
    job = await claim();
    assert.equal(job.attempts, 2);
    await db.exec("update public.gamewaire_schedule_jobs set status='failed',finished_at=now()-interval '16 minutes'");
    assert.equal(await claim(), null, 'Two failures in one phase cannot create an unbounded paid loop');
    await db.exec(`update public.gamewaire_schedule_batches set updated_at=now()-interval '2 hours',
      game_date=(select (event_start at time zone 'America/New_York')::date from public.gamewaire_schedule_jobs);
      select public.gamewaire_schedule_plan('NBA',(select game_date from public.gamewaire_schedule_batches),
        (select jsonb_agg(jsonb_build_object('event_id',event_id,'event_start',event_start,'matchup',matchup,'selection_note',selection_note))
          from public.gamewaire_schedule_jobs),null,'Full','probability-first-v11')`);
    assert.equal((await db.query('select attempts,status,phase from public.gamewaire_schedule_jobs')).rows[0].attempts, 2, 'Hourly planning never resets attempts');
    await db.exec(`insert into public.gamewaire_schedule_jobs(batch_id,sport,event_id,event_start,matchup,selection_note,status,started_at,finished_at)
      select id,'NBA','successful',now()+interval '59 minutes','E @ F','Successful initial','completed',now()-interval '2 hours',now()
        from public.gamewaire_schedule_batches`);
    const successful = await claim();
    assert.equal(successful.event_id, 'successful');
    assert.equal(successful.phase, 'pregame', 'Successful and failed initial runs both retain their pregame refresh');
    await db.exec("update public.gamewaire_schedule_jobs set status='completed',finished_at=now() where event_id='successful'");
    await db.exec(`insert into public.gamewaire_schedule_jobs(batch_id,sport,event_id,event_start,matchup,selection_note)
      select id,'NBA','late',now()+interval '30 minutes','C @ D','Late first run' from public.gamewaire_schedule_batches`);
    assert.equal((await claim()).event_id, 'late');
    await db.exec("update public.gamewaire_schedule_jobs set status='completed',finished_at=now() where event_id='late'");
    assert.equal(await claim(), null, 'A first analysis inside 60 minutes does not get another automatic refresh');
    await db.exec("insert into public.gamewaire_credit_reservations(cost) select 7 from generate_series(1,2857)");
    assert.equal((await db.query('select public.gamewaire_reserve_credits(1) ok')).rows[0].ok, true);
    assert.equal((await db.query('select public.gamewaire_reserve_credits(1) ok')).rows[0].ok, false);
    await db.exec("update public.gamewaire_credit_reservations set created_at=now()-interval '32 days'");
    assert.equal((await db.query('select public.gamewaire_reserve_credits(7) ok')).rows[0].ok, true);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.gamewaire_reserve_credits(integer)','execute') ok")).rows[0].ok, false);
  } finally { await db.close(); }
});
