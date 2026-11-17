import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { nbaAvailabilityKey, nbaDailyPerformers, nbaSimulationBox, nbaSimulationRoster, nbaSimulationSchedule,
  nbaSimulationVersion, readNBAGameSimulation, readNBASimulationGame, simulateNBAGame } from '../supabase/functions/_shared/nbaSimulation.ts';
import { advanceNBASimulation } from '../supabase/functions/_shared/nbaSimulationSources.ts';
import { loadNBAGameSimulation, readNBASimulationScope, settleNBAGameSimulations, warmNBAGameSimulations } from '../supabase/functions/_shared/nbaSimulationBackend.ts';
import { learnAdjustment } from '../supabase/functions/_shared/gamewireLearning.ts';
import * as nbaModel from '../supabase/functions/_shared/nbaSimulation.ts';

const now = Date.parse('2026-11-17T02:00:00Z');
const game = { id: '900', date: '2026-11-18T00:00:00Z', season: 2027, seasonType: 2,
  home: { id: '1', name: 'Home Team', abbr: 'HOM' }, away: { id: '2', name: 'Away Team', abbr: 'AWY' } };
const roster = ['1', '2'].flatMap(teamId => Array.from({ length: 10 }, (_, i) => ({
  id: `${teamId}${i + 10}`, name: `Player ${teamId}-${i}`, teamId, position: i % 2 ? 'G' : 'F', status: 'Active', excluded: false,
})));
const observations = () => ['1', '2'].flatMap(teamId => Array.from({ length: 12 }, (_, i) => ({
  id: `${teamId}${100 + i}`, date: new Date(now - (i + 1) * 86400000).toISOString(), season: 2027, home: i % 2 === 0,
  teamId, opponentId: '3', points: 100 + i, allowed: 105 - i, possessions: 96 + i % 3,
  allowedRebounds: 40 + i % 4, allowedAssists: 24 + i % 3,
  players: Object.fromEntries(roster.filter(row => row.teamId === teamId).map((player, index) =>
    [player.id, { points: 25 - index + i % 4, rebounds: 10 - index, assists: 9 - index, minutes: 32 - index }])),
})));
const neutral = () => ({ score: learnAdjustment([], 'stat', now), pra: learnAdjustment([], 'stat', now) });
const scope = { eventId: game.id, kickoff: game.date, homeTeamId: game.home.id, awayTeamId: game.away.id };
const parse = value => readNBAGameSimulation(value, game.id, game.date, { home: game.home.id, away: game.away.id });
function summary(id = game.id, date = game.date, final = true) {
  return { header: { id, season: { year: 2027, type: 2 }, competitions: [{
    date, status: { type: { completed: final, state: final ? 'post' : 'pre' } },
    competitors: ['home', 'away'].map((side, i) => ({ homeAway: side, score: String(110 - i * 5), team: { ...game[side], displayName: game[side].name, abbreviation: game[side].abbr } })),
  }] }, boxscore: { teams: ['1', '2'].map(id => ({ team: { id }, statistics: [
    { name: 'fieldGoalsMade-fieldGoalsAttempted', displayValue: '40-90' },
    { name: 'freeThrowsMade-freeThrowsAttempted', displayValue: '20-25' },
    { name: 'offensiveRebounds', displayValue: '8' }, { name: 'totalTurnovers', displayValue: '12' },
    { name: 'totalRebounds', displayValue: '44' }, { name: 'assists', displayValue: '24' },
  ] })), players: ['1', '2'].map(teamId => ({ team: { id: teamId }, statistics: [{
    labels: ['MIN', 'PTS', 'REB', 'AST'], athletes: roster.filter(row => row.teamId === teamId).map(player => ({
      athlete: { id: player.id }, stats: ['24:30', '12', '4', '3'],
    })),
  }] })) } };
}
test('NBA bootstrap is deterministic, uses correlated personal lines and respects rotation minutes and out players', () => {
  const players = structuredClone(roster); players[0].excluded = true; players[0].status = 'Out';
  const input = observations(), forecast = simulateNBAGame(game, input, players, now, neutral());
  assert.equal(forecast.status, 'ready'); assert.equal(forecast.runs, 1000); assert.equal(forecast.calibrated, false);
  assert.deepEqual(forecast, simulateNBAGame(game, input, players, now, neutral()));
  assert.equal(forecast.home.players.some(row => row.id === players[0].id), false);
  assert.equal(forecast.injuries[0].name, players[0].name);
  for (const team of [forecast.home, forecast.away]) {
    assert.ok(team.players.reduce((sum, p) => sum + p.stats.minutes.mean, 0) <= 240.05);
    for (const p of team.players) assert.ok(Math.abs(p.stats.pra.mean - p.stats.points.mean - p.stats.rebounds.mean - p.stats.assists.mean) < .02);
  }
  assert.equal(parse(forecast), forecast);
  assert.equal(input.length, 24);
});
test('NBA insufficient evidence stays collecting; missing appearances and post-tipoff data never manufacture projections', () => {
  assert.equal(simulateNBAGame(game, observations().filter(row => row.teamId === '1'), roster, now).status, 'collecting');
  const rows = observations();
  for (const row of rows) delete row.players['110'];
  assert.equal(simulateNBAGame(game, rows, roster, now).home.players.some(p => p.id === '110'), false);
  const normal = simulateNBAGame(game, observations(), roster, now);
  const future = { ...observations()[0], id: 'future', date: new Date(now + 1000).toISOString(), points: 9999 };
  assert.deepEqual(simulateNBAGame(game, [...observations(), future], roster, now), normal);
  assert.throws(() => simulateNBAGame(game, observations(), roster, Date.parse(game.date)), /after tipoff/);
  assert.equal(simulateNBAGame({ ...game, date: new Date(now + 20 * 60000).toISOString() }, observations(), roster, now).lockedAt, new Date(now).toISOString());
});
test('NBA daily performers rank three distinct players by matchup-adjusted PRA on the Eastern slate, not points or odds', () => {
  const first = simulateNBAGame(game, observations(), roster, now);
  const second = structuredClone(first);
  second.eventId = '901'; second.kickoff = '2026-11-18T01:00:00Z';
  second.home.players[1].stats.pra.mean = 99;
  const leaders = nbaDailyPerformers([first, second], '2026-11-17');
  assert.equal(leaders.length, 3); assert.equal(leaders[0].stats.pra.mean, 99);
  assert.equal(new Set(leaders.map(p => p.id)).size, 3);
  assert.deepEqual(nbaDailyPerformers([first], '2026-11-18'), []);
  second.status = 'collecting';
  assert.ok(nbaDailyPerformers([first, second], '2026-11-17').every(p => p.eventId === first.eventId));
});
test('NBA learning retains explicit neutral baselines and no correction activates without validated settled evidence', () => {
  const baseline = simulateNBAGame(game, observations(), roster, now, neutral());
  const learning = neutral(); learning.pra = { ...learning.pra, active: true, adjustment: 1.05 };
  const adjusted = simulateNBAGame(game, observations(), roster, now, learning);
  assert.deepEqual(adjusted.baseline, baseline.baseline);
  assert.ok(Math.abs(adjusted.home.players[0].stats.pra.mean - baseline.home.players[0].stats.pra.mean * 1.05) < .02);
  assert.equal(neutral().score.active, false);
  assert.equal(neutral().pra.adjustment, 1);
});
test('NBA scoring uses verified without-player evidence only when at least eight complete games support it', () => {
  const rows = observations(), players = structuredClone(roster);
  players[0].excluded = true; players[0].status = 'Out';
  for (const [i, row] of rows.filter(row => row.teamId === '1').entries()) {
    row.completePlayers = true;
    if (i >= 4) delete row.players[players[0].id];
  }
  const result = simulateNBAGame(game, rows, players, now);
  assert.ok(result.warnings.some(warning => warning.includes('8 fully accounted games')));
  const incomplete = observations();
  const fallback = simulateNBAGame(game, incomplete, players, now);
  assert.ok(fallback.warnings.some(warning => warning.includes('no injury-specific adjustment')));
});
test('NBA parser validates game identities, complete stat pairs, DNPs, schedules and availability without inventing zeroes', () => {
  const raw = summary('800', new Date(now - 86400000).toISOString());
  const rows = nbaSimulationBox(raw, '800', now);
  assert.equal(rows[0].players['110'].minutes, 24.5);
  assert.equal(rows[0].possessions, 105);
  assert.equal(rows[0].points, 110);
  assert.throws(() => readNBASimulationGame(raw, '801'), /verified/);
  assert.throws(() => nbaSimulationBox(summary(), game.id, now), /before/);
  raw.boxscore.players[0].statistics[0].athletes[0].didNotPlay = true;
  assert.equal(nbaSimulationBox(raw, '800', now)[0].players['110'], undefined);
  raw.boxscore.teams[0].statistics.pop();
  assert.throws(() => nbaSimulationBox(raw, '800', now), /incomplete/);
  const players = nbaSimulationRoster({ team: { id: '1' }, athletes: [{ id: '8', displayName: 'Player', position: { abbreviation: 'G' }, injuries: [{ status: 'Out' }], status: { type: 'active' } }] }, '1');
  assert.equal(players[0].excluded, true);
  assert.equal(nbaAvailabilityKey(players), nbaAvailabilityKey([...players].reverse()));
  const event = { id: '800', date: new Date(now - 86400000).toISOString(), season: { type: 2 }, competitions: raw.header.competitions };
  assert.equal(nbaSimulationSchedule({ team: { id: '1' }, events: [event] }, '1', now).length, 1);
  assert.throws(() => readNBASimulationScope({ ...scope, awayTeamId: '1' }), /valid NBA/);
});
test('NBA saved forecast parser rejects wrong teams, reschedules, invalid ranges, missing players and late forecasts', () => {
  const forecast = simulateNBAGame(game, observations(), roster, now);
  for (const change of [
    row => { row.homeTeamId = '99'; }, row => { row.kickoff = new Date(Date.parse(game.date) + 60000).toISOString(); },
    row => { row.home.players[0].stats.pra.mean = NaN; }, row => { row.forecastAt = game.date; },
    row => { row.home.players[0].stats.points.p10 = 10000; }, row => { row.home.players.push(row.home.players[0]); },
  ]) { const invalid = structuredClone(forecast); change(invalid); assert.throws(() => parse(invalid), /invalid forecast/); }
});
test('NBA backfill alternates teams, caches verified boxes, bounds fetch concurrency and creates an early supported forecast', async () => {
  const cacheRows = new Map(), calls = [];
  let active = 0, maximum = 0;
  const job = { createdAt: new Date(now).toISOString(), references: ['1', '2'].flatMap(teamId => Array.from({ length: 12 }, (_, i) => ({
    id: `${teamId}${100 + i}`, date: new Date(now - (i + 1) * 86400000).toISOString(), teamId, opponentId: teamId === '1' ? '2' : '1',
  }))) };
  const cache = { readMany: async keys => new Map(keys.filter(key => cacheRows.has(key)).map(key => [key, cacheRows.get(key)])),
    write: async (key, value) => cacheRows.set(key, value) };
  const get = async url => {
    active++; maximum = Math.max(maximum, active); calls.push(url);
    await new Promise(resolve => setImmediate(resolve));
    const id = new URL(url).searchParams.get('event'), ref = job.references.find(row => row.id === id);
    active--; return summary(id, ref.date);
  };
  const first = await advanceNBASimulation(game, job, get, cache, roster, now, neutral());
  assert.equal(first.result.status, 'collecting'); assert.equal(calls.length, 12); assert.ok(maximum <= 3);
  const second = await advanceNBASimulation(game, job, get, cache, roster, now, neutral());
  assert.equal(second.result.status, 'ready'); assert.equal(calls.length, 24); assert.equal(second.remaining, 0);
  await advanceNBASimulation(game, job, get, cache, roster, now, neutral());
  assert.equal(calls.length, 24, 'Verified historical evidence is reused');
});
test('NBA archive reads never backfill after tipoff and preserve existing pregame forecasts during refresh failures', async () => {
  const forecast = simulateNBAGame(game, observations(), roster, now);
  let saved = { payload: forecast, event_start: game.date }, waiting = { last_error: 'Provider unavailable' }, queued = 0;
  const admin = { from(table) { const result = { data: table === 'gamewire_nba_forecasts' ? saved : waiting, error: null };
    const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => result }; return query;
  }, rpc: async () => { queued++; return { error: null }; } };
  const result = await loadNBAGameSimulation(admin, scope, async () => true, now);
  assert.equal(result.status, 'ready'); assert.match(result.warnings.at(-1), /Refresh delayed/);
  const locked = await loadNBAGameSimulation(admin, scope, async () => { throw new Error('Must not claim'); }, Date.parse(game.date) + 1);
  assert.equal(locked.refreshing, false); assert.equal(queued, 1);
  saved = null;
  await assert.rejects(loadNBAGameSimulation(admin, scope, async () => true, Date.parse(game.date) + 1), /never generated after tipoff/);
});
test('NBA discovery queues only unique upcoming regular-season/playoff games inside fourteen days', async () => {
  let queued;
  const event = (id, offset, phase = 2, state = 'pre') => ({ id, date: new Date(now + offset).toISOString(),
    season: { type: phase }, competitions: [{ status: { type: { state } } }] });
  const admin = { rpc: async (_name, args) => { queued = args.games; return { error: null }; } };
  const requested = [];
  await warmNBAGameSimulations(admin, async url => { requested.push(url); assert.match(url, /dates=\d{8}&limit=1000$/); return { events: [
    event('1', 86400000), event('2', 86400000, 3), event('3', -1), event('4', 15 * 86400000),
    event('5', 86400000, 1), event('6', 86400000, 2, 'in'),
  ] }; }, now);
  assert.deepEqual(queued.map(row => row.event_id), ['1', '2']);
  assert.equal(requested.length, 16);
});
test('NBA final settlement archives actual player zeroes, leaves DNP missing and rejects wrong matchups without mutating forecasts', async () => {
  const date = new Date(now - 86400000).toISOString(), forecast = simulateNBAGame(game, observations(), roster, now);
  const pending = { event_id: game.id, event_start: date, payload: forecast }, writes = [];
  const fluent = result => new Proxy({ then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }, {
    get(target, key) { return key in target ? target[key] : () => fluent(result); },
  });
  const admin = { from() { return {
    select: () => fluent({ data: [pending], error: null }),
    update: value => { writes.push(value); return fluent({ error: null }); },
  }; } };
  const raw = summary(game.id, date);
  raw.boxscore.players[0].statistics[0].athletes[0].stats = ['20', '0', '0', '0'];
  raw.boxscore.players[0].statistics[0].athletes[1].didNotPlay = true;
  assert.equal((await settleNBAGameSimulations(admin, async () => raw, now)).settled, 1);
  assert.equal(writes[0].actuals.home.players['110'].points, 0);
  assert.equal(writes[0].actuals.home.players['111'], undefined);
  assert.deepEqual(Object.keys(writes[0]).sort(), ['actuals', 'settled_at']);
  raw.header.competitions[0].date = new Date(now - 2 * 86400000).toISOString();
  const failed = await settleNBAGameSimulations(admin, async () => raw, now);
  assert.equal(failed.settled, 0); assert.match(failed.issues[0], /does not match/);
});
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
test('NBA device forecasts restore on cold start, preserve newer ready data and report storage and malformed accuracy failures', async () => {
  const saved = new Map(), frontendGame = { ...game, eventId: game.id };
  let response = simulateNBAGame(game, observations(), roster, now), failStorage = false;
  const initial = response;
  const runtime = () => {
    const context = vm.createContext({ exports: {}, AbortController, Error, Response, setTimeout, clearTimeout, console,
      require(name) {
        if (name.includes('supabaseClient')) return { supabase: {
          auth: { getSession: async () => ({ data: { session: { access_token: 'fixture', user: { is_anonymous: false } } }, error: null }) },
          functions: { invoke: async () => ({ data: response, error: null }) },
        } };
        if (name.includes('draftStorage')) return { createDraftStorage: name => {
          assert.equal(name, 'gamewire-nba-simulations');
          return { load: async key => saved.get(key), save: async (key, value) => {
            if (failStorage) throw new Error('Storage quota');
            saved.set(key, structuredClone(value));
          } };
        } };
        return nbaModel;
      } });
    vm.runInContext(compile('../src/services/nbaSimulation.ts'), context);
    return context.exports;
  };
  const api = runtime(), signal = new AbortController().signal;
  assert.equal((await api.loadNBASimulation(frontendGame, signal)).status, 'ready');
  assert.deepEqual(await runtime().readSavedNBASimulation(frontendGame), initial);
  const newer = structuredClone(initial); newer.forecastAt = new Date(now + 60000).toISOString(); response = newer;
  await api.loadNBASimulation(frontendGame, signal);
  response = initial;
  assert.equal((await api.loadNBASimulation(frontendGame, signal)).forecastAt, newer.forecastAt);
  response = { games: [{ eventId: game.id, kickoff: game.date, forecast: initial, actuals: { home: null }, settledAt: new Date(now).toISOString() }], issues: [] };
  await assert.rejects(api.loadNBAAccuracy([frontendGame], signal), /not been verified/);
  response = initial; failStorage = true;
  assert.ok((await api.loadNBASimulation(frontendGame, signal)).warnings.some(warning => warning.includes('Device storage')));
});
test('NBA graphics reuse the Best Bet renderer and preserve every supported row without player likenesses', async () => {
  let rendered;
  const context = vm.createContext({ exports: {}, Error, Blob, Math,
    require: () => ({ renderBetGraphic: async options => { rendered = options; return new Blob(['png']); } }) });
  vm.runInContext(compile('../src/services/nbaSimulationGraphic.ts'), context);
  await context.exports.renderNBASimulationGraphic('NBA results', 'Verified archived forecasts', Array.from({ length: 40 }, (_, i) =>
    ({ title: `Player ${i}`, detail: 'Personal game evidence', line: '20 PTS / 10 REB / 5 AST', note: '35 projected PRA' })));
  assert.equal(rendered.typography, 'brand');
  assert.equal(rendered.rows.length, 40);
  assert.equal(rendered.rows[39].name, 'Player 39');
  assert.equal(rendered.rows[39].note, '35 projected PRA');
  assert.ok(rendered.rows.every(row => !row.photo && !row.odds && !row.result));
  await assert.rejects(context.exports.renderNBASimulationGraphic('Empty', 'Slate', []), /No verified/);
});
test('NBA database leases, pregame locks, late availability revisions, immutable finals and RLS are enforced', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const sql = readFileSync(new URL('../supabase/nba-game-simulations.sql', import.meta.url), 'utf8');
    await db.exec(sql.slice(0, sql.indexOf('select cron.unschedule')) + '\ncommit;');
    const kickoff = new Date(Date.now() + 20 * 60000).toISOString(), token = '00000000-0000-4000-8000-000000000001';
    await db.query('select public.gamewire_queue_nba_simulations($1::jsonb)', [JSON.stringify([{ event_id: game.id, event_start: kickoff }])]);
    assert.equal((await db.query('select public.gamewire_claim_nba_simulation($1,$2::uuid) as claimed', [game.id, token])).rows[0].claimed, true);
    assert.equal((await db.query('select public.gamewire_claim_nba_simulation($1,$2::uuid) as claimed', [game.id, token])).rows[0].claimed, false);
    const forecast = simulateNBAGame({ ...game, date: kickoff }, observations(), roster, now);
    const save = payload => db.query('select public.gamewire_save_nba_simulation($1::uuid,$2::jsonb) as payload', [token, JSON.stringify(payload)]);
    const first = (await save(forecast)).rows[0].payload;
    assert.ok(first.lockedAt); assert.ok(Date.parse(first.forecastAt) > now);
    const changed = structuredClone(first); changed.home.score.mean = 999;
    assert.equal((await save(changed)).rows[0].payload.home.score.mean, first.home.score.mean, 'Routine refreshes cannot alter locked forecasts');
    changed.availabilityKey += '|confirmed-out';
    assert.equal((await save(changed)).rows[0].payload.home.score.mean, 999, 'Verified availability changes may revise before tipoff');
    assert.equal((await db.query('select count(*)::int as n from public.gamewire_nba_simulation_revisions')).rows[0].n, 2);
    await db.exec("update public.gamewire_nba_forecasts set event_start=clock_timestamp()-interval '1 minute',forecast_at=clock_timestamp()-interval '2 minutes'");
    await assert.rejects(db.exec("update public.gamewire_nba_forecasts set payload='{}'::jsonb"), /immutable after tipoff/);
    await db.exec("update public.gamewire_nba_forecasts set actuals='{}'::jsonb,settled_at=clock_timestamp()");
    await db.exec('set role anon');
    await assert.rejects(db.exec('select * from public.gamewire_nba_forecasts'), /permission denied/);
    await db.exec('reset role');
    assert.match(sql, /gamewire-warm-nba-simulations','\*\/5/);
    assert.match(sql, /gamewire-dispatch-nba-simulations','\* \* \* \* \*'/);
  } finally { await db.close(); }
});
