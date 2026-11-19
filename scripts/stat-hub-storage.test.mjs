import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/services/renderSnapshots.ts', import.meta.url), 'utf8')
  .replace('import.meta.env?.BASE_URL', "'/'"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const roster = [{ id: '1', name: 'Saved Player', teamId: 'DEN', position: 'C', jersey: '15' }];
const profile = { season: 2027, averages: { points: 25 }, totals: { points: 100 }, games: [
  { id: 'g1', date: '2026-11-18', opponent: 'BOS', result: 'W', score: '100-90', seasonType: 'Regular season', stats: { points: 0, rebounds: 10 } },
] };
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup({ records = new Map(), local = new Map(), saveError = false, load, indexed = true } = {}) {
  const errors = [], changes = [];
  let now = Date.now();
  const storage = { get length() { return local.size; }, key: index => [...local.keys()][index] ?? null,
    getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
  const context = vm.createContext({ exports: {}, localStorage: storage, ...(indexed ? { indexedDB: {} } : {}),
    Date: class extends Date { static now() { return now; } },
    console: { error: (...args) => errors.push(args) },
    require: name => name.includes('draftStorage') ? { createDraftStorage: () => ({
      loadAll: load ?? (async () => structuredClone([...records.values()])),
      save: async (key, entry) => { if (saveError) throw new Error('Quota exceeded'); records.set(key, structuredClone(entry)); },
      clear: async () => { records.clear(); },
    }) } : {},
  });
  vm.runInContext(source, context);
  context.exports.subscribeRenderSnapshots(() => changes.push(true));
  return { ...context.exports, local, records, errors, changes, advance: ms => { now += ms; } };
}
test('Complete player stats survive small-cache eviction and restore on a fresh page without network', async () => {
  const first = setup();
  const complete = { ...profile, providerMetadata: 'x'.repeat(270_000) };
  first.saveRenderSnapshot('nbaProfile', 'profile:1:2027', complete);
  first.saveRenderSnapshot('nbaRoster', 'roster:DEN:2027', roster);
  first.saveRenderSnapshot('details', 'football/nfl:game:2026:IND', { teamForms: [{
    teamId: 'IND', recentGames: [], skillPlayers: [{ id: 'nfl-player', name: 'Saved NFL player', recentGames: [
      { gameId: 'played', stats: { passingYards: 250, interceptions: 0 } },
    ] }],
  }] });
  await flush();
  assert.equal(first.readStatStorageStatus().saving, 0);
  assert.equal(first.records.size, 3);
  first.local.clear();
  const next = setup({ records: first.records });
  await next.restoreStatSnapshots();
  assert.equal(next.readRenderSnapshot('nbaProfile', 'profile:1:2027').providerMetadata.length, 270_000);
  assert.equal(next.readRenderSnapshot('nbaProfile', 'profile:1:2027').games[0].stats.points, 0);
  assert.equal(next.readRenderSnapshot('nbaProfile', 'profile:1:2027').games[0].stats.assists, undefined);
  assert.equal(next.readRenderSnapshot('nbaRoster', 'roster:DEN:2027')[0].name, 'Saved Player');
  assert.equal(next.readRenderSnapshot('details', 'football/nfl:game:2026:IND').teamForms[0].skillPlayers[0].recentGames[0].stats.passingYards, 250);
  assert.equal(next.readRenderSnapshot('nbaProfile', 'profile:1:2028'), null);
  assert.equal(next.readRenderSnapshot('nbaProfile', 'profile:other:2027'), null);
  next.advance(300_001);
  assert.equal(next.readRenderSnapshot('nbaProfile', 'profile:1:2027', 300_000), null);
  assert.ok(next.readRenderSnapshot('nbaProfile', 'profile:1:2027'));
  assert.ok(next.readStatStorageStatus().savedAt > 0);
});
test('Legacy local stats migrate to IndexedDB while unrelated preferences remain untouched', async () => {
  const old = setup({ indexed: false });
  old.saveRenderSnapshot('nbaRoster', 'roster:DEN:2027', roster);
  old.local.set('favorite-preference', 'keep');
  const next = setup({ local: old.local });
  await next.restoreStatSnapshots(); await flush();
  assert.equal(next.records.get('nbaRoster:roster:DEN:2027').data[0].name, 'Saved Player');
  assert.equal(next.local.get('favorite-preference'), 'keep');
});
test('A delayed restore cannot overwrite fresher downloaded stats', async () => {
  let finish;
  const app = setup({ load: () => new Promise(resolve => { finish = resolve; }) });
  const restoring = app.restoreStatSnapshots();
  app.saveRenderSnapshot('nbaProfile', 'profile:1:2027', profile);
  finish([{ kind: 'nbaProfile', key: 'profile:1:2027', version: 1, savedAt: 1, data: { ...profile, averages: { points: 1 } } }]);
  await restoring; await flush();
  assert.equal(app.readRenderSnapshot('nbaProfile', 'profile:1:2027').averages.points, 25);
});
test('Storage failures remain explicit while online-loaded stats remain usable in memory', async () => {
  const app = setup({ saveError: true });
  app.saveRenderSnapshot('nbaProfile', 'profile:1:2027', profile);
  await flush();
  assert.match(app.readStatStorageStatus().error, /could not save/);
  assert.equal(app.readRenderSnapshot('nbaProfile', 'profile:1:2027').averages.points, 25);
  assert.equal(app.readStatStorageStatus().saving, 0);
  assert.ok(app.errors.length);
  const corrupted = setup({ records: new Map([
    ['bad', { kind: 'nbaProfile', key: 'bad', version: 1, savedAt: 1, data: {} }],
    ['good', { kind: 'nbaProfile', key: 'good', version: 1, savedAt: 1, data: profile }],
  ]) });
  await corrupted.restoreStatSnapshots();
  assert.match(corrupted.readStatStorageStatus().error, /could not be restored/);
  assert.equal(corrupted.readRenderSnapshot('nbaProfile', 'bad'), null);
  assert.equal(corrupted.readRenderSnapshot('nbaProfile', 'good').averages.points, 25);
});
test('Restoring stats notifies matching subscribers and account deletion blocks later saves', async () => {
  const app = setup();
  let calls = 0;
  const unsubscribe = app.subscribeRenderSnapshots(() => calls++, { kind: 'nbaProfile' });
  app.saveRenderSnapshot('nbaRoster', 'roster:DEN:2027', roster);
  app.saveRenderSnapshot('nbaProfile', 'profile:1:2027', profile);
  assert.ok(calls > 0);
  const previous = calls;
  unsubscribe();
  app.saveRenderSnapshot('nbaProfile', 'profile:2:2027', profile);
  assert.equal(calls, previous);
  app.stopRenderSnapshots();
  app.saveRenderSnapshot('nbaProfile', 'profile:3:2027', profile);
  await flush();
  assert.equal(app.records.has('nbaProfile:profile:3:2027'), false);
  assert.equal(app.readRenderSnapshot('nbaProfile', 'profile:1:2027'), null);
  await app.clearStatSnapshots();
  assert.equal(app.records.size, 0);
});
