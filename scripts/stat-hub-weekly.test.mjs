import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function fixture() {
  let now = Date.now(), fail = false;
  const records = new Map(), calls = [], changes = [], errors = [];
  const teams = ['1', '2', '3'].map(id => ({ id, name: `Team ${id}`, abbr: `T${id}`, color: '#123456', score: 0, record: '' }));
  const directory = { teams, season: 2026 };
  const read = (kind, key, age = Infinity) => { const row = records.get(`${kind}:${key}`); return row && now - row.savedAt < age ? row.data : null; };
  const save = (kind, key, data) => { records.set(`${kind}:${key}`, { data, savedAt: now }); changes.push([kind, key]); };
  const context = vm.createContext({ exports: {}, AbortSignal, Date, console: { error: (...args) => errors.push(args) }, require(name) {
    if (name.includes('renderSnapshots')) return { readRenderSnapshot: read, saveRenderSnapshot: save,
      restoreStatSnapshots: async () => {}, readLastNBAStatHub: () => null };
    if (name.includes('teamGameLogs')) return {
      fetchTeamLogDirectory: async league => { calls.push(`directory:${league}`); save('teamDirectory', league, directory); return directory; },
      fetchTeamGameLog: async (_league, id) => { calls.push(`schedule:${id}`); return [{ seasonType: 2, game: {
        eventId: `${id}1`, date: '2026-11-20', home: teams.find(team => team.id === id), away: { ...teams[0], name: 'Opponent' } } }]; },
      teamLogResult: () => 'W',
    };
    if (name.includes('sportsData')) return {
      fetchNFLStatHubRoster: async id => { calls.push(`roster:${id}`); return [{ id: `${id}0`, name: `Player ${id}`, position: 'QB', jersey: '1' }]; },
      fetchNFLHistoricalSummary: async (_feed, id) => { calls.push(`box:${id}`); if (fail) throw new Error('Provider unavailable');
        return { header: { id }, stats: { passingYards: 250, interceptions: 0 } }; },
      readNFLPlayerGameStats: summary => summary.stats,
    };
    if (name.includes('nbaData')) return {
      fetchNBARoster: async (id, season) => { calls.push(`nba-roster:${id}`); const players = [{ id: `${id}0`, name: `Player ${id}`, position: 'G', teamId: id }];
        save('nbaRoster', `roster:${id}:${season}`, players); return players; },
      fetchNBAPlayerProfile: async (id, season, _signal, age) => { const key = `profile:${id}:${season}`;
        const cached = read('nbaProfile', key, age); if (cached) return cached;
        calls.push(`nba-profile:${id}`); const value = { averages: { points: 20 }, games: [{ stats: { points: 0 } }] };
        save('nbaProfile', key, value); return value; },
    };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  vm.runInContext(compile('../src/services/statHubLibrary.ts'), context);
  return { api: context.exports, calls, records, changes, errors, read, save,
    expire: () => { now += context.exports.statHubWeek; }, fail: () => { fail = true; } };
}
test('All NFL rosters appear before game logs; complete seven-day snapshots reuse both without network', async () => {
  const f = fixture(), signal = new AbortController().signal;
  await f.api.warmStatHubLibrary('NFL', signal, () => {});
  assert.equal(f.api.readStatHubGroups('NFL').length, 3);
  assert.ok(f.calls.indexOf('schedule:1') > f.calls.indexOf('roster:3'), 'Roster display cannot wait for every box score');
  assert.equal(f.read('nflStatHubTeam', '1:2026').players[0].recentGames[0].stats.passingYards, 250);
  assert.equal(f.read('nflStatHubTeam', '1:2026').players[0].recentGames[0].stats.interceptions, 0);
  assert.equal(f.read('nflStatHubTeam', '1:2026').players[0].recentGames[0].stats.receptions, undefined);
  const count = f.calls.length;
  await f.api.warmStatHubLibrary('NFL', signal, () => {});
  assert.equal(f.calls.length, count, 'A revisit within seven days makes no network requests');
  f.expire();
  await f.api.warmStatHubLibrary('NFL', signal, () => {});
  assert.ok(f.calls.length > count, 'Exactly seven days triggers refresh');
});
test('NBA rosters and complete profiles use the same weekly cadence and separate season keys', async () => {
  const f = fixture(), signal = new AbortController().signal;
  await f.api.warmStatHubLibrary('NBA', signal, () => {});
  assert.equal(f.api.readStatHubGroups('NBA')[0].players.length, 1);
  assert.ok(f.calls.indexOf('nba-profile:10') > f.calls.indexOf('nba-roster:3'));
  const count = f.calls.length;
  await f.api.warmStatHubLibrary('NBA', signal, () => {});
  assert.equal(f.calls.length, count);
  assert.equal(f.read('nbaProfile', 'profile:10:2027'), null);
  f.expire(); await f.api.warmStatHubLibrary('NBA', signal, () => {});
  assert.equal(f.calls.filter(call => call === 'nba-profile:10').length, 2);
});
test('Failed refreshes preserve recorded logs and explicitly report incomplete downloads, never success-shaped zeroes', async () => {
  const f = fixture(), signal = new AbortController().signal, messages = [];
  await f.api.warmStatHubLibrary('NFL', signal, () => {});
  f.expire(); f.fail();
  await f.api.warmStatHubLibrary('NFL', signal, (label, errors) => messages.push([label, errors]));
  const saved = f.read('nflStatHubTeam', '1:2026');
  assert.equal(saved.complete, false);
  assert.equal(saved.players[0].recentGames[0].stats.passingYards, 250);
  assert.ok(messages.at(-1)[1].length > 0);
  assert.match(messages.at(-1)[0], /missing data/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(f.api.warmStatHubLibrary('NFL', aborted.signal, () => {}), /abort/i);
});
test('Injury disclosure is collapsed with a medical cross, and SGP explanatory paragraphs are removed only from simulations', () => {
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, require(name) {
    if (name === 'react') return { useState: initial => [initial, () => {}], useEffect() {} };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    return {};
  } });
  vm.runInContext(compile('../src/PregameInjuries.tsx'), context);
  const tree = context.exports.default({ game: { home: { id: '1' }, away: { id: '2' } } });
  assert.equal(tree.type, 'details'); assert.equal(tree.props.open, undefined);
  assert.equal(tree.props.children[0].type, 'summary');
  assert.match(JSON.stringify(tree.props.children[0]), /🏥/);
  const sim = readFileSync(new URL('../src/SimulationParlayBuilder.tsx', import.meta.url), 'utf8');
  assert.match(sim, /className="simulation-parlay-create"/);
  assert.doesNotMatch(sim, /Three distinct players, highest|Experimental individual-leg|<small>/);
  const builder = readFileSync(new URL('../src/ParlayGraphicBuilder.tsx', import.meta.url), 'utf8');
  assert.match(builder, /!standalone && <p className="parlay-save-note"/);
  assert.doesNotMatch(readFileSync(new URL('../src/NBAExperience.tsx', import.meta.url), 'utf8'), /if \(mode === 'stats' && lastStatHub\) saveLastNBAStatHub/);
});
