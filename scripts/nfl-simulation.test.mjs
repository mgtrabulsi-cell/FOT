import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { legacyNFLSimulationVersion, previousNFLSimulationVersion, nflSimulationVersion, readNFLGameSimulation, roundedSimulationBox, simulateNFLGame, simulateNFLTeamScore, simulationBox, simulationGame, simulationObservations, simulationPlayerWeights, simulationPlayerLogs, simulationPlayerSeasons, simulationSchedule } from '../supabase/functions/_shared/nflSimulation.ts';
import { reconcileSimulationProjections, simulationAllowsMoneyline } from '../supabase/functions/_shared/nflSimulationAlignment.ts';
import { archivePlayerForecast } from '../supabase/functions/_shared/gamewireForecasts.ts';
import { scoreboardPicks } from '../supabase/functions/_shared/gamewaireScoreboard.ts';
import { advanceSimulation, prepareSimulation } from '../supabase/functions/_shared/nflSimulationSources.ts';
import { loadNFLGameSimulation, runNFLGameSimulation, savedNFLGameSimulation, warmNFLGameSimulations } from '../supabase/functions/_shared/nflSimulationBackend.ts';

const now = Date.parse('2026-11-05T18:00:00Z');
const game = { id: '90000', date: '2026-11-15T18:00:00Z', season: 2026, seasonType: 2,
  home: { id: '1', name: 'Home Team', abbr: 'HOM' }, away: { id: '2', name: 'Away Team', abbr: 'AWY' } };
const date = i => new Date(now - (i + 1) * 7 * 86400000).toISOString();
const partial = (passingAttempts, completions, passingYards, rushingAttempts, rushingYards, receptions, receivingYards) =>
  Object.fromEntries(Object.entries({ passingAttempts, completions, passingYards, passingTouchdowns: passingAttempts === undefined ? undefined : 2,
    rushingAttempts, rushingYards, rushingTouchdowns: rushingAttempts === undefined ? undefined : 1,
    receptions, receivingYards, receivingTouchdowns: receptions === undefined ? undefined : 1 }).filter(([, n]) => n !== undefined));
function side(id, home, i = 0, scale = 1) {
  const passingYards = Math.round((220 + i % 7 * 18) * scale), completions = 20 + i % 5, rushingYards = 100 + i % 6 * 8;
  return { id, home, points: 17 + i % 7 * 3, passingAttempts: 32 + i % 5, completions, passingYards,
    passingTouchdowns: 2, rushingAttempts: 28, rushingYards, rushingTouchdowns: 1, receptions: completions, receivingYards: passingYards, receivingTouchdowns: 2, players: {} };
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
    { name: 'passing', keys: ['completions/passingAttempts', 'passingYards', 'passingTouchdowns'], athletes: [{ athlete: { id: `${team.id}1` }, stats: [`${team.completions}/${team.passingAttempts}`, String(team.passingYards), String(team.passingTouchdowns)] }] },
    { name: 'rushing', keys: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'], athletes: [{ athlete: { id: `${team.id}3` }, stats: [String(team.rushingAttempts), String(team.rushingYards), String(team.rushingTouchdowns)] }] },
    { name: 'receiving', keys: ['receptions', 'receivingYards', 'receivingTouchdowns'], athletes: [{ athlete: { id: `${team.id}4` }, stats: [String(team.receptions), String(team.receivingYards), String(team.receivingTouchdowns)] }] },
  ] })) } };
}
function response(scenarios, overrides = {}) {
  return { status: 'ready', version: nflSimulationVersion, eventId: game.id, kickoff: game.date, checkedAt: new Date(now).toISOString(), forecastAt: new Date(now).toISOString(),
    stage: 'Simulation complete', evidenceMode: 'full', progress: { completed: 200, total: 200 }, history: { home: 100, away: 100, target: 100 }, runs: 500, calibrated: false, warnings: [], injuries: [], scenarios, ...overrides };
}
function scoreReferences(boxes) {
  return boxes.map(box => ({ id: box.id, date: box.date, season: box.season, seasonType: box.seasonType,
    teamId: box.teams[0].id, opponentId: box.teams[1].id,
    scores: { own: box.teams[0].points, opponent: box.teams[1].points, home: box.teams[0].home } }));
}
function simulationCache(values = new Map()) {
  return { readMany: async keys => new Map(keys.filter(key => values.has(key)).map(key => [key, values.get(key)])),
    write: async (key, value) => { values.set(key, value); } };
}
test('Verified lateral receiving touchdowns retain zero receptions and reconcile with team passing', () => {
  const f = fixture(), box = f.history.home[0], raw = rawBox(box);
  const receiving = raw.boxscore.players[0].statistics.find(group => group.name === 'receiving');
  receiving.athletes[0].stats = [String(box.teams[0].completions), String(box.teams[0].passingYards - 20), '1'];
  receiving.athletes.push({ athlete: { id: '15' }, stats: ['0', '20', '1'] });
  const parsed = simulationBox(raw, box.id, now), own = parsed.teams[0];
  assert.deepEqual(own.players['15'], { receptions: 0, receivingYards: 20, receivingTouchdowns: 1 });
  assert.equal(own.receptions, own.completions); assert.equal(own.receivingYards, own.passingYards);
  assert.equal(own.receivingTouchdowns, own.passingTouchdowns);
  const ref = scoreReferences([box])[0], player = f.players.find(player => player.id === '15');
  const observations = simulationObservations(player, [ref], new Map([[box.id, parsed]]), now);
  assert.equal(observations.length, 1); assert.equal(observations[0].player.receptions, 0);
  receiving.athletes[1].stats[2] = '-1';
  assert.throws(() => simulationBox(raw, box.id, now), /touchdown/);
  receiving.athletes[1].stats[2] = '2';
  assert.throws(() => simulationBox(raw, box.id, now), /reconcile/i);
});
test('Four verified QB appearances and eight team games support labeled limited projections', () => {
  const f = fixture({ qbGames: 4 }), history = { home: f.history.home.slice(0, 8), away: f.history.away.slice(0, 8) };
  const scenarios = simulateNFLGame(game, history, f.players, f.observations, 500);
  assert.ok(scenarios.every(scenario => scenario.home && scenario.away));
  assert.ok(scenarios[0].home.players.find(player => player.position === 'QB').limited);
  const limited = response(scenarios, { evidenceMode: 'limited', history: { home: 8, away: 8, target: 100 } });
  assert.equal(readNFLGameSimulation(limited, game.id, game.date, { home: '1', away: '2' }).evidenceMode, 'limited');
  assert.throws(() => readNFLGameSimulation({ ...limited, evidenceMode: 'full' }, game.id, game.date, { home: '1', away: '2' }), /invalid/);
  f.observations.forEach((rows, id) => { if (id.endsWith('1') || id.endsWith('2')) rows.forEach(row => { row.player.passingAttempts = 9; }); });
  assert.ok(simulateNFLGame(game, history, f.players, f.observations, 500).every(scenario => scenario.home === null));
});
test('Team-only draws use verified scoring and opponent allowances without invented player or touchdown totals', () => {
  const f = fixture(), history = { home: scoreReferences(f.history.home.slice(0, 8)), away: scoreReferences(f.history.away.slice(0, 8)) };
  const scenario = simulateNFLTeamScore(game, history, 500);
  assert.deepEqual(scenario, simulateNFLTeamScore(game, history, 500));
  for (const team of [scenario.home, scenario.away]) {
    assert.equal(team.totals, null); assert.deepEqual(team.players, []); assert.equal(team.teamOnly, true);
    assert.ok(Number.isFinite(team.score.mean)); assert.throws(() => roundedSimulationBox(team), /does not support/);
  }
  assert.ok(Math.abs(scenario.home.winProbability + scenario.away.winProbability + scenario.tieProbability - 1) < 1e-8);
  const data = response([scenario], { evidenceMode: 'team-only', history: { home: 8, away: 8, target: 100 } });
  assert.equal(readNFLGameSimulation(data, game.id, game.date, { home: '1', away: '2' }).evidenceMode, 'team-only');
  for (const change of [rows => rows.slice(0, 7), rows => [rows[0], ...rows.slice(0, 7)],
    rows => [{ ...rows[0], date: game.date }, ...rows.slice(1)],
    rows => [{ ...rows[0], scores: undefined }, ...rows.slice(1)],
    rows => [{ ...rows[0], scores: { ...rows[0].scores, own: -1 } }, ...rows.slice(1)]]) {
    assert.throws(() => simulateNFLTeamScore(game, { ...history, home: change(history.home) }, 500));
  }
  assert.throws(() => readNFLGameSimulation({ ...data, evidenceMode: 'limited' }, game.id, game.date, { home: '1', away: '2' }), /invalid/);
});
test('Unavailable rosters and partial schedule feeds still prepare an honest score-only forecast', async () => {
  const f = fixture(), cache = simulationCache();
  const get = async url => {
    const parsed = new URL(url), year = Number(parsed.searchParams.get('season')), phase = Number(parsed.searchParams.get('seasontype'));
    if (!parsed.pathname.endsWith('/schedule') || year !== game.season || phase !== 2) throw new Error('Temporary source interruption');
    const teamId = parsed.pathname.match(/teams\/(\d+)/)[1], boxes = f.history[teamId === '1' ? 'home' : 'away'].filter(box => box.seasonType === 2).slice(0, 8);
    return { team: { id: teamId }, requestedSeason: { year, type: phase },
      events: boxes.map(box => ({ id: box.id, date: box.date, competitions: rawBox(box).header.competitions })) };
  };
  const job = await prepareSimulation(game, get, cache, now);
  assert.equal(job.history.home.length, 8); assert.equal(job.history.away.length, 8); assert.deepEqual(job.rosterPlayers, []);
  assert.ok(job.preparationIssues.length); assert.ok(job.warnings.some(warning => warning.includes('current roster')));
  const data = await advanceSimulation(game, job, cache, async () => { throw new Error('Box feed interruption'); }, now);
  assert.equal(data.status, 'ready'); assert.equal(data.evidenceMode, 'team-only'); assert.equal(data.refreshing, true);
  assert.deepEqual(data.history, { home: 8, away: 8, target: 100 });
  assert.equal(data.scenarios[0].home.totals, null);
  readNFLGameSimulation(data, game.id, game.date, { home: '1', away: '2' });
  job.history.home = job.history.home.slice(0, 7);
  const pending = await advanceSimulation(game, job, cache, async () => { throw new Error('Still unavailable'); }, now);
  assert.equal(pending.status, 'collecting'); assert.deepEqual(pending.scenarios, []);
  assert.ok(pending.warnings.some(warning => warning.includes('at least eight')));
});
test('Reduced cached team/player samples produce a box score without waiting for 100 team games', async () => {
  const f = fixture(), history = { home: scoreReferences(f.history.home.slice(0, 8)), away: scoreReferences(f.history.away.slice(0, 8)) };
  const job = { version: nflSimulationVersion, createdAt: new Date(now).toISOString(), history, rosterPlayers: f.players,
    players: null, injuries: [], warnings: [], logs: Object.fromEntries(f.players.map(player => [player.id,
      { season: game.season, done: true, refs: history[player.teamId === '1' ? 'home' : 'away'] }])) };
  const values = new Map([...f.history.home.slice(0, 8), ...f.history.away.slice(0, 8)].map(box => [`nfl:simulation:box:v2:${box.id}`, simulationBox(rawBox(box), box.id, now)]));
  const data = await advanceSimulation(game, job, simulationCache(values), async () => { throw new Error('Unexpected feed request'); }, now);
  assert.equal(data.status, 'ready'); assert.equal(data.evidenceMode, 'limited'); assert.equal(data.refreshing, false);
  assert.ok(data.scenarios[0].home.players.find(player => player.id === '11').stats.passingYards);
  assert.ok(data.scenarios.every(scenario => scenario.issue === null));
  readNFLGameSimulation(data, game.id, game.date, { home: '1', away: '2' });
});
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
test('Reduced histories require eight games; duplicates, preseason and target-game leakage remain rejected', () => {
  const f = fixture();
  assert.ok(simulateNFLGame(game, { ...f.history, home: f.history.home.slice(1) }, f.players, f.observations, 500)[0].home);
  assert.throws(() => simulateNFLGame(game, { ...f.history, home: f.history.home.slice(0, 7) }, f.players, f.observations, 500), /8 and 100/);
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
  const receiverYards = (scenario, position) => scenario.home.players.find(player => player.position === position).stats.receivingYards.mean;
  const gain = position => receiverYards(adjusted[0], position) - receiverYards(first[0], position);
  assert.ok(gain('WR') > 0 && gain('WR') > gain('RB') && gain('WR') > gain('TE'), 'The usage-leading receiver gets the largest absolute boost against a weaker pass defense');
  const strong = fixture({ weakDefense: .65 }), suppressed = simulateNFLGame(game, strong.history, strong.players, strong.observations, 500);
  assert.ok(receiverYards(suppressed[0], 'WR') < receiverYards(first[0], 'WR'));
  assert.ok(adjusted[0].home.matchup.passingYardsMultiplier > 1);
  assert.ok(better[0].home.score.mean > first[0].home.score.mean);
  assert.ok(better[0].home.players.find(p => p.position === 'WR').stats.receivingYards.mean > first[0].home.players.find(p => p.position === 'WR').stats.receivingYards.mean);
});
test('Verified touchdown evidence distinguishes recorded zero from missing stats and enforces passing/receiving accounting', () => {
  const raw = rawBox(fixture().history.home[0]);
  const parsed = simulationBox(raw, raw.header.id, now);
  assert.equal(parsed.teams[0].passingTouchdowns, 2);
  assert.equal(parsed.teams[0].rushingTouchdowns, 1);
  for (const team of raw.boxscore.players) for (const category of team.statistics) category.athletes[0].stats[2] = '0';
  assert.equal(simulationBox(raw, raw.header.id, now).teams[0].passingTouchdowns, 0);
  const missing = structuredClone(raw);
  missing.boxscore.players[0].statistics[0].keys.pop(); missing.boxscore.players[0].statistics[0].athletes[0].stats.pop();
  assert.throws(() => simulationBox(missing, raw.header.id, now), /touchdowns/);
  raw.boxscore.players[0].statistics[0].athletes[0].stats[2] = '1';
  assert.throws(() => simulationBox(raw, raw.header.id, now), /reconcile/);
});
test('TD distributions and rounded box lines conserve production, cap TDs by opportunities and support the projected score', () => {
  const f = fixture();
  const scenarios = simulateNFLGame(game, f.history, f.players, f.observations, 500);
  for (const scenario of scenarios) for (const team of [scenario.home, scenario.away]) {
    const box = roundedSimulationBox(team), qb = team.players.find(p => p.position === 'QB');
    const sum = key => team.players.reduce((n, p) => n + (box.players[p.id][key] ?? 0), 0);
    const mean = key => team.players.reduce((n, p) => n + (p.stats[key]?.mean ?? 0), 0);
    assert.ok(Math.abs(qb.stats.passingTouchdowns.mean - mean('receivingTouchdowns') - team.totals.otherReceivingTouchdowns.mean) < .4);
    assert.ok(Math.abs(team.totals.rushingTouchdowns.mean - mean('rushingTouchdowns') - team.totals.otherRushingTouchdowns.mean) < .4);
    assert.equal(box.players[qb.id].passingTouchdowns, sum('receivingTouchdowns') + box.remainder.otherReceivingTouchdowns);
    assert.equal(box.players[qb.id].passingYards, sum('receivingYards') + box.remainder.otherReceivingYards);
    assert.equal(box.players[qb.id].completions, sum('receptions') + box.remainder.otherReceptions);
    assert.equal(Math.round(team.totals.rushingYards.mean), sum('rushingYards') + box.remainder.otherRushingYards);
    assert.ok(box.score >= 6 * (box.players[qb.id].passingTouchdowns + sum('rushingTouchdowns') + box.remainder.otherRushingTouchdowns));
    assert.equal(box.totals.passingYards, sum('receivingYards') + box.remainder.otherReceivingYards);
    assert.equal(box.totals.receivingYards, box.totals.passingYards);
    assert.equal(box.totals.completions, sum('receptions') + box.remainder.otherReceptions);
    assert.equal(box.totals.rushingYards, sum('rushingYards') + box.remainder.otherRushingYards);
    assert.equal(box.totals.passingTouchdowns, sum('receivingTouchdowns') + box.remainder.otherReceivingTouchdowns);
    assert.equal(box.totals.receivingTouchdowns, box.totals.passingTouchdowns);
    assert.equal(box.totals.rushingTouchdowns, sum('rushingTouchdowns') + box.remainder.otherRushingTouchdowns);
    assert.equal(box.scoring.offensivePoints, 6 * (box.totals.passingTouchdowns + box.totals.rushingTouchdowns));
    assert.equal(box.score, box.scoring.offensivePoints + box.scoring.otherPoints);
    assert.ok(Number.isInteger(box.scoring.otherPoints) && box.scoring.otherPoints >= 0);
    for (const player of team.players) {
      const line = box.players[player.id];
      for (const value of Object.values(line)) assert.ok(Number.isInteger(value) && value >= 0);
      if (line.receivingTouchdowns !== undefined) assert.ok(line.receivingTouchdowns <= line.receptions);
      if (line.rushingTouchdowns !== undefined) assert.ok(line.rushingTouchdowns <= line.rushingAttempts);
      if (line.receptions === 0) assert.equal(line.receivingYards, 0);
      if (line.rushingAttempts === 0) assert.equal(line.rushingYards, 0);
    }
  }
  f.observations.forEach(rows => rows.forEach(row => { if (row.player.passingTouchdowns !== undefined) row.player.passingTouchdowns = 10; }));
  const highTD = simulateNFLGame(game, f.history, f.players, f.observations, 500)[0].home;
  assert.ok(highTD.score.mean >= 6 * (highTD.totals.passingTouchdowns.mean + highTD.totals.rushingTouchdowns.mean) - 1);
});
test('Fractional stat lines reconcile WR, TE and RB production and exact points, including zero-TD scores', () => {
  const f = fixture(), original = simulateNFLGame(game, f.history, f.players, f.observations, 500)[0].home;
  const range = mean => ({ mean, p10: 0, median: Math.floor(mean), p90: Math.ceil(mean) });
  for (const score of [.4, 5.4, 12.4, 27.4]) {
    const team = structuredClone(original), hasTD = score >= 12;
    const qb = team.players.find(player => player.position === 'QB');
    qb.stats.passingYards = range(112.51); qb.stats.completions = range(3.51); qb.stats.passingAttempts = range(4.51);
    qb.stats.passingTouchdowns = range(hasTD ? 1 : 0);
    const production = { WR: [1.49, 50.49, .4], TE: [1.51, 51.51, .4], RB: [.51, 10.51, .2] };
    for (const player of team.players) {
      if (production[player.position]) {
        const [catches, yards, td] = production[player.position];
        player.stats.receptions = range(catches); player.stats.receivingYards = range(yards);
        player.stats.receivingTouchdowns = range(hasTD ? td : 0);
      }
      if (player.stats.rushingAttempts) player.stats.rushingTouchdowns = range(hasTD && player.position === 'RB' ? 1 : 0);
    }
    team.score = range(score);
    team.totals.receptions = range(3.51); team.totals.passingYards = range(112.51);
    for (const key of ['otherReceptions', 'otherReceivingYards', 'otherReceivingTouchdowns', 'otherRushingTouchdowns']) team.totals[key] = range(0);
    team.totals.passingTouchdowns = range(hasTD ? 1 : 0); team.totals.rushingTouchdowns = range(hasTD ? 1 : 0);
    const box = roundedSimulationBox(team);
    const yards = team.players.reduce((sum, player) => sum + (box.players[player.id].receivingYards ?? 0), 0);
    assert.equal(box.players[qb.id].passingYards, yards + box.remainder.otherReceivingYards);
    assert.equal(box.score, 6 * (box.totals.receivingTouchdowns + box.totals.rushingTouchdowns) + box.scoring.otherPoints);
    assert.equal(box.totals.passingTouchdowns, box.totals.receivingTouchdowns);
    assert.ok(box.scoring.otherPoints >= 0);
    if (!hasTD) assert.equal(box.scoring.otherPoints, Math.round(score));
    if (score === 12.4) assert.equal(box.scoring.otherPoints, 0);
  }
});
test('Legacy forecasts stay readable but never acquire fabricated TDs; v2 rejects missing TD distributions', () => {
  const f = fixture(), current = response(simulateNFLGame(game, f.history, f.players, f.observations, 500));
  const old = structuredClone(current); old.version = legacyNFLSimulationVersion;
  for (const scenario of old.scenarios) for (const team of [scenario.home, scenario.away]) {
    for (const key of Object.keys(team.totals)) if (/Touchdowns/.test(key)) delete team.totals[key];
    for (const player of team.players) for (const key of Object.keys(player.stats)) if (/Touchdowns/.test(key)) delete player.stats[key];
  }
  assert.equal(readNFLGameSimulation(old, game.id, game.date, { home: '1', away: '2' }).version, legacyNFLSimulationVersion);
  assert.equal(roundedSimulationBox(old.scenarios[0].home).players['11'].passingTouchdowns, undefined);
  assert.equal(roundedSimulationBox(old.scenarios[0].home).scoring, null);
  assert.equal(roundedSimulationBox(old.scenarios[0].home).totals.receivingTouchdowns, null);
  assert.throws(() => readNFLGameSimulation({ ...old, version: nflSimulationVersion }, game.id, game.date, { home: '1', away: '2' }), /invalid/);
});
test('Reported out players are excluded; insufficient QB/player/market evidence remains unavailable, not fake zeros', () => {
  const f = fixture({ injured: true, qbGames: 3 }), missing = simulateNFLGame(game, f.history, f.players, f.observations, 500);
  assert.ok(missing.every(row => row.home === null && /four/.test(row.issue)));
  const injured = fixture({ injured: true });
  injured.observations.set('13', injured.observations.get('13').slice(0, 3));
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
  const get = async url => {
    const id = new URL(url).searchParams.get('event');
    if (!id) throw new Error('Player logs unavailable');
    calls++; return rawBox(boxes.get(id));
  };
  const first = await advanceSimulation(game, job, cache, get, now);
  assert.equal(first.status, 'ready'); assert.equal(first.evidenceMode, 'team-only'); assert.equal(first.refreshing, true);
  assert.equal(calls, 36); assert.equal(first.history.home + first.history.away, 36);
  const second = await advanceSimulation(game, job, cache, get, now);
  assert.equal(calls, 72); assert.equal(second.progress.completed, 72);
  const failing = await advanceSimulation(game, job, cache, async () => { throw new Error('Feed issue'); }, now);
  assert.equal(failing.status, 'ready'); assert.equal(failing.evidenceMode, 'team-only'); assert.equal(failing.progress.completed, 72); assert.equal(failing.scenarios.length, 1);
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
  assert.match(sql, /greatest\(0,4-count\(\*\)\)/);
  assert.match(sql, /limit available for update skip locked/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('nfl-simulation-dispatch'/);
  assert.match(sql, /gamewire-dispatch-nfl-simulations','\* \* \* \* \*'/);
  assert.match(sql, /interval '3 minutes'/);
  assert.match(sql, /least\(30,power\(2,least\(attempts,5\)\)/);
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

function backendFixture({ ready = false, locked = false, archiveFailure = false, startsDuringRun = false, missing = false, stale = false } = {}) {
  const f = fixture(), kickoff = new Date(Date.now() + 86400000).toISOString(), initial = response(simulateNFLGame(game, f.history, f.players, f.observations, 500), { kickoff, forecastAt: new Date().toISOString() });
  const refs = boxes => boxes.map(box => ({ id: box.id, date: box.date, season: box.season, seasonType: box.seasonType, teamId: box.teams[0].id, opponentId: box.teams[1].id }));
  const job = { version: nflSimulationVersion, createdAt: new Date().toISOString(), history: { home: refs(f.history.home), away: refs(f.history.away) },
    rosterPlayers: f.players, players: f.players, warnings: [], injuries: [], logs: {} };
  if (stale) initial.forecastAt = new Date(Date.now() - 15 * 60000).toISOString();
  const cache = new Map([...f.history.home, ...f.history.away].map(box => [`nfl:simulation:box:v2:${box.id}`, box]));
  for (const p of f.players) {
    const observations = f.observations.get(p.id), references = observations.map(row => {
      const own = { ...row.team, players: { [p.id]: row.player } }, box = { id: row.eventId, date: row.date, season: 2026, seasonType: 2, teams: [own, side(row.opponentId, false)] };
      cache.set(`nfl:simulation:box:v2:${box.id}`, box);
      return { id: box.id, date: box.date, season: 2026, seasonType: 2, teamId: own.id, opponentId: row.opponentId };
    });
    job.logs[p.id] = { done: true, season: 2026, refs: references };
  }
  const calls = [], updates = [];
  const admin = {
    from(table) {
      let keys = [], update;
      const builder = {
        select: () => builder, eq: () => builder, gt: () => builder, order: () => builder, limit: () => builder, in: (_field, values) => { keys = values; return builder; },
        update: value => { update = value; return builder; },
        maybeSingle: async () => ({ data: table === 'gamewire_game_forecasts' ? ready ? { payload: initial, event_start: kickoff } : null
          : missing ? null : { payload: job, response: response([], { status: 'collecting', forecastAt: null, kickoff }), model_version: nflSimulationVersion }, error: null }),
        then: resolve => {
          if (update) updates.push(update);
          return Promise.resolve({ data: table === 'gamewire_bot_cache' ? keys.filter(key => cache.has(key)).map(key => ({ cache_key: key, payload: cache.get(key) })) : [{ event_id: game.id }], error: null }).then(resolve);
        },
        upsert: async () => ({ error: null }),
      };
      return builder;
    },
    rpc: async (name, args) => { calls.push(name); return name === 'gamewire_claim_simulation' ? { data: !locked, error: null }
      : name !== 'gamewire_save_game_simulation' ? { data: null, error: null }
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
  return { admin, get, calls, updates, job, kickoff, initial, get fetched() { return fetched; } };
}
test('Fresh and stale forecasts load from storage without feed requests, CPU work or quota; existing progress does not claim a lease', async () => {
  for (const stale of [false, true]) {
    const fresh = backendFixture({ ready: true, stale });
    const result = await loadNFLGameSimulation(fresh.admin, game.id, fresh.kickoff, { home: '1', away: '2' }, async () => { throw new Error('Must not charge a cached forecast'); });
    assert.equal(result.status, 'ready'); assert.equal(result.refreshing, stale);
    assert.equal(fresh.calls.length, 0); assert.equal(fresh.fetched, 0);
  }
  const locked = backendFixture({ locked: true });
  assert.equal((await loadNFLGameSimulation(locked.admin, game.id, locked.kickoff, { home: '1', away: '2' }, async () => { throw new Error('Must not charge existing work'); })).status, 'collecting');
  assert.deepEqual(locked.calls, []); assert.equal(locked.fetched, 0);
  assert.equal(await runNFLGameSimulation(locked.admin, game.id, locked.get), null);
  assert.deepEqual(locked.calls, ['gamewire_claim_simulation']); assert.equal(locked.fetched, 0);
});
test('Fresh provisional snapshots keep background-refresh status; legacy v2 TD snapshots remain readable', async () => {
  const api = backendFixture({ ready: true });
  api.initial.refreshing = true;
  const load = () => loadNFLGameSimulation(api.admin, game.id, api.kickoff, { home: '1', away: '2' }, async () => { throw new Error('No quota needed'); });
  assert.equal((await load()).refreshing, true);
  api.initial.version = 'nfl-joint-bootstrap-v2';
  delete api.initial.evidenceMode;
  assert.equal((await load()).version, 'nfl-joint-bootstrap-v2');
});
test('Archived team-only preparation remains eligible for minute-by-minute backfill', async () => {
  const api = backendFixture(), f = fixture();
  api.job.history = { home: scoreReferences(f.history.home.slice(0, 8)), away: scoreReferences(f.history.away.slice(0, 8)) };
  api.job.history.home.push({ ...api.job.history.home[0], id: '99001' });
  api.job.players = []; api.job.rosterPlayers = []; api.job.logs = {};
  const started = Date.now(), data = await runNFLGameSimulation(api.admin, game.id, api.get);
  assert.equal(data.status, 'ready'); assert.equal(data.evidenceMode, 'team-only'); assert.equal(data.refreshing, true);
  assert.ok(api.calls.includes('gamewire_save_game_simulation'));
  const update = api.updates.find(update => update.response);
  assert.equal(update.response.refreshing, true);
  assert.ok(Date.parse(update.next_run_at) >= started + 60000 && Date.parse(update.next_run_at) < Date.now() + 65000);
});
test('Missing results enqueue once with quota, not foreground backfill; denied requests cannot enqueue', async () => {
  const api = backendFixture({ missing: true });
  const result = await loadNFLGameSimulation(api.admin, game.id, api.kickoff, { home: '1', away: '2' }, async () => true);
  assert.equal(result.status, 'collecting'); assert.deepEqual(api.calls, ['gamewire_request_simulation']); assert.equal(api.fetched, 0);
  const denied = backendFixture({ missing: true });
  await assert.rejects(loadNFLGameSimulation(denied.admin, game.id, denied.kickoff, { home: '1', away: '2' }, async () => false), /limit/);
  assert.deepEqual(denied.calls, []);
});
test('Warm-up uses supported weekly ESPN scoreboards, validates metadata and filters to the next 14 days', async () => {
  const api = backendFixture({ ready: true }), calls = [], clock = Date.now();
  let eventIds;
  api.admin.rpc = async (name, args) => { assert.equal(name, 'gamewire_queue_simulations'); eventIds = args.games.map(row => row.event_id); return { error: null }; };
  const get = async url => {
    if (url.includes('/summary')) return api.get(url);
    calls.push(url);
    const query = new URL(url).searchParams, week = Number(query.get('week') || 9);
    const event = { id: week === 9 ? game.id : String(week), date: new Date(clock + (week === 9 ? 1 : week === 10 ? 8 : 15) * 86400000).toISOString(),
      competitions: [{ status: { type: { state: 'pre' } } }] };
    return { season: { year: 2026, type: 2 }, week: { number: week }, events: [event] };
  };
  const warmed = await warmNFLGameSimulations(api.admin, get, clock);
  assert.equal(warmed.queued, 2); assert.equal(api.fetched, 0);
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
test('Week discovery queues new weeks, regular-season/playoff boundaries and opening-week games during preseason', async () => {
  for (const [phase, currentWeek] of [[2, 10], [2, 18], [3, 1], [1, 4]]) {
    const queued = [], clock = Date.now();
    const admin = { rpc: async (name, args) => { assert.equal(name, 'gamewire_queue_simulations'); queued.push(...args.games); return { error: null }; } };
    await warmNFLGameSimulations(admin, async url => {
      const query = new URL(url).searchParams;
      const seasonType = Number(query.get('seasontype') || phase), week = Number(query.get('week') || currentWeek);
      return { season: { year: 2026, type: seasonType }, week: { number: week }, events: [{ id: String(seasonType * 100 + week),
        date: new Date(clock + 86400000).toISOString(), competitions: [{ status: { type: { state: 'pre' } } }] }] };
    }, clock);
    assert.ok(queued.length >= 3);
    assert.ok(queued.every(row => ['2', '3'].includes(row.event_id[0])));
    assert.ok(queued.some(row => row.event_id === (phase === 1 ? '201' : `${phase}${String(currentWeek).padStart(2, '0')}`)));
    if (phase === 2 && currentWeek === 18) assert.ok(queued.some(row => row.event_id === '301'));
  }
});
test('Background workers archive verified evidence; write/kickoff failures persist retry errors and release leases', async () => {
  const successful = backendFixture();
  const result = await runNFLGameSimulation(successful.admin, game.id, successful.get);
  assert.equal(result.status, 'ready'); assert.equal(result.history.home, 100);
  assert.ok(successful.calls.includes('gamewire_save_game_simulation'));
  assert.ok(successful.updates.some(update => update.response?.status === 'ready'));
  for (const [options, pattern] of [[{ archiveFailure: true }, /archive/], [{ startsDuringRun: true }, /upcoming/]]) {
    const api = backendFixture(options);
    await assert.rejects(runNFLGameSimulation(api.admin, game.id, api.get), pattern);
    assert.ok(api.calls.includes('gamewire_fail_simulation'));
    assert.ok(api.updates.some(update => update.lease_token === null));
    assert.ok(!api.updates.some(update => update.response?.status === 'ready'));
  }
});
test('Stale completed simulations refresh current-season player logs without restarting unfinished historical backfill', async () => {
  for (const status of ['ready', 'collecting', 'provisional', 'legacy']) {
    const api = backendFixture(), original = api.admin.from;
    api.job.createdAt = new Date(Date.now() - 6 * 60000).toISOString();
    api.job.logs['11'].season = 2020;
    if (status === 'legacy') api.job.version = previousNFLSimulationVersion;
    api.admin.from = table => {
      const builder = original(table);
      if (table === 'gamewire_simulation_jobs') builder.maybeSingle = async () => ({ data: { payload: api.job, response: {
        status: ['provisional', 'legacy'].includes(status) ? 'ready' : status, refreshing: status === 'provisional',
      } }, error: null });
      return builder;
    };
    let refreshed;
    const code = ts.transpileModule(readFileSync(new URL('../supabase/functions/_shared/nflSimulationBackend.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const context = vm.createContext({ exports: {}, crypto, Date, Error, console, require(name) {
      if (name.includes('nflSimulationSources')) return {
        prepareSimulation: async () => ({ ...api.job, version: nflSimulationVersion, createdAt: new Date().toISOString(), logs: {} }),
        advanceSimulation: async (_game, job) => { refreshed = structuredClone(job.logs); return response([], { status: 'collecting', forecastAt: null, kickoff: api.kickoff }); },
      };
      if (name.endsWith('/nflSimulation.ts')) return { simulationGame, nflSimulationVersion, previousNFLSimulationVersion, readNFLGameSimulation };
      if (name.endsWith('/gamewaire.ts')) return { object: value => value && typeof value === 'object' ? value : {}, text: value => typeof value === 'string' ? value : '' };
      return {};
    } });
    vm.runInContext(code, context);
    await context.exports.runNFLGameSimulation(api.admin, game.id, api.get);
    assert.equal(refreshed['11'].done, !['ready', 'legacy'].includes(status));
    assert.equal(refreshed['11'].season, ['ready', 'legacy'].includes(status) ? 2026 : 2020);
    assert.equal(refreshed['11'].refs.length, 30);
  }
});
test('Feed-stalled partial backfills retain progress and increasing retry state instead of hammering the provider each minute', async () => {
  const api = backendFixture();
  const code = ts.transpileModule(readFileSync(new URL('../supabase/functions/_shared/nflSimulationBackend.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ exports: {}, crypto, Date, Error, console: { error() {} }, require(name) {
    if (name.includes('nflSimulationSources')) return { advanceSimulation: async () => response([], {
      status: 'collecting', forecastAt: null, kickoff: api.kickoff, stage: 'Team history',
      progress: { completed: 0, total: 200 }, history: { home: 0, away: 0, target: 100 }, warnings: ['10001: Feed issue'],
    }) };
    if (name.endsWith('/nflSimulation.ts')) return { simulationGame, nflSimulationVersion, readNFLGameSimulation };
    if (name.endsWith('/gamewaire.ts')) return { object: value => value && typeof value === 'object' ? value : {}, text: value => typeof value === 'string' ? value : '' };
    return {};
  } });
  vm.runInContext(code, context);
  const result = await context.exports.runNFLGameSimulation(api.admin, game.id, api.get);
  assert.equal(result.status, 'collecting');
  assert.ok(api.calls.includes('gamewire_fail_simulation'));
  const saved = api.updates.find(update => update.response);
  assert.equal(Object.hasOwn(saved, 'attempts'), false);
  assert.deepEqual([...saved.response.warnings], ['10001: Feed issue']);
  assert.ok(api.updates.some(update => update.lease_token === null));
});
function simulationMarkup(data, error = '', scenarioId = '', admin = false) {
  const code = ts.transpileModule(readFileSync(new URL('../src/NFLGameSimulation.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const state = [data, data?.status === 'ready' ? data : null, error, 0, scenarioId, false, false, admin];
  let i = 0;
  const context = vm.createContext({ exports: {}, Date, console, require(name) {
    if (name === 'react') return { useState: () => [state[i++], () => {}], useEffect() {} };
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name.includes('nflSimulation')) return { roundedSimulationBox, legacyNFLSimulationVersion };
    return {};
  } });
  vm.runInContext(code, context);
  return renderToStaticMarkup(jsxRuntime.jsx(context.exports.default, { game: { ...game, eventId: game.id } }));
}
test('Simulation UI renders scenario selection, ranges, transfer coverage, errors and retained forecasts without photos', () => {
  const f = fixture(), data = response(simulateNFLGame(game, f.history, f.players, f.observations, 500));
  const html = simulationMarkup(data, 'Feed issue', '', true);
  assert.match(html, /Quarterback scenario/); assert.match(html, /Includes prior teams/); assert.match(html, /10th/);
  assert.match(html, /Saved projections remain available/); assert.match(html, /Feed issue/);
  assert.match(html, /overtime is not separately simulated/); assert.doesNotMatch(html, /<img/);
  assert.match(html, /role="region"/); assert.match(html, /scope="col"/);
  const tables = html.match(/<table>[\s\S]*?<\/table>/g);
  assert.ok(tables.length >= 6);
  assert.ok(tables.every(table => !/Expected|10th|verified games/.test(table)));
  for (const match of html.matchAll(/<td><b>([^<]+)<\/b><\/td>/g)) assert.match(match[1], /^\d+$/);
  assert.match(html, /PASS TD/); assert.match(html, /REC TD/); assert.match(html, /RUSH TD/);
  assert.equal((html.match(/projected team totals and score accounting/g) ?? []).length, 2);
  const accounting = html.match(/<details class="nfl-simulation-accounting"[\s\S]*?<\/details>/g);
  assert.equal(accounting.length, 2);
  assert.ok(accounting.every(section => !/<details[^>]* open/.test(section)));
  assert.ok(accounting.every(section => /WR\/TE\/RB receiving/.test(section) && /other points/.test(section) && /Passing and receiving TDs count once/.test(section)));
  const unavailable = response([{ id: 'missing', label: 'Missing QB', quarterbacks: { home: 'Unknown', away: 'Unknown' }, home: null, away: null, issue: 'Insufficient evidence', tieProbability: null }], { status: 'unavailable' });
  assert.match(simulationMarkup(unavailable, '', '', true), /automatically prepares the upcoming NFL week/);
  assert.doesNotMatch(simulationMarkup(unavailable), /role="alert"/);
  assert.match(simulationMarkup(data, '', data.scenarios[1].id, true), /Backup 2/);
  const publicHtml = simulationMarkup(data, 'Feed issue');
  assert.doesNotMatch(publicHtml, /Feed issue|Admin:|player evidence|verified games|Limited evidence|Coverage:/);
  assert.ok(publicHtml.indexOf('nfl-simulation-scores') < publicHtml.indexOf('nfl-simulation-scenario'));
  assert.ok(html.indexOf('Admin:') > html.lastIndexOf('</table>'));
});
function panelRuntime(load, supabase) {
  const code = ts.transpileModule(readFileSync(new URL('../src/NFLGameSimulation.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const state = [], effects = [], timers = new Map(), listeners = new Map();
  let slot = 0, timerId = 0;
  const context = vm.createContext({ exports: {}, AbortController, Date, Error, console: { error() {} }, window: {
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id),
    addEventListener: (event, listener) => listeners.set(event, listener), removeEventListener: event => listeners.delete(event),
  }, require(name) {
    if (name === 'react') return {
      useState(initial) { const index = slot++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
      useEffect: effect => effects.push(effect),
    };
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name.includes('supabaseClient')) return { supabase };
    if (name.includes('nflSimulation')) return { roundedSimulationBox, legacyNFLSimulationVersion };
    return { loadGameSimulation: load };
  } });
  vm.runInContext(code, context);
  const render = () => { slot = 0; effects.length = 0; context.exports.default({ game: { ...game, eventId: game.id } }); };
  render();
  return { state, effects, timers, listeners, render };
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
test('Offline retries back off to five minutes and reconnect resumes automatically without clearing the draft forecast', async () => {
  const f = fixture(), data = response(simulateNFLGame(game, f.history, f.players, f.observations, 500));
  let fail = true;
  const runtime = panelRuntime(async () => { if (fail) throw new Error('Offline'); return data; });
  const stopClock = runtime.effects[0](), stop = runtime.effects[1]();
  await new Promise(resolve => setImmediate(resolve));
  for (const expected of [15000, 30000, 60000, 120000, 240000, 300000, 300000]) {
    const [id, timer] = [...runtime.timers].find(([, timer]) => timer.delay <= 300000);
    assert.equal(timer.delay, expected); runtime.timers.delete(id); timer.fn();
    await new Promise(resolve => setImmediate(resolve));
  }
  fail = false; runtime.listeners.get('online')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.state[1], data); assert.equal(runtime.state[2], '');
  stop(); stopClock(); assert.equal(runtime.timers.size, 0); assert.equal(runtime.listeners.size, 0);
});
test('Team-only UI shows scores without fabricated box scores, QB assumptions or blocking alerts', () => {
  const f = fixture(), history = { home: scoreReferences(f.history.home.slice(0, 8)), away: scoreReferences(f.history.away.slice(0, 8)) };
  const data = response([simulateNFLTeamScore(game, history, 500)], { evidenceMode: 'team-only', history: { home: 8, away: 8, target: 100 } });
  const html = simulationMarkup(data);
  assert.match(html, /Verified final-score history/); assert.match(html, /No missing player production is filled with zeros/);
  assert.doesNotMatch(html, /<table|Quarterback scenario|nfl-simulation-accounting|role="alert"/);
  assert.match(simulationMarkup(data, '', '', true), /8 home-team \/ 8 away-team/);
});

test('Player observations retain up to 100 cross-team appearances, not 30', () => {
  const f = fixture({ qbGames: 110 }), player = f.players[0];
  const rows = f.observations.get(player.id), refs = rows.map(row => ({
    id: row.eventId, date: row.date, season: 2026, seasonType: 2, teamId: row.teamId, opponentId: row.opponentId,
  }));
  const boxes = new Map(rows.map(row => [row.eventId, {
    id: row.eventId, date: row.date, season: 2026, seasonType: 2,
    teams: [{ ...row.team, players: { [player.id]: row.player } }, side(row.opponentId, false)],
  }]));
  const observations = simulationObservations(player, refs, boxes, now);
  assert.equal(observations.length, 100);
  assert.equal(observations[0].eventId, rows[0].eventId);
  const scenarios = simulateNFLGame(game, f.history, f.players,
    new Map([...f.observations].map(([id, rows]) => [id, id === player.id ? observations : rows.slice(0, 100)])), 500);
  const parsed = readNFLGameSimulation(response(scenarios), game.id, game.date, { home: '1', away: '2' });
  assert.equal(parsed.scenarios[0].home.players.find(row => row.id === player.id).games, 100);
});

test('Background collection continues to older career seasons after 30 player references', async () => {
  const f = fixture(), player = f.players[0];
  const refs = side => f.history[side].map(box => ({ id: box.id, date: box.date, season: box.season, seasonType: box.seasonType,
    teamId: box.teams[0].id, opponentId: box.teams[1].id }));
  const state = { season: 2026, refs: refs('home').slice(0, 30), done: false };
  const job = { version: nflSimulationVersion, createdAt: new Date(now).toISOString(), history: { home: refs('home'), away: refs('away') },
    rosterPlayers: [player], players: [player], injuries: [], warnings: [], logs: { [player.id]: state } };
  const values = new Map([...f.history.home, ...f.history.away].map(box => [`nfl:simulation:box:v2:${box.id}`, simulationBox(rawBox(box), box.id, now)]));
  const extra = { ...f.history.home[1], id: '901000', date: new Date(now - 86400000).toISOString(), season: 2026, seasonType: 2 };
  values.set(`nfl:simulation:box:v2:${extra.id}`, simulationBox(rawBox(extra), extra.id, now));
  const logs = { filters: [{ name: 'season', value: '2026', options: [{ value: '2026' }, { value: '2025' }] }],
    names: ['passingAttempts'], events: { [extra.id]: { gameDate: extra.date, team: { id: '1' }, opponent: { id: '3' } } },
    seasonTypes: [{ displayName: '2026 Regular Season', categories: [{ events: [{ eventId: extra.id, stats: ['35'] }] }] }] };
  await advanceSimulation(game, job, simulationCache(values), async url => {
    assert.match(url, /gamelog\?season=2026/);
    return logs;
  }, now);
  assert.equal(state.refs.length, 31);
  assert.equal(state.done, false, '30 appearances must not prematurely finish the career backfill');
  assert.equal(state.season, 2025);
});

test('Current-season hot receiving form increases production without unrelated sparse rushing evidence labels', () => {
  const baseline = fixture(), hot = fixture();
  const rows = hot.observations.get('14');
  rows.forEach((row, index) => {
    if (index < 5) row.player.receivingYards = 180;
    if (index < 4) Object.assign(row.player, { rushingAttempts: 1, rushingYards: 3, rushingTouchdowns: 0 });
  });
  const baseTeam = simulateNFLGame(game, baseline.history, baseline.players, baseline.observations, 1000)[0].home;
  const hotTeam = simulateNFLGame(game, hot.history, hot.players, hot.observations, 1000)[0].home;
  const baseReceiver = baseTeam.players.find(player => player.id === '14'), hotReceiver = hotTeam.players.find(player => player.id === '14');
  assert.ok(hotReceiver.stats.receivingYards.mean > baseReceiver.stats.receivingYards.mean + 10);
  assert.equal(hotReceiver.limited, false, 'WR rushing appearances are not part of the modeled receiving evidence');
  const weights = simulationPlayerWeights(rows, 2026, '2');
  assert.ok(weights[0] > weights[10]);
  assert.ok(weights.at(-1) > 0, 'Older verified career history still contributes');
  assert.ok(weights.slice(0, 5).reduce((a, b) => a + b) > weights.slice(5, 10).reduce((a, b) => a + b));
});

test('NFL moneylines align to the rounded default simulated winner; ties, missing games and wrong identities are suppressed', () => {
  const f = fixture(), data = response(simulateNFLGame(game, f.history, f.players, f.observations, 500));
  data.scenarios[0].home.score.mean = 24.4; data.scenarios[0].away.score.mean = 20.4;
  const quote = { sport: 'NFL', market: 'h2h', start: game.date, home: game.home.name, away: game.away.name, subject: game.home.name };
  assert.equal(simulationAllowsMoneyline(quote, data), true);
  assert.equal(simulationAllowsMoneyline({ ...quote, subject: game.away.name }, data), false);
  assert.equal(simulationAllowsMoneyline(quote, undefined), false);
  assert.equal(simulationAllowsMoneyline({ ...quote, home: 'Another team' }, data), false);
  assert.equal(simulationAllowsMoneyline({ ...quote, start: '2026-11-16T18:00:00Z' }, data), false);
  assert.equal(simulationAllowsMoneyline({ ...quote, sport: 'NBA' }, undefined), true);
  assert.equal(simulationAllowsMoneyline({ ...quote, market: 'spreads' }, data), true);
  data.scenarios[0].away.score.mean = 24.3;
  assert.equal(simulationAllowsMoneyline(quote, data), false, 'Displayed tied scores do not authorize a winner pick');
});

test('Chat projections and archived player forecasts reconcile to game lines after independent settled-result learning', async () => {
  const f = fixture(), data = response(simulateNFLGame(game, f.history, f.players, f.observations, 500));
  const original = { market: 'player_reception_yds', label: 'Receiving yards', estimate: 80, unit: 'yards', yards: 80,
    explanation: 'Independent player calculation.', evidence: { observations: Array.from({ length: 10 }, (_, i) => ({ eventId: String(i), date: date(i), value: 60 + i, opportunity: 6 })) } };
  const expected = roundedSimulationBox(data.scenarios[0].home).players['14'].receivingYards;
  const aligned = reconcileSimulationProjections([original], data, '1', '14')[0];
  assert.equal(aligned.estimate, expected); assert.equal(aligned.yards, expected);
  assert.equal(aligned.simulation.originalEstimate, 80);
  assert.equal(aligned.distribution.expected, expected);
  assert.equal(reconcileSimulationProjections([original], data, '2', '14')[0], original);
  const report = { matchup: { eventId: game.id, start: game.date, state: 'pre', opponent: 'Away Team' },
    eligibleForGuidance: true, week: 10, season: 2026, format: 'ppr', player: { id: '14', teamId: '1', position: 'WR' }, projections: [original] };
  let archived;
  const query = new Proxy({}, { get: (_target, key) => key === 'then' ? resolve => resolve({ data: [], error: null }) : () => query });
  const admin = { from: () => query, rpc: async (_name, input) => { archived = input.forecast; return { data: true, error: null }; } };
  await archivePlayerForecast(admin, report, now, data);
  assert.equal(report.projections[0].estimate, expected);
  assert.equal(archived.projections[0].estimate, expected);
  assert.equal(archived.projections[0].simulation.version, nflSimulationVersion);
  report.projections = [{ ...original, estimate: null, yards: null }];
  await archivePlayerForecast(admin, report, now, data);
  assert.equal(report.projections[0].estimate, expected, 'A verified game line can reconcile an unavailable independent estimate');
  assert.equal(archived.projections[0].estimate, expected);
  assert.equal(archived.projections[0].simulation.originalEstimate, null);
});

test('Saved NFL simulation alignment validates archival identities, kickoff and database failures', async () => {
  const api = backendFixture({ ready: true });
  const saved = await savedNFLGameSimulation(api.admin, game.id, api.kickoff);
  assert.equal(saved.eventId, game.id);
  assert.equal(await savedNFLGameSimulation(api.admin, game.id, game.date), undefined);
  api.initial.eventId = '123456';
  await assert.rejects(savedNFLGameSimulation(api.admin, game.id, api.kickoff), /invalid or mismatched/);
  const failed = new Proxy({}, { get: (_target, key) => key === 'maybeSingle' ? async () => ({ error: { message: 'Offline' } }) : () => failed });
  await assert.rejects(savedNFLGameSimulation({ from: () => failed }, game.id, api.kickoff), /Could not verify/);
});

test('Automatic NFL scoreboard picks cannot promote a losing moneyline or force a replacement value pick', () => {
  const f = fixture(), forecast = response(simulateNFLGame(game, f.history, f.players, f.observations, 500));
  forecast.scenarios[0].home.score.mean = 27; forecast.scenarios[0].away.score.mean = 20;
  const candidate = { key: 'home-ml', sport: 'NFL', market: 'h2h', modelVersion: 'evidence-value-v9', home: game.home.name, away: game.away.name,
    subject: game.home.name, side: game.home.name, start: game.date, line: null, american: -110, noVig: .5, quality: .9, probability: .7,
    ev: .3, edge: .15, conservativeEV: .1, updatedAt: new Date(now - 1000).toISOString(), dataAt: new Date(now).toISOString(),
    sampleSize: 20, samples: [], risks: [], facts: [], identifiers: { espnEventId: game.id } };
  const options = { nflSimulations: new Map([[game.id, forecast]]) };
  assert.equal(scoreboardPicks([candidate], now, options).length, 1);
  assert.equal(scoreboardPicks([{ ...candidate, subject: game.away.name, side: game.away.name }], now, options).length, 0);
  assert.equal(scoreboardPicks([{ ...candidate, ev: -.1, conservativeEV: -.1 }], now, options).length, 0);
  assert.equal(scoreboardPicks([candidate], now, { nflSimulations: new Map() }).length, 0);
  assert.equal(scoreboardPicks([{ ...candidate, market: 'spreads', line: 3.5, subject: game.away.name }], now, options).length, 1);
  assert.equal(scoreboardPicks([candidate], Date.parse(game.date) + 1, options).length, 1, 'Original picks are retained after kickoff');
});

test('Simulation diagnostics permissions reset on account changes and ignore stale admin checks', async () => {
  let listener, grant;
  const client = { rpc: () => new Promise(resolve => { grant = resolve; }), auth: {
    onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() { listener = null; } } } }; },
  } };
  const runtime = panelRuntime(async () => null, client);
  const stop = runtime.effects[3]();
  grant({ data: true, error: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.state[7], true);
  listener();
  assert.equal(runtime.state[7], false);
  for (const [id, timer] of runtime.timers) if (timer.delay === 0) { runtime.timers.delete(id); timer.fn(); }
  const stale = grant;
  listener();
  stale({ data: true, error: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.state[7], false, 'An old permission result cannot reopen admin diagnostics after account change');
  stop();
  assert.equal(listener, null);
});
