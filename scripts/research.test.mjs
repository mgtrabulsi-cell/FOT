import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { nbaStatValue } from '../src/services/nbaStats.ts';

function moduleFor(file, imports, globals = {}) {
  const context = vm.createContext({ exports: {}, console, structuredClone, Date, Error,
    crypto: { randomUUID }, navigator: { onLine: true }, ...globals,
    require(name) { if (name in imports) return imports[name]; throw new Error(`Unexpected dependency ${name}`); } });
  vm.runInContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports;
}
const clone = value => JSON.parse(JSON.stringify(value));
const game = { eventId: '900', kickoff: '2026-10-24T23:00:00Z', homeId: '2', awayId: '1', home: 'HME', away: 'AWY' };
const snapshot = () => ({ league: 'NBA', kind: 'player', title: 'Test Player', game: { ...game },
  player: { id: '11', teamId: '1' }, forecastAt: '2026-10-24T20:00:00Z', identity: 'model-v1 / scenario-a',
  sections: [{ title: 'Saved forecast', rows: [{ label: 'PTS', value: '25.0' }] }] });
function storageHarness() {
  const records = new Map(), state = { fail: false };
  const storage = {
    load: async key => records.has(key) ? structuredClone(records.get(key)) : undefined,
    save: async (key, value) => { if (state.fail) throw new Error('Quota exceeded'); records.set(key, structuredClone(value)); },
    deleteAccount: async keys => { for (const key of keys) records.delete(key); },
  };
  const api = moduleFor('../src/services/research.ts', { './draftStorage': { createDraftStorage: () => storage } });
  return { api, records, state };
}
test('Research persists snapshots and notes offline, without any fetch, isolated by account and guest', async () => {
  const { api } = storageHarness();
  await api.saveResearch('alice', snapshot(), 'Watch minutes');
  await api.saveResearch('guest', snapshot(), 'Guest only');
  assert.equal((await api.loadResearch('alice'))[0].note, 'Watch minutes');
  assert.equal((await api.loadResearch('guest'))[0].note, 'Guest only');
  assert.equal((await api.loadResearch('bob')).length, 0);
});
test('Snapshot freezes at save time and survives model refresh, note edits and final-result writes unchanged', async () => {
  const { api } = storageHarness(), original = snapshot(), expected = clone(original);
  const saving = api.saveResearch('alice', original, 'Before');
  original.sections[0].rows[0].value = '999';
  const [entry] = await saving;
  await api.updateResearch('alice', entry.id, { note: 'After' });
  const result = { checkedAt: new Date().toISOString(), sections: [{ title: 'Final', rows: [{ label: 'PTS', value: '0' }] }] };
  await api.updateResearch('alice', entry.id, { result });
  const [restored] = await api.loadResearch('alice');
  assert.deepEqual(clone(restored.snapshot), expected);
  assert.equal(restored.note, 'After');
  assert.deepEqual(clone(restored.result), result);
  assert.equal(restored.savedAt, entry.savedAt);
});
test('Concurrent saves and edits do not lose other research', async () => {
  const { api } = storageHarness();
  await Promise.all(Array.from({ length: 10 }, (_, index) => api.saveResearch('alice', snapshot(), String(index))));
  const rows = await api.loadResearch('alice');
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map(row => row.id)).size, 10);
  await Promise.all(rows.map(row => api.updateResearch('alice', row.id, { note: `updated ${row.note}` })));
  assert.ok((await api.loadResearch('alice')).every(row => row.note.startsWith('updated')));
});
test('Deletion is scoped, removes notes/results and blocks late writes for the deleted account', async () => {
  const { api } = storageHarness();
  const [entry] = await api.saveResearch('alice', snapshot(), 'Private');
  await api.saveResearch('bob', snapshot(), 'Other account');
  await api.saveResearch('guest', snapshot(), 'Guest');
  await api.deleteResearch('alice');
  assert.equal((await api.loadResearch('alice')).length, 0);
  await assert.rejects(api.saveResearch('alice', snapshot(), 'Late'), /account deletion/);
  await assert.rejects(api.updateResearch('alice', entry.id, { note: 'Late' }), /account deletion/);
  assert.equal((await api.loadResearch('bob')).length, 1);
  assert.equal((await api.loadResearch('guest')).length, 1);
  const other = (await api.loadResearch('bob'))[0];
  await api.removeResearch('bob', other.id);
  assert.equal((await api.loadResearch('bob')).length, 0);
});
test('Storage failures, corrupt records and invalid snapshots fail explicitly without erasing good data', async () => {
  const { api, records, state } = storageHarness();
  await api.saveResearch('alice', snapshot(), 'Keep');
  state.fail = true;
  await assert.rejects(api.saveResearch('alice', snapshot(), 'Not saved'), /Quota/);
  assert.equal((await api.loadResearch('alice')).length, 1);
  state.fail = false;
  await assert.rejects(api.saveResearch('alice', { ...snapshot(), sections: null }, ''), /incomplete/);
  records.set('research:broken', [{ snapshot: {} }]);
  await assert.rejects(api.loadResearch('broken'), /could not be read/);
  await assert.rejects(api.updateResearch('alice', 'missing', { note: 'No' }), /no longer exists/);
});
function resultsHarness(overrides = {}, online = true) {
  const nba = { eventId: game.eventId, status: 'post', homeScore: 100, awayScore: 99,
    teams: [{ id: '2', players: [] }, { id: '1', players: [{ id: '11', name: 'Test Player', didNotPlay: false,
      stats: { points: 0, rebounds: 0, assists: 0 } }] }] };
  const nfl = { eventId: game.eventId, isFinal: true, state: 'post', teams: [
    { id: '1', abbreviation: 'AWY', score: '0', categories: [{ title: 'Passing', labels: ['YDS', 'TD'],
      athletes: [{ id: '11', name: 'Test Player', stats: ['0', '0'] }] }] },
    { id: '2', abbreviation: 'HME', score: '20', categories: [] },
  ] };
  let calls = 0;
  const api = moduleFor('../src/services/researchResults.ts', {
    './nbaStats': { nbaStatValue },
    './nbaData': { fetchNBASummary: async () => { calls++; return { ...nba, ...overrides.nba }; } },
    './sportsData': { fetchNFLBoxScore: async () => { calls++; return { ...nfl, ...overrides.nfl }; } },
  }, { navigator: { onLine: online } });
  return { api, calls: () => calls };
}
test('NBA finals keep real zeroes, leave missing threes unavailable, and do not mutate saved forecasts', async () => {
  const { api } = resultsHarness(), saved = snapshot(), expected = clone(saved);
  const result = await api.checkResearchResult(saved, new AbortController().signal);
  assert.match(JSON.stringify(result), /PTS: 0.*REB: 0.*AST: 0.*PRA: 0.*3PM: Unavailable/);
  assert.deepEqual(saved, expected);
});
test('NBA DNP is not a fabricated zero projection result', async () => {
  const { api } = resultsHarness({ nba: { teams: [{ id: '2', players: [] }, { id: '1', players: [
    { id: '11', name: 'Test Player', didNotPlay: true, reason: 'Inactive', stats: {} },
  ] }] } });
  const result = await api.checkResearchResult(snapshot(), new AbortController().signal);
  assert.match(JSON.stringify(result), /Did not play: Inactive/);
  assert.doesNotMatch(JSON.stringify(result), /PTS: 0/);
});
test('NFL finals use recorded player labels, preserve zeroes, and support team-only research', async () => {
  const { api } = resultsHarness();
  const result = await api.checkResearchResult({ ...snapshot(), league: 'NFL' }, new AbortController().signal);
  assert.match(JSON.stringify(result), /YDS: 0.*TD: 0/);
  const teamOnly = await api.checkResearchResult({ ...snapshot(), league: 'NFL', kind: 'matchup', player: undefined }, new AbortController().signal);
  assert.match(JSON.stringify(teamOnly), /Recorded final score/);
});
test('Both sports reject live, mismatched and incomplete finals rather than returning success-shaped results', async () => {
  for (const league of ['NBA', 'NFL']) {
    for (const [sport, patch] of league === 'NBA' ? [
      ['nba', { status: 'in' }], ['nba', { eventId: 'other' }], ['nba', { homeScore: undefined }], ['nba', { teams: [] }],
    ] : [
      ['nfl', { isFinal: false }], ['nfl', { eventId: 'other' }], ['nfl', { teams: [] }],
      ['nfl', { teams: [{ id: '1', score: '' }, { id: '2', score: '20' }] }],
    ]) {
      const { api } = resultsHarness({ [sport]: patch });
      await assert.rejects(api.checkResearchResult({ ...snapshot(), league }, new AbortController().signal));
    }
  }
});
test('Offline final checks and missing matchups explain failure without fetching', async () => {
  const { api, calls } = resultsHarness({}, false);
  await assert.rejects(api.checkResearchResult(snapshot(), new AbortController().signal), /Reconnect/);
  await assert.rejects(api.checkResearchResult({ ...snapshot(), game: null }, new AbortController().signal), /No verified matchup/);
  assert.equal(calls(), 0);
});
test('Aborted final checks cannot return results for a later storage write', async () => {
  const { api } = resultsHarness(), controller = new AbortController();
  controller.abort();
  await assert.rejects(api.checkResearchResult(snapshot(), controller.signal), /abort/i);
});
test('Player absent from the returned final is unavailable, never a made-up zero', async () => {
  for (const league of ['NBA', 'NFL']) {
    const { api } = resultsHarness();
    await assert.rejects(api.checkResearchResult({ ...snapshot(), league, player: { id: 'missing', teamId: '1' } }, new AbortController().signal), /no verified final/);
    await assert.rejects(api.checkResearchResult({ ...snapshot(), league, player: { id: '11', teamId: 'unrelated' } }, new AbortController().signal), /team does not match/);
  }
});
test('Capture adapters retain scenario/version, all NBA projected stats and real zeroes; reject wrong matchup identities', () => {
  const api = moduleFor('../src/services/researchCaptures.ts', {
    './nbaPlayerLab': { nbaPlayerBreakdown: () => ({ recentText: 'Five appearances', opponentText: ['Verified context'] }) },
    '../../supabase/functions/_shared/nflSimulation': {
      projectedSimulationScore: () => ({ home: 24, away: 20 }),
      roundedSimulationBox: () => ({ players: { '11': { receptions: 3, receivingYards: 42 } } }),
    },
  });
  const fixture = { eventId: game.eventId, date: game.kickoff, home: { id: '2', abbr: 'HME' }, away: { id: '1', abbr: 'AWY' } };
  const player = { id: '11', name: 'Test', excluded: false, stats: { points: { mean: 0 }, rebounds: { mean: 3 }, assists: { mean: 4 }, pra: { mean: 7 }, threePointers: { mean: 0 } } };
  const nba = { eventId: game.eventId, kickoff: game.kickoff, status: 'ready', version: 'nba-v1', forecastAt: snapshot().forecastAt,
    home: { id: '2', abbr: 'HME', score: { mean: 100 }, players: [] },
    away: { id: '1', abbr: 'AWY', score: { mean: 99 }, players: [player] } };
  const captured = api.captureNBAMatchup(fixture, nba);
  assert.equal(captured.identity, 'nba-v1');
  assert.match(JSON.stringify(captured), /PTS: 0.0.*3PM: 0.0/);
  assert.throws(() => api.captureNBAMatchup(fixture, { ...nba, eventId: 'wrong' }), /does not match/);
  assert.throws(() => api.captureNBAMatchup(fixture, { ...nba, kickoff: '2026-10-25T23:00:00Z' }), /does not match/);
  const scenario = { id: 'qb-a', away: { id: '1', abbr: 'AWY', players: [] }, home: { id: '2', abbr: 'HME', players: [] } };
  const nfl = { ...nba, version: 'nfl-v1', scenarios: [scenario] };
  assert.equal(api.captureNFLMatchup(fixture, nfl, scenario).identity, 'nfl-v1 / qb-a');
  const withPlayer = { ...scenario, away: { ...scenario.away, totals: {}, players: [
    { id: '11', name: 'Test', stats: { receptions: { mean: 3.9 }, receivingYards: { mean: 42.8 } } },
  ] } };
  const rounded = api.captureNFLMatchup(fixture, { ...nfl, scenarios: [withPlayer] }, withPlayer);
  assert.match(JSON.stringify(rounded), /receptions: 3.*receivingYards: 42/);
  assert.doesNotMatch(JSON.stringify(rounded), /3.9|42.8/);
  assert.throws(() => api.captureNFLMatchup(fixture, nfl, { ...scenario, id: 'wrong' }), /does not match/);
  assert.throws(() => api.captureNFLMatchup(fixture, { ...nfl, eventId: 'wrong' }, scenario), /does not match/);
  const nbaPlayer = api.captureNBAPlayer({ player: { ...player, teamId: '1' }, game: fixture, forecastAt: nba.forecastAt,
    forecastVersion: 'nba-v1', projection: player });
  assert.match(nbaPlayer.identity, /nba-v1/);
  assert.equal(nbaPlayer.player.id, '11');
  assert.equal(nbaPlayer.sections[0].rows[0].value, '0.0');
  const nflPlayer = api.captureNFLPlayer({ player: { id: '11', teamId: '1', name: 'Test', teamAbbr: 'AWY' },
    matchup: { eventId: game.eventId, start: game.kickoff, home: false, opponentId: '2', opponent: 'HME' },
    projections: [{ label: 'Receiving yards', estimate: null, simulation: { version: 'nfl-v1', scenarioId: 'qb-a', forecastAt: nba.forecastAt } }],
    workload: [], production: [], matchupText: 'Verified context', availability: 'Conditional' });
  assert.equal(nflPlayer.sections[0].rows[0].value, 'Unavailable');
  assert.equal(nflPlayer.game.homeId, '2');
  assert.equal(nflPlayer.identity, 'nfl-v1 / qb-a');
});
test('Game Plan is absent from every screen while legacy account data cleanup is retained', () => {
  for (const file of ['PlayerLabCards', 'GamewireBot', 'NFLGameSimulation', 'NBAGameSimulation']) {
    const source = readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /SaveResearchButton|MyGamePlan|researchCaptures/);
  }
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /ResearchProvider|ResearchGuide|MyGamePlan/);
  assert.match(readFileSync(new URL('../src/services/deleteAccount.ts', import.meta.url), 'utf8'), /await deleteResearch\(userId\)/);
  assert.ok('Your NFL & NBA Research Hub'.length <= 30);
});
