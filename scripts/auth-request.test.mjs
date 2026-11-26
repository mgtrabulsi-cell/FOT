import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture() {
  const timers = new Map();
  let id = 0;
  const context = vm.createContext({
    exports: {}, URL, Request, Response, AbortController, DOMException, Promise, Error,
    console: { error() {} },
    setTimeout: (callback, delay) => { timers.set(++id, { callback, delay }); return id; },
    clearTimeout: key => timers.delete(key),
  });
  vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/services/authRequest.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { ...context.exports, timers };
}
test('Account requests abort at fifteen seconds; non-auth requests remain unchanged', async () => {
  const api = fixture();
  const fetcher = (_input, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const pending = api.createAuthFetch('https://account.example', fetcher)('https://account.example/auth/v1/token');
  const timer = [...api.timers.values()][0];
  assert.equal(timer.delay, 15000);
  timer.callback();
  await assert.rejects(pending, /Account connection timed out/);
  assert.equal(api.timers.size, 0);
  let original;
  const init = { method: 'GET' };
  await api.createAuthFetch('https://account.example', async (_url, options) => { original = options; return new Response('ok'); })('https://account.example/rest/v1/games', init);
  assert.equal(original, init);
  assert.equal(api.timers.size, 0);
});
test('Sign-in deadline releases a pending SDK operation at twenty seconds and cleans timers', async () => {
  const api = fixture();
  const pending = api.withAuthDeadline(new Promise(() => {}));
  const timer = [...api.timers.values()][0];
  assert.equal(timer.delay, 20000);
  timer.callback();
  await assert.rejects(pending, /sign-in connection timed out/);
  assert.equal(api.timers.size, 0);
  assert.equal(await api.withAuthDeadline(Promise.resolve('signed in')), 'signed in');
  assert.equal(api.timers.size, 0);
});
test('Successful account responses retain their JSON and empty logout responses', async () => {
  const api = fixture();
  const authFetch = api.createAuthFetch('https://account.example', async () => Response.json({ success: true }));
  assert.deepEqual(await (await authFetch('https://account.example/auth/v1/token')).json(), { success: true });
  const logout = api.createAuthFetch('https://account.example', async () => new Response(null, { status: 204 }));
  assert.equal((await logout('https://account.example/auth/v1/logout')).status, 204);
});
test('Account transport forwards caller cancellation and clears its deadline', async () => {
  const api = fixture();
  const controller = new AbortController();
  const pending = api.createAuthFetch('https://account.example', (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  }))('https://account.example/auth/v1/token', { signal: controller.signal });
  controller.abort(new Error('Caller cancelled'));
  await assert.rejects(pending, /Caller cancelled/);
  assert.equal(api.timers.size, 0);
});
test('Account deadline remains active while reading the response body', async () => {
  const api = fixture();
  let reading;
  const started = new Promise(resolve => { reading = resolve; });
  const pending = api.createAuthFetch('https://account.example', async (_url, init) => ({
    arrayBuffer: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
      reading();
    }),
  }))('https://account.example/auth/v1/token');
  await started;
  [...api.timers.values()][0].callback();
  await assert.rejects(pending, /Account connection timed out/);
  assert.equal(api.timers.size, 0);
});
