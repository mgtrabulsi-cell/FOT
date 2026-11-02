import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/favoritePersistence.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText, { exports, console: { error() {} }, Set, JSON, Error });
const { FavoritePersistence, mergeFavoriteChanges, readFavorites } = exports;
const a = { key: 'nfl:1', id: '1', type: 'team', feedPath: 'football/nfl', name: 'Team A' };
const b = { ...a, key: 'nba:1', feedPath: 'basketball/nba', name: 'Team B' };
const c = { ...a, key: 'nfl:2', id: '2', name: 'Team C' };
const tick = () => new Promise(setImmediate);
const snapshot = (favorites, version = 1) => ({ favorites, updatedAt: `2026-11-02T01:00:00.00${version}Z` });
function fixture({ initial = snapshot([a]), storage = new Map(), read, write, userId = 'account-a' } = {}) {
  let cloud = initial, writes = 0, ready = false, shown = [], message = '';
  const store = new FavoritePersistence({
    userId,
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    read: read ?? (async () => cloud),
    write: async (...args) => {
      writes++;
      if (write) return write(...args);
      cloud = snapshot(args[0], writes + 1);
      return cloud;
    },
    changed: (favorites, loaded) => { shown = favorites; ready = loaded; },
    error: (error) => { message = error; },
  });
  return { store, storage, cloud: () => cloud, writes: () => writes, ready: () => ready,
    shown: () => Array.from(shown), message: () => message };
}
test('Loading saved favorites (including empty/no row) never writes the cloud', async () => {
  for (const initial of [snapshot([a]), snapshot([]), null]) {
    const f = fixture({ initial });
    await f.store.load();
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.shown(), initial?.favorites ?? []);
    assert.equal(f.ready(), true);
  }
});
test('Rapid edits serialize saves; an older request cannot arrive after a newer full list', async () => {
  const pending = [];
  const f = fixture({ write: (favorites) => new Promise((resolve) => pending.push({ favorites, resolve })) });
  await f.store.load();
  f.store.change((favorites) => [...favorites, b]);
  f.store.change((favorites) => [...favorites, c]);
  f.store.change((favorites) => favorites.filter((item) => item.key !== a.key));
  assert.equal(f.writes(), 1);
  assert.deepEqual(Array.from(pending[0].favorites), [a, b]);
  pending[0].resolve(snapshot(pending[0].favorites, 2));
  await tick();
  assert.equal(f.writes(), 2);
  assert.deepEqual(Array.from(pending[1].favorites), [b, c]);
  pending[1].resolve(snapshot(pending[1].favorites, 3));
  await tick();
  assert.equal(f.writes(), 2);
  assert.equal(JSON.parse([...f.storage.values()][0]).pending, false);
});
test('Failed saves retain the device draft; a reload safely retries the pending changes', async () => {
  const f = fixture({ write: async () => { throw new Error('Offline'); } });
  await f.store.load();
  f.store.change((favorites) => [...favorites, b]);
  await tick();
  assert.deepEqual(f.shown(), [a, b]);
  assert.match(f.message(), /have not synced/);
  assert.equal(JSON.parse([...f.storage.values()][0]).pending, true);
  f.store.stop();
  const reopened = fixture({ storage: f.storage });
  await reopened.store.load();
  assert.deepEqual(reopened.cloud().favorites, [a, b]);
  assert.equal(reopened.writes(), 1);
});
test('Cloud-load failure shows the account backup without allowing edits or writing an empty list', async () => {
  const saved = fixture();
  await saved.store.load();
  const f = fixture({ storage: saved.storage, read: async () => { throw new Error('Feed unavailable'); } });
  await f.store.load();
  assert.deepEqual(f.shown(), [a]);
  assert.equal(f.ready(), false);
  f.store.change(() => []);
  assert.deepEqual(f.shown(), [a]);
  assert.equal(f.writes(), 0);
  assert.match(f.message(), /could not be verified/);
});
test('Each account has a separate backup and never inherits another account or guest favorites', async () => {
  const storage = new Map([['fieldhouse:favorites:v1', JSON.stringify([c])]]);
  const one = fixture({ storage }); await one.store.load();
  const two = fixture({ storage, userId: 'account-b', initial: null }); await two.store.load();
  assert.deepEqual(two.shown(), []);
  assert.deepEqual(JSON.parse(storage.get('gamewire:favorites:account:v1:account-a')).favorites, [a]);
  assert.deepEqual(JSON.parse(storage.get('fieldhouse:favorites:v1')), [c]);
});
test('A stopped account cannot publish late load results or start another save', async () => {
  let resolve;
  const f = fixture({ read: () => new Promise((done) => { resolve = done; }) });
  const loading = f.store.load();
  f.store.stop(); resolve(snapshot([a])); await loading;
  assert.deepEqual(f.shown(), []);
  assert.equal(f.ready(), false);
  f.store.change(() => [a]);
  assert.equal(f.writes(), 0);
});
test('Conflicting cloud saves merge only local additions/removals without clearing other-device favorites', async () => {
  const writes = [], server = snapshot([a, c], 2);
  let reads = 0;
  const f = fixture({
    read: async () => ++reads === 1 ? snapshot([a]) : server,
    write: async (favorites, base) => {
      writes.push({ favorites: Array.from(favorites), base });
      return writes.length === 1 ? null : snapshot(favorites, 3);
    },
  });
  await f.store.load();
  f.store.change((favorites) => [...favorites, b]);
  await tick(); await tick();
  assert.deepEqual(writes[1].favorites, [a, c, b]);
  assert.equal(writes[1].base.updatedAt, server.updatedAt);
  assert.deepEqual(f.shown(), [a, c, b]);
});
test('Concurrent first-row creation merges additions rather than replacing the newly created row', async () => {
  let reads = 0, writes = 0;
  const f = fixture({ read: async () => ++reads === 1 ? null : snapshot([c]),
    write: async (favorites) => ++writes === 1 ? null : snapshot(favorites) });
  await f.store.load();
  f.store.change(() => [a]); await tick(); await tick();
  assert.deepEqual(f.shown(), [c, a]);
});
test('Merge keeps explicit removals and reorders known teams without deleting unrelated remote additions', () => {
  assert.deepEqual(Array.from(mergeFavoriteChanges([a, b, c], [a, b], [b])), [b, c]);
  assert.deepEqual(Array.from(mergeFavoriteChanges([a, c, b], [a, b], [b, a])), [b, c, a]);
  assert.deepEqual(Array.from(mergeFavoriteChanges([b, a], [a, b], [a, b, c])), [b, a, c],
    'no local reorder means a remote reorder is preserved');
});
test('Malformed saved payloads fail explicitly rather than silently dropping favorites', () => {
  for (const value of [null, {}, [a, { id: 'broken' }]]) assert.throws(() => readFavorites(value), /malformed/);
});
test('Retry recovers failed initial load without any automatic cloud rewrite', async () => {
  let fail = true;
  const f = fixture({ read: async () => { if (fail) throw new Error('Unavailable'); return snapshot([a]); } });
  await f.store.load(); fail = false; await f.store.retry();
  assert.deepEqual(f.shown(), [a]);
  assert.equal(f.writes(), 0);
});
test('Browser storage failure is explicit but does not prevent a verified cloud save', async () => {
  let saved = false, error = '';
  const store = new FavoritePersistence({
    userId: 'one', storage: { getItem: () => null, setItem() { throw new Error('Quota'); } },
    read: async () => snapshot([a]),
    write: async (favorites) => { saved = true; return snapshot(favorites); },
    changed() {}, error: (message) => { error = message; },
  });
  await store.load(); store.change(() => [a, b]); await tick();
  assert.equal(saved, true);
  assert.match(error, /could not be backed up/);
});
test('App uses revision-checked writes, explicit retries and gates edits while favorites are loading', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /from\('user_favorites'\)\.upsert/);
  assert.match(app, /\.eq\('updated_at', base\.updatedAt\)\.eq\('favorites', JSON\.stringify\(base\.favorites\)\)/);
  assert.match(app, /Retry favorites sync/);
  assert.match(app, /favoritePersistence\.current\?\.change\(reorder\)/);
});
test('Pending removal survives reopening and retains favorites added remotely while disconnected', async () => {
  const f = fixture({ initial: snapshot([a, b]), write: async () => { throw new Error('Connection lost'); } });
  await f.store.load();
  f.store.change((favorites) => favorites.filter((item) => item.key !== a.key));
  await tick(); f.store.stop();
  const reopened = fixture({ initial: snapshot([a, b, c], 2), storage: f.storage });
  await reopened.store.load();
  assert.deepEqual(reopened.cloud().favorites, [b, c]);
});
test('Repeated concurrent edits are bounded and retain a pending backup for explicit retry', async () => {
  const f = fixture({ write: async () => null });
  await f.store.load(); f.store.change(() => [a, b]);
  await tick(); await tick();
  assert.equal(f.writes(), 4);
  assert.equal(JSON.parse([...f.storage.values()][0]).pending, true);
  assert.match(f.message(), /have not synced/);
});
test('Stopping during a save prevents late callbacks and retains the pending draft for the next login', async () => {
  let resolve;
  const f = fixture({ write: (favorites) => new Promise((done) => { resolve = () => done(snapshot(favorites)); }) });
  await f.store.load(); f.store.change(() => [a, b]); f.store.stop(); resolve(); await tick();
  assert.equal(JSON.parse([...f.storage.values()][0]).pending, true);
  assert.deepEqual(f.shown(), [a, b]);
});
test('Real App cloud adapter checks timestamp AND content, treats collisions as conflicts and rejects malformed reads', async () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let options;
  function visit(node) {
    if (ts.isNewExpression(node) && node.expression.getText(parsed) === 'FavoritePersistence') options = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  let response, calls = [];
  const chain = new Proxy({}, { get(_, method) { return (...args) => {
    calls.push([method, ...args]);
    return method === 'single' || method === 'maybeSingle' ? Promise.resolve(response) : chain;
  }; } });
  const context = vm.createContext({ Date, Math, JSON, Error, AbortSignal, readFavorites, userId: 'account-a',
    client: { from(name) { calls.push(['from', name]); return chain; } } });
  const get = (name) => {
    const expression = options.properties.find((property) => property.name.getText(parsed) === name).initializer.getText(parsed);
    return vm.runInContext(ts.transpileModule(`(${expression})`, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    } }).outputText, context);
  };
  const write = get('write'), read = get('read'), base = snapshot([a]);
  response = { data: null, error: null };
  assert.equal(await write([a, b], base), null);
  assert.ok(calls.some(([method, key, value]) => method === 'eq' && key === 'updated_at' && value === base.updatedAt));
  assert.ok(calls.some(([method, key, value]) => method === 'eq' && key === 'favorites' && value === JSON.stringify([a])));
  assert.ok(calls.some(([method]) => method === 'abortSignal'));
  response = { data: null, error: { code: '23505' } };
  assert.equal(await write([b], null), null);
  response = { data: null, error: { code: '403', message: 'Permission denied' } };
  await assert.rejects(write([b], base), (error) => error.message === 'Permission denied');
  response = { data: { favorites: {}, updated_at: base.updatedAt }, error: null };
  await assert.rejects(read(), /malformed/);
  response = { data: { favorites: [a], updated_at: base.updatedAt }, error: null };
  assert.deepEqual({ ...await read() }, base);
});
