import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { nflSimulationVersion, readNFLGameSimulation, simulateNFLGame, simulationBox, simulationGame, simulationObservations, simulationPlayerLogs, simulationPlayerSeasons, simulationSchedule } from '../supabase/functions/_shared/nflSimulation.ts';
import { advanceSimulation } from '../supabase/functions/_shared/nflSimulationSources.ts';
import { loadNFLGameSimulation, warmNFLGameSimulations } from '../supabase/functions/_shared/nflSimulationBackend.ts';

const now = Date.parse('2026-11-05T18:00:00Z');
const game = { id: '90000', date: '2026-11-15T18:00:00Z', season: 2026, seasonType: 2,
  home: { id: '1', name: 'Home Team', abbr: 'HOM' }, away: { id: '2', name: 'Away Team', abbr: 'AWY' } };
const date = i => new Date(now - (i + 1) * 7 * 86400000).toISOString();
const partial = (passingAttempts, completions, passingYards, rushingAttempts, rushingYards, receptions, receivingYards) =>
  Object.fromEntries(Object.entries({ passingAttempts, completions, passingYards, rushingAttempts, rushingYards, receptions, receivingYards }).filter(([, n]) => n !== undefined));
function side(id, home, i = 0, scale = 1) {
  const passingYards = Math.round((220 + i % 7 * 18) * scale), completions = 20 + i % 5, rushingYards = 100 + i % 6 * 8;
  return { id, home, points: 17 + i % 7 * 3, passingAttempts: 32 + i % 5, completions, passingYards,
    rushingAttempts: 28, rushingYards, receptions: completions, receivingYards: passingYards, players: {} };
}
function fixture({ injured = false, weakDefense = 1, qbGames = 30, receiverYards = 100 } = {}) {
  const players = ['1', '2'].flatMap(teamId => [
    { id: `${teamId}1`, name: `Quarterback ${teamId}`, teamId, position: 'QB', status: 'Active', excluded: false, uncertain: false, role: 'Depth-chart rank 1; not confirmed' },
    { id: `${teamId}2`, name: `Backup ${teamId}`, teamId, position: 'QB', status: 'Questionable', excluded: false, uncertain: true, role: 'Depth-chart rank 2; not confirmed' },
    { id: `${teamId}3`, name: `Runner ${teamId}`, teamId, position: 'RB', status: 'Active', excluded: false, uncertain: false, role: 'Usage ranked' },
    { id: `${teamId}4`, name: `Receiver ${teamId}`, teamId, position: 'WR', status: injured && teamId === '1' ? 'Out' : 'Active', excluded: injured && teamId === '1', uncertain: injured && teamId === '1', role: 'Usage ranked' },
    { id: `${teamId}5`, name: `Tight End ${teamId}`, teamId, position: 'TE', status: 'Active', excluded: false, uncertain: false, role: 'Usage ranked' },
  ]);
  const home = Array.from({ length: 100 }, (_, i) => ({ id: String(10000 + i), date: date(i), season: 2026 - Math.floor(i / 18), seasonType: i % 18 === 0 ? 3 : 2,
    teams: [side('1', i % 2 === 0, i), side('3', i % 2 !== 0, i, 1)] }));
  const away = Array.from({ length: 100 }, (_, i) => ({ id: String(20000 + i), date: date(i), season: 2026 - Math.floor(i / 18), seasonType: 2,
    teams: [side('2', i % 2 === 0, i), side('4', i % 2 !== 0, i, weakDefense)] }));
  const observations = new Map(players.map(p => [p.id, Array.from({ length: p.position === 'QB' ? qbGames : 30 }, (_, i) => {
    const teamId = i % 2 === 0 ? p.teamId : '9', team = side(teamId, true, i);
    const player = p.position === 'QB'
      ? partial(35, p.id.endsWith('2') ? 29 : 22, p.id.endsWith('2') ? 350 : 240, 3, 15)
      : p.position === 'RB' ? partial(undefined, undefined, undefined, 18, 90 + i % 4 * 5, 3, 24)
        : p.position === 'WR' ? partial(undefined, undefined, undefined, undefined, undefined, 8, receiverYards + i % 4 * 10)
          : partial(undefined, undefined, undefined, undefined, undefined, 4, 42 + i % 3 * 5);
    return { eventId: String(30000 + Number(p.id) * 100 + i), date: date(i), teamId, opponentId: i % 3 === 0 ? p.teamId === '1' ? '2' : '1' : '8', player, team };
  })]));
  return { history: { home, away }, players, observations };
}
function rawBox(box) {
  return { header: { id: box.id, season: { year: box.season, type: box.seasonType }, competitions: [{
    date: box.date, status: { type: { state: 'post', completed: true } }, competitors: box.teams.map(team => ({ homeAway: team.home ? 'home' : 'away', team: { id: team.id }, score: String(team.points) })),
  }] }, boxscore: { players: box.teams.map(team => ({ team: { id: team.id }, statistics: [
    { name: 'passing', keys: ['completions/passingAttempts', 'passingYards'], athletes: [{ athlete: { id: `${team.id}1` }, stats: [`${team.completions}/${team.passingAttempts}`, String(team.passingYards)] }] },
    { name: 'rushing', keys: ['rushingAttempts', 'rushingYards'], athletes: [{ athlete: { id: `${team.id}3` }, stats: [String(team.rushingAttempts), String(team.rushingYards)] }] },
    { name: 'receiving', keys: ['receptions', 'receivingYards'], athletes: [{ athlete: { id: `${team.id}4` }, stats: [String(team.receptions), String(team.receivingYards)] }] },
  ] })) } };
}
function response(scenarios, overrides = {}) {
  return { status: 'ready', version: nflSimulationVersion, eventId: game.id, kickoff: game.date, checkedAt: new Date(now).toISOString(), forecastAt: new Date(now).toISOString(),
    stage: 'Simulation complete', progress: { completed: 200, total: 200 }, history: { home: 100, away: 100, target: 100 }, runs: 500, calibrated: false, warnings: [], injuries: [], scenarios, ...overrides };
}
test('Only verified upcoming regular-season/playoff games may be simulated', () => {
  const raw = rawBox(fixture().history.home[0]);
  raw.header.id = game.id; raw.header.season = { year: 2026, type: 3 };
  const competition = raw.header.competitions[0];
  competition.date = game.date; competition.status.type = { state: 'pre', completed: false };
  competition.competitors = [game.home, game.away].map((team, i) => ({ homeAway: i ? 'away' : 'home', team: { ...team, displayName: team.name, abbreviation: team.abbr } }));
  assert.equal(simulationGame(raw, game.id, now).seasonType, 3);
  assert.throws(() => simulationGame(raw, '1234', now), /upcoming/);
  assert.throws(() => simulationGame(raw, game.id, Date.parse(game.date)), /upcoming/);
  raw.header.season.type = 1;
  assert.throws(() => simulationGame(raw, game.id, now), /upcoming/);
});
test('History uses requestedSeason, postseason, deduplication and strict pre-forecast cutoff', () => {
  const f = fixture(), box = f.history.home[0], raw = rawBox(box);
  const event = { id: box.id, date: box.date, competitions: raw.header.competitions };
  const schedule = { team: { id: '1' }, season: { year: 2026, type: 2 }, requestedSeason: { year: 2021, type: 3 }, events: [event] };
  const refs = simulationSchedule(schedule, '1', 2021, 3, now);
  assert.equal(refs.length, 1); assert.equal(refs[0].seasonType, 3);
  assert.equal(simulationSchedule(schedule, '1', 2021, 3, Date.parse(box.date)).length, 0);
  assert.throws(() => simulationSchedule(schedule, '2', 2021, 3, now), /different/);
  assert.throws(() => simulationSchedule(schedule, '1', 2021, 2, now), /different/);
  assert.deepEqual(simulationSchedule({ team: { id: '1' }, season: { year: 2026, type: 2 }, events: [] }, '1', 2025, 3, now), []);
  assert.throws(() => simulationSchedule({ ...schedule, events: [] }, '1', 2022, 3, now), /different/);
  schedule.events[0].competitions[0].competitors[0].score = '';
  assert.throws(() => simulationSchedule(schedule, '1', 2021, 3, now), /score/);
});
test('Cross-team regular/playoff player logs retain historical identities and reject missing or wrong-season evidence', () => {
  const raw = { names: ['passingAttempts'], events: {
    '100': { gameDate: date(0), team: { id: '9' }, opponent: { id: '2' } },
    '101': { gameDate: game.date, team: { id: '1' }, opponent: { id: '2' } },
    '102': { gameDate: date(1), team: { id: '7' }, opponent: { id: '3' } },
  }, seasonTypes: [
    { displayName: '2026 Regular Season', categories: [{ events: [{ eventId: '100', stats: ['32'] }, { eventId: '101', stats: ['30'] }] }] },
    { displayName: '2026 Postseason', categories: [{ events: [{ eventId: '102', stats: ['5'] }] }] },
  ] };
  const refs = simulationPlayerLogs(raw, 2026, now);
  assert.deepEqual(refs.map(row => row.teamId), ['9', '7']);
  assert.equal(refs[1].seasonType, 3);
  assert.equal(simulationPlayerLogs(raw, 2026, now, true).length, 1);
  raw.events['100'].homeTeamId = '1'; raw.events['100'].awayTeamId = '2';
  assert.equal(simulationPlayerLogs(raw, 2026, now)[0].teamId, '1', 'Actual matchup sides override stale current-team metadata for transfers');
  delete raw.events['100'].homeTeamId; delete raw.events['100'].awayTeamId;
  assert.throws(() => simulationPlayerLogs(raw, 2025, now), /different/);
  delete raw.events['100'].team;
  assert.throws(() => simulationPlayerLogs(raw, 2026, now), /identities/);
});
test('Completed box parser handles composite passing columns and enforces team/player accounting', () => {
  const box = fixture().history.home[0], raw = rawBox(box);
  const parsed = simulationBox(raw, box.id, now);
  assert.equal(parsed.teams[0].passingAttempts, box.teams[0].passingAttempts);
  assert.equal(parsed.teams[0].passingYards, parsed.teams[0].receivingYards);
  raw.boxscore.players[0].statistics[2].athletes[0].stats[0] = '99';
  assert.throws(() => simulationBox(raw, box.id, now), /reconcile/);
  assert.throws(() => simulationBox(rawBox(box), box.id, Date.parse(box.date)), /completed/);
  rawBox(box).header.season.type = 1;
  const preseason = rawBox(box); preseason.header.season.type = 1;
  assert.throws(() => simulationBox(preseason, box.id, now), /completed/);
});
test('ESPN filter-only pre-career responses stop backfill rather than requesting nonexistent seasons forever', () => {
  const raw = { filters: [{ name: 'season', value: '2021', options: [{ value: '2026' }, { value: '2025' }, { value: '2024' }] }] };
  assert.deepEqual(simulationPlayerLogs(raw, 2021, now, true), []);
  assert.deepEqual(simulationPlayerSeasons(raw, 2021), [2026, 2025, 2024]);
  assert.throws(() => simulationPlayerLogs(raw, 2022, now), /different/);
  assert.throws(() => simulationPlayerLogs({}, 2021, now), /unavailable/);
});
test('Player appearances are verified against the exact historical team and box, including transfers', () => {
  const box = simulationBox(rawBox(fixture().history.home[0]), '10000', now);
  const player = { id: '11', teamId: '2', position: 'QB' };
  const ref = { id: box.id, date: box.date, season: box.season, seasonType: box.seasonType, teamId: '1', opponentId: '3' };
  const rows = simulationObservations(player, [ref, ref], new Map([[box.id, box]]), now);
  assert.equal(rows.length, 1); assert.equal(rows[0].teamId, '1');
  assert.throws(() => simulationObservations(player, [{ ...ref, teamId: '3' }], new Map([[box.id, box]]), now), /historical team/);
  assert.throws(() => simulationObservations(player, [{ ...ref, season: 2020 }], new Map([[box.id, box]]), now), /matched/);
  const issues = [];
  assert.deepEqual(simulationObservations(player, [{ ...ref, teamId: '3' }], new Map([[box.id, box]]), now, issue => issues.push(issue)), []);
  assert.match(issues[0], /no missing production/);
});
test('Exactly 100 games, no duplicates, preseason or target-game leakage', () => {
  const f = fixture();
  assert.throws(() => simulateNFLGame(game, { ...f.history, home: f.history.home.slice(1) }, f.players, f.observations, 500), /100/);
  const duplicate = [...f.history.home]; duplicate[1] = duplicate[0];
  assert.throws(() => simulateNFLGame(game, { ...f.history, home: duplicate }, f.players, f.observations, 500), /unique/);
  const leaked = [...f.history.home]; leaked[0] = { ...leaked[0], date: game.date };
  assert.throws(() => simulateNFLGame(game, { ...f.history, home: leaked }, f.players, f.observations, 500), /pre-kickoff/);
});
test('Joint draws conserve gross passing/receiving yards, catches and rushing totals across QB scenarios', () => {
  const f = fixture(), scenarios = simulateNFLGame(game, f.history, f.players, f.observations, 500);
  assert.equal(scenarios.length, 4);
  for (const scenario of scenarios) {
    assert.equal(scenario.issue, null);
    assert.ok(Math.abs(scenario.home.winProbability + scenario.away.winProbability + scenario.tieProbability - 1) < 1e-8);
    for (const team of [scenario.home, scenario.away]) {
      const qb = team.players.find(p => p.position === 'QB'), sum = key => team.players.reduce((n, p) => n + (p.stats[key]?.mean ?? 0), 0);
      assert.ok(Math.abs(qb.stats.passingYards.mean - sum('receivingYards') - team.totals.otherReceivingYards.mean) < .4);
      assert.ok(Math.abs(qb.stats.completions.mean - sum('receptions') - team.totals.otherReceptions.mean) < .4);
      assert.ok(Math.abs(team.totals.rushingYards.mean - sum('rushingYards') - team.totals.otherRushingYards.mean) < .4);
      assert.ok(team.score.p10 <= team.score.median && team.score.median <= team.score.p90);
      assert.ok(team.players.some(p => p.priorTeams.includes('9')));
    }
  }
  assert.deepEqual(simulateNFLGame(game, f.history, f.players, f.observations, 500), scenarios);
  assert.equal(readNFLGameSimulation(response(scenarios), game.id, game.date, { home: '1', away: '2' }).status, 'ready');
});
test('Quarterback production, individual production and defense change the same simulated score/stat outcomes', () => {
  const base = fixture(), weak = fixture({ weakDefense: 1.5 }), betterWR = fixture({ receiverYards: 180 });
  const first = simulateNFLGame(game, base.history, base.players, base.observations, 500);
  const adjusted = simulateNFLGame(game, weak.history, weak.players, weak.observations, 500);
  const better = simulateNFLGame(game, betterWR.history, betterWR.players, betterWR.observations, 500);
  assert.ok(first[2].home.score.mean > first[0].home.score.mean, 'Different QB completion/production changes team scoring');
  assert.ok(adjusted[0].home.totals.passingYards.mean > first[0].home.totals.passingYards.mean);
  assert.ok(better[0].home.score.mean > first[0].home.score.mean);
  assert.ok(better[0].home.players.find(p => p.position === 'WR').stats.receivingYards.mean > first[0].home.players.find(p => p.position === 'WR').stats.receivingYards.mean);
});
test('Reported out players are excluded; insufficient QB/player/market evidence remains unavailable, not fake zeros', () => {
  const f = fixture({ injured: true, qbGames: 7 }), missing = simulateNFLGame(game, f.history, f.players, f.observations, 500);
  assert.ok(missing.every(row => row.home === null && /eight/.test(row.issue)));
  const injured = fixture({ injured: true });
  injured.observations.set('13', injured.observations.get('13').slice(0, 7));
  const output = simulateNFLGame(game, injured.history, injured.players, injured.observations, 500)[0].home;
  assert.deepEqual(output.players.find(p => p.id === '14').stats, {});
  assert.match(output.players.find(p => p.id === '14').issue, /Excluded/);
  assert.deepEqual(output.players.find(p => p.id === '13').stats, {});
  const sparse = fixture();
  sparse.observations.get('13').forEach(row => { delete row.player.receptions; delete row.player.receivingYards; });
  const runner = simulateNFLGame(game, sparse.history, sparse.players, sparse.observations, 500)[0].home.players.find(p => p.id === '13');
  assert.ok(runner.stats.rushingYards); assert.equal(runner.stats.receptions, undefined);
});
test('Response validation rejects forged IDs, calibrated claims, partial histories, locked forecasts and invalid probabilities', () => {
  const f = fixture(), valid = response(simulateNFLGame(game, f.history, f.players, f.observations, 500));
  const parse = value => readNFLGameSimulation(value, game.id, game.date, { home: '1', away: '2' });
  for (const invalid of [{ ...valid, eventId: '99' }, { ...valid, calibrated: true }, { ...valid, history: { home: 99, away: 100, target: 100 } },
    { ...valid, forecastAt: game.date }, { ...valid, version: 'other-model' }]) assert.throws(() => parse(invalid), /invalid/);
  const probabilities = structuredClone(valid); probabilities.scenarios[0].home.winProbability = 1.1;
  assert.throws(() => parse(probabilities), /invalid/);
});
test('Backfill is bounded, persistent and resumeable; failed boxes cannot masquerade as 100-game coverage', async () => {
  const f = fixture(), references = side => f.history[side].map(box => ({ id: box.id, date: box.date, season: box.season, seasonType: box.seasonType,
    teamId: side === 'home' ? '1' : '2', opponentId: side === 'home' ? '3' : '4' }));
  const job = { version: nflSimulationVersion, createdAt: new Date(now).toISOString(), history: { home: references('home'), away: references('away') },
    rosterPlayers: f.players, players: null, injuries: [], warnings: [], logs: {} };
  const saved = new Map(), cache = { readMany: async keys => new Map(keys.filter(key => saved.has(key)).map(key => [key, saved.get(key)])), write: async (key, value) => saved.set(key, value) };
  const boxes = new Map([...f.history.home, ...f.history.away].map(box => [box.id, box]));
  let calls = 0;
  const get = async url => { calls++; return rawBox(boxes.get(new URL(url).searchParams.get('event'))); };
  const first = await advanceSimulation(game, job, cache, get, now);
  assert.equal(first.status, 'collecting'); assert.equal(calls, 36); assert.equal(first.history.home + first.history.away, 36);
  const second = await advanceSimulation(game, job, cache, get, now);
  assert.equal(calls, 72); assert.equal(second.progress.completed, 72);
  const failing = await advanceSimulation(game, job, cache, async () => { throw new Error('Feed issue'); }, now);
  assert.equal(failing.status, 'collecting'); assert.equal(failing.progress.completed, 72); assert.equal(failing.scenarios.length, 0);
  assert.ok(failing.warnings.some(warning => warning.includes('Feed issue')));
  assert.equal(saved.size, 72);
});
test('SQL requires leases, pre-kickoff immutable forecasts and service-role-only storage; warm cron is configured', () => {
  const sql = readFileSync(new URL('../supabase/nfl-game-simulations.sql', import.meta.url), 'utf8');
  assert.match(sql, /lease_token=target_token and lease_until>clock_timestamp/);
  assert.match(sql, /started <= recorded/); assert.match(sql, /saved\.event_start <= recorded/);
  assert.match(sql, /old\.event_start <= clock_timestamp/);
  assert.match(sql, /revoke all on public\.gamewire_simulation_jobs,public\.gamewire_game_forecasts from public,anon,authenticated/);
  assert.match(sql, /"action":"warm-simulations"/);
});
test('The authenticated simulation action rejects malformed event IDs before any sports fetch', async () => {
  const code = ts.transpileModule(readFileSync(new URL('../supabase/functions/gamewire-bot/index.ts', import.meta.url), 'utf8')
    .replace(/if \(import\.meta\.main\) Deno\.serve[^;]+;/, ''), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let fetched = false;
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'registered', is_anonymous: false } } }) } };
  const context = vm.createContext({ exports: {}, Response, Request, Error, console, require(name) {
    if (name.startsWith('npm:')) return { createClient: () => client };
    if (name.endsWith('/gamewaire.ts')) return { object: v => v && typeof v === 'object' ? v : {}, text: v => typeof v === 'string' ? v : '' };
    return {};
  } });
  vm.runInContext(code, context);
  const env = { get: name => ({ SUPABASE_URL: 'https://test', SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test' })[name] };
  const send = async (body, headers = { Authorization: 'Bearer test' }) => context.exports.handleGamewireBot(
    new Request('https://test', { method: 'POST', headers, body: JSON.stringify(body) }), env, async () => { fetched = true; throw new Error('Unexpected fetch'); });
  assert.equal((await send({ action: 'simulation', eventId: '../other' })).status, 400);
  assert.equal((await send({ action: 'simulation', eventId: '90000' }, {})).status, 401);
  assert.equal(fetched, false);
});

function backendFixture({ ready = false, locked = false, archiveFailure = false, startsDuringRun = false } = {}) {
  const f = fixture(), kickoff = new Date(Date.now() + 86400000).toISOString(), initial = response(simulateNFLGame(game, f.history, f.players, f.observations, 500), { kickoff, forecastAt: new Date().toISOString() });
  const refs = boxes => boxes.map(box => ({ id: box.id, date: box.date, season: box.season, seasonType: box.seasonType, teamId: box.teams[0].id, opponentId: box.teams[1].id }));
  const job = { version: nflSimulationVersion, createdAt: new Date().toISOString(), history: { home: refs(f.history.home), away: refs(f.history.away) },
    rosterPlayers: f.players, players: f.players, warnings: [], injuries: [], logs: {} };
  const cache = new Map([...f.history.home, ...f.history.away].map(box => [`nfl:simulation:box:v1:${box.id}`, box]));
  for (const p of f.players) {
    const observations = f.observations.get(p.id), references = observations.map(row => {
      const own = { ...row.team, players: { [p.id]: row.player } }, box = { id: row.eventId, date: row.date, season: 2026, seasonType: 2, teams: [own, side(row.opponentId, false)] };
      cache.set(`nfl:simulation:box:v1:${box.id}`, box);
      return { id: box.id, date: box.date, season: 2026, seasonType: 2, teamId: own.id, opponentId: row.opponentId };
    });
    job.logs[p.id] = { done: true, season: 2026, refs: references };
  }
  const calls = [], updates = [];
  const admin = {
    from(table) {
      let keys = [], update;
      const builder = {
        select: () => builder, eq: () => builder, gt: () => builder, in: (_field, values) => { keys = values; return builder; },
        update: value => { update = value; return builder; },
        maybeSingle: async () => ({ data: table === 'gamewire_game_forecasts' ? ready ? { payload: initial, event_start: kickoff } : null
          : { payload: job, response: response([], { status: 'collecting', forecastAt: null }) }, error: null }),
        then: resolve => {
          if (update) updates.push(update);
          return Promise.resolve({ data: table === 'gamewire_bot_cache' ? keys.filter(key => cache.has(key)).map(key => ({ cache_key: key, payload: cache.get(key) })) : [{ event_id: game.id }], error: null }).then(resolve);
        },
        upsert: async () => ({ error: null }),
      };
      return builder;
    },
    rpc: async (name, args) => { calls.push(name); return name === 'gamewire_claim_simulation' ? { data: !locked, error: null }
      : { data: { ...args.forecast.payload, forecastAt: new Date().toISOString() }, error: archiveFailure ? { message: 'Write failed' } : null }; },
  };
  let fetched = 0;
  const get = async () => {
    fetched++;
    const raw = rawBox(f.history.home[0]), competition = raw.header.competitions[0];
    raw.header.id = game.id; raw.header.season = { year: 2026, type: 2 }; competition.date = kickoff;
    competition.status.type = { state: startsDuringRun && fetched > 1 ? 'in' : 'pre', completed: false };
    competition.competitors = [game.home, game.away].map((team, i) => ({ homeAway: i ? 'away' : 'home', team: { ...team, displayName: team.name, abbreviation: team.abbr } }));
    return raw;
  };
  return { admin, get, calls, updates };
}
test('Fresh shared forecasts bypass quota; concurrent jobs return collecting without acquiring another lease', async () => {
  const fresh = backendFixture({ ready: true });
  assert.equal((await loadNFLGameSimulation(fresh.admin, game.id, fresh.get, async () => { throw new Error('Must not charge a cached forecast'); })).status, 'ready');
  assert.equal(fresh.calls.length, 0);
  const locked = backendFixture({ locked: true });
  assert.equal((await loadNFLGameSimulation(locked.admin, game.id, locked.get, async () => { throw new Error('Must not charge locked work'); })).status, 'collecting');
  assert.deepEqual(locked.calls, ['gamewire_claim_simulation']);
});
test('Warm-up uses supported weekly ESPN scoreboards, validates metadata and filters to the next 14 days', async () => {
  const api = backendFixture({ ready: true }), calls = [], clock = Date.now();
  const original = api.admin.from;
  let eventIds;
  api.admin.from = table => {
    if (table !== 'gamewire_simulation_jobs') return original(table);
    const builder = { select: () => builder, in: (_column, ids) => { eventIds = ids; return builder; },
      then: resolve => Promise.resolve({ data: [], error: null }).then(resolve) };
    return builder;
  };
  const get = async url => {
    if (url.includes('/summary')) return api.get(url);
    calls.push(url);
    const query = new URL(url).searchParams, week = Number(query.get('week') || 9);
    const event = { id: week === 9 ? game.id : String(week), date: new Date(clock + (week === 9 ? 1 : week === 10 ? 8 : 15) * 86400000).toISOString(),
      competitions: [{ status: { type: { state: 'pre' } } }] };
    return { season: { year: 2026, type: 2 }, week: { number: week }, events: [event] };
  };
  const warmed = await warmNFLGameSimulations(api.admin, get, clock);
  assert.equal(warmed.eventId, game.id);
  assert.deepEqual(eventIds, [game.id, '10']);
  assert.equal(calls.length, 4);
  assert.ok(calls.slice(1).every(url => new URL(url).searchParams.get('dates') === '2026'));
  assert.ok(calls.every(url => !/dates=\d{8}-/.test(url)));
  await assert.rejects(warmNFLGameSimulations(api.admin, async url => {
    const board = await get(url);
    if (url.includes('week=10')) board.week.number = 9;
    return board;
  }, clock), /different NFL/);
});
test('Completed cached evidence is archived and progress saved; quota/write/kickoff failures release work and surface errors', async () => {
  const successful = backendFixture();
  const result = await loadNFLGameSimulation(successful.admin, game.id, successful.get, async () => true);
  assert.equal(result.status, 'ready'); assert.equal(result.history.home, 100);
  assert.ok(successful.calls.includes('gamewire_save_game_simulation'));
  assert.ok(successful.updates.some(update => update.response?.status === 'ready'));
  for (const [options, claim, pattern] of [[{}, async () => false, /limit/], [{ archiveFailure: true }, async () => true, /archive/], [{ startsDuringRun: true }, async () => true, /upcoming/]]) {
    const api = backendFixture(options);
    await assert.rejects(loadNFLGameSimulation(api.admin, game.id, api.get, claim), pattern);
    assert.ok(api.updates.some(update => update.lease_token === null));
    assert.ok(!api.updates.some(update => update.response?.status === 'ready'));
  }
});
function simulationMarkup(data, error = '', scenarioId = '') {
  const code = ts.transpileModule(readFileSync(new URL('../src/NFLGameSimulation.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const state = [data, data?.status === 'ready' ? data : null, error, 0, scenarioId, false, false];
  let i = 0;
  const context = vm.createContext({ exports: {}, Date, console, require(name) {
    if (name === 'react') return { useState: () => [state[i++], () => {}], useEffect() {} };
    if (name === 'react/jsx-runtime') return jsxRuntime;
    return {};
  } });
  vm.runInContext(code, context);
  return renderToStaticMarkup(jsxRuntime.jsx(context.exports.default, { game: { ...game, eventId: game.id } }));
}
test('Simulation UI renders scenario selection, ranges, transfer coverage, errors and retained forecasts without photos', () => {
  const f = fixture(), data = response(simulateNFLGame(game, f.history, f.players, f.observations, 500));
  const html = simulationMarkup(data, 'Feed issue');
  assert.match(html, /Quarterback scenario/); assert.match(html, /Includes prior teams/); assert.match(html, /10th/);
  assert.match(html, /Your last verified forecast remains below/); assert.match(html, /Feed issue/);
  assert.match(html, /overtime is not separately simulated/); assert.doesNotMatch(html, /<img/);
  assert.match(html, /role="region"/); assert.match(html, /scope="col"/);
  const unavailable = response([{ id: 'missing', label: 'Missing QB', quarterbacks: { home: 'Unknown', away: 'Unknown' }, home: null, away: null, issue: 'Insufficient evidence', tieProbability: null }], { status: 'unavailable' });
  assert.match(simulationMarkup(unavailable), /Insufficient evidence/);
  assert.match(simulationMarkup(data, '', data.scenarios[1].id), /Backup 2/);
});
function panelRuntime(load) {
  const code = ts.transpileModule(readFileSync(new URL('../src/NFLGameSimulation.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const state = [], effects = [], timers = new Map();
  let slot = 0, timerId = 0;
  const context = vm.createContext({ exports: {}, AbortController, Date, Error, console: { error() {} }, window: {
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id),
  }, require(name) {
    if (name === 'react') return {
      useState(initial) { const index = slot++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
      useEffect: effect => effects.push(effect),
    };
    if (name === 'react/jsx-runtime') return jsxRuntime;
    return { loadGameSimulation: load };
  } });
  vm.runInContext(code, context);
  const render = () => { slot = 0; effects.length = 0; context.exports.default({ game: { ...game, eventId: game.id } }); };
  render();
  return { state, effects, timers, render };
}
test('Runtime refresh errors retain the last verified forecast, while leaving aborts stale requests and polling', async () => {
  const f = fixture(), data = response(simulateNFLGame(game, f.history, f.players, f.observations, 500));
  let fail = false;
  const runtime = panelRuntime(async () => { if (fail) throw new Error('Offline feed'); return data; });
  const stopClock = runtime.effects[0](), stop = runtime.effects[1]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.state[1], data);
  fail = true; stop(); runtime.render();
  const stopRetry = runtime.effects[1]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.state[1], data); assert.match(runtime.state[2], /Offline feed/);
  stopRetry(); stopClock();
  let resolveRequest, signal;
  const delayed = panelRuntime((_game, s) => { signal = s; return new Promise(resolve => { resolveRequest = resolve; }); });
  const stopDelayedClock = delayed.effects[0](), stopDelayed = delayed.effects[1]();
  stopDelayed(); stopDelayedClock(); resolveRequest(data);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, true); assert.equal(delayed.state[1], null); assert.equal(delayed.timers.size, 0);
});
