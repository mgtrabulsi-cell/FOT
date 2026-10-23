import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/useSiteOpenTracking.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('Tracking gates auth resolution, separates guests, deduplicates sessions and counts long resumes', async () => {
  const storage = new Map(), calls = [], listeners = new Map(), failures = [];
  let now = 1000, fail = false, cleanup;
  const context = vm.createContext({
    exports: {}, useEffect: (effect) => { cleanup = effect(); },
    supabase: { rpc: async (...args) => { calls.push(args); return { error: fail ? new Error('Unavailable') : null }; } },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => 'guest-session' }, Date: { now: () => now },
    console: { warn: (...args) => failures.push(args), error: (...args) => failures.push(args) },
    document: { visibilityState: 'visible', addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name) => listeners.delete(name) },
  });
  vm.runInContext(compiled, context);
  const mount = async (id, enabled = true) => {
    context.exports.useSiteOpenTracking(id, enabled);
    await new Promise((resolve) => setImmediate(resolve));
  };
  await mount(null, false);
  assert.equal(calls.length, 0);
  await mount(null);
  assert.equal(calls[0][0], 'record_guest_site_open');
  assert.equal(calls[0][1].guest_session, 'guest-session');
  cleanup();
  await mount(null);
  assert.equal(calls.length, 1);
  context.document.visibilityState = 'hidden'; listeners.get('visibilitychange')();
  now += 31 * 60000;
  context.document.visibilityState = 'visible'; listeners.get('visibilitychange')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  cleanup();
  fail = true;
  await mount('member');
  assert.equal(calls.at(-1)[0], 'record_site_open');
  assert.equal(storage.has('gamewire-site-open:member'), false);
  assert.equal(failures.length, 1);
  cleanup();
  fail = false;
  await mount('member');
  assert.equal(storage.has('gamewire-site-open:member'), true);
  cleanup();
});
