import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
function load(overrides = {}) {
  const context = vm.createContext({ exports: {}, console: { error() {} }, Date, AbortSignal, require(name) {
    if (name === './teamGameLogs') return { teamLogResult: (game, id) => {
      const own = game.home.id === id ? game.home : game.away, other = game.home.id === id ? game.away : game.home;
      return own.score > other.score ? 'W' : own.score < other.score ? 'L' : 'T';
    }, teamSeasonLabel: (_league, season) => String(season), ...overrides.logs };
    if (name === './sportsDatabase') return overrides.data ?? {};
    throw Error(`Unexpected dependency ${name}`);
  } });
  vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/services/teamLabResearch.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.exports;
}
const team = { id: '1', name: 'Test Team', abbr: 'TST' }, scope = { league: 'NFL', season: 2026, team };
function game(season, index, result, home = true) {
  const own = { ...team, score: result === 'W' ? 21 : 10 }, other = { id: '2', score: result === 'L' ? 21 : 10 };
  return { seasonType: 2, game: { eventId: `${season}${index}`, seasonYear: season, status: 'FINAL',
    date: `${season}-01-${String(index + 1).padStart(2, '0')}`, home: home ? own : other, away: home ? other : own } };
}
function schedule(season = 2026, missing = 7) {
  return { team, requestedSeason: { year: season, type: 2 }, events: Array.from({ length: 18 }, (_, index) => index + 1)
    .filter(week => week !== missing).map(week => ({ id: String(week), week: { number: week },
      competitions: [{ competitors: [{ team }, { team: { id: '2' } }] }] })) };
}
test('Three-season records use chronological prior losses, include 2+ streaks and reset between seasons', () => {
  const api = load(), seasons = [
    { season: 2024, entries: ['L', 'L', 'W', 'T', 'L', 'W'].map((result, index) => game(2024, index, result)).reverse() },
    { season: 2025, entries: ['L', 'L', 'L', 'L'].map((result, index) => game(2025, index, result)) },
    { season: 2026, entries: ['W', 'L', 'W'].map((result, index) => game(2026, index, result)) },
  ];
  const rows = api.buildTeamRecords(scope, seasons, 'team records');
  assert.deepEqual([rows[0].wins, rows[0].losses, rows[0].ties, rows[0].games], [4, 8, 1, 13]);
  assert.equal(rows[0].percent, 4.5 / 13 * 100);
  assert.deepEqual([rows[3].wins, rows[3].losses, rows[3].games], [3, 4, 7]);
  assert.deepEqual([rows[4].wins, rows[4].losses, rows[4].games], [1, 2, 3]);
});
test('Home/away filters also constrain situational records; neutral, future, preseason and duplicate games are not miscounted', () => {
  const api = load(), entries = [game(2026, 0, 'L'), game(2026, 1, 'W', false), game(2026, 2, 'L'),
    game(2026, 3, 'W'), game(2026, 4, 'W')];
  entries[4].game.neutralSite = true;
  entries.push(entries[0], { ...game(2026, 5, 'W'), seasonType: 1 },
    { ...game(2026, 6, 'W'), game: { ...game(2026, 6, 'W').game, date: '2099-01-01' } });
  const rows = api.buildTeamRecords(scope, [{ season: 2026, entries }], 'home record after a loss');
  assert.equal(rows[0].games, 5);
  assert.equal(rows[1].games, 3);
  assert.equal(rows[2].games, 1);
  assert.equal(rows[3].games, 1);
  assert.equal(rows[3].wins, 1);
});
test('Official bye requires a complete identity/season/week-verified NFL schedule, not a date gap', () => {
  const api = load(), raw = schedule();
  assert.equal(api.readOfficialBye(raw, '1', 2026).week, 7);
  assert.equal(api.readOfficialBye(raw, '1', 2026).nextGameId, '8');
  assert.throws(() => api.readOfficialBye(raw, '9', 2026), /complete/);
  assert.throws(() => api.readOfficialBye(raw, '1', 2025), /complete/);
  raw.events[1].week.number = 1;
  assert.throws(() => api.readOfficialBye(raw, '1', 2026), /conflicting/);
  const entries = [game(2026, 0, 'L'), game(2026, 1, 'W')];
  entries[1].game.date = '2026-03-01';
  assert.equal(api.buildTeamRecords(scope, [{ season: 2026, entries }], 'bye record')[5].games, 0);
  assert.equal(api.buildTeamRecords(scope, [{ season: 2026, entries, byeGameId: entries[1].game.eventId }], 'bye record')[5].wins, 1);
});
test('Team identity uses whole names, avoids Hornets/Nets collisions, and explicit names override remembered teams', async () => {
  const hornets = { id: '3', name: 'Charlotte Hornets', abbr: 'CHA' }, nets = { id: '4', name: 'Brooklyn Nets', abbr: 'BKN' };
  const api = load({ logs: { fetchTeamLogDirectory: async () => ({ season: 2027, teams: [hornets, nets] }) } });
  const signal = new AbortController().signal;
  assert.equal((await api.resolveLabTeam('NBA Hornets home record', signal)).team.id, '3');
  assert.equal((await api.resolveLabTeam('NBA Nets away record', signal, { ...scope, team: hornets })).team.id, '4');
  assert.equal((await api.resolveLabTeam('What about away?', signal, { ...scope, team: hornets })).team.id, '3');
  await assert.rejects(api.resolveLabTeam('NBA unknown team record', signal), /Name an NFL or NBA team/);
});
test('Team-record prompts do not steal player stat-line requests', () => {
  const api = load();
  assert.equal(api.isTeamTrendQuestion('How many games have the Bengals won at home?'), true);
  assert.equal(api.isTeamTrendQuestion('Bengals coming off back-to-back losses'), true);
  assert.equal(api.isTeamTrendQuestion('Will LeBron record 15 points?'), false);
  assert.equal(api.isTeamTrendQuestion('Higgins receiving yards hit rates away'), false);
});
test('Fetches the current and previous two seasons, preserves explicit partial failures, and never fabricates byes', async () => {
  const requested = [], api = load({ logs: {
    fetchTeamLogDirectory: async () => ({ season: 2026, teams: [team] }),
    fetchTeamRegularGameLog: async (_league, _team, season) => {
      requested.push(season);
      if (season === 2025) throw Error('Provider failed');
      return [game(season, 0, 'W')];
    },
  }, data: { fetchStaticSports: async () => ({ ok: true, json: async () => ({}) }) } });
  const report = await api.teamTrendReport('NFL TST after a loss', new AbortController().signal);
  assert.deepEqual(requested.sort(), [2024, 2025, 2026]);
  assert.equal(report.rows[0].games, 2);
  assert.equal(report.byeSupported, false);
  assert.equal(report.rows[5].percent, null);
  assert.match(report.issues.join(' '), /2025 season unavailable/);
  const nba = load().buildTeamRecords({ ...scope, league: 'NBA' }, [], 'record after bye');
  assert.equal(nba.length, 5);
});
