import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('Slow sign-in exposes guest recovery after twelve seconds and cancels its timer on unmount', () => {
  const source = readFileSync(new URL('../src/SplashScreen.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source.replace('import.meta.env.BASE_URL', "'/'"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let slow = false, now = 0, scheduled, cleanup, mounted = false, continued = 0;
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({
    exports: {}, console: { warn() {} },
    require: name => name === 'react' ? {
      useState: () => [slow, value => { slow = value; }],
      useEffect: effect => { if (!mounted) { mounted = true; cleanup = effect(); } },
    } : { jsx, jsxs: jsx },
    window: {
      setTimeout: (fn, delay) => { scheduled = { fn, at: now + delay }; return 1; },
      clearTimeout: id => { assert.equal(id, 1); scheduled = null; },
    },
  });
  vm.runInContext(code, context);
  const render = () => context.exports.default({ onContinueGuest: () => { continued++; } });
  const nodes = tree => [tree, ...[tree.props?.children].flat(Infinity).filter(child => child && typeof child === 'object').flatMap(nodes)];
  assert.ok(!nodes(render()).some(node => node.type === 'button'));
  assert.equal(scheduled.at, 12000);
  now = 11999;
  assert.equal(slow, false);
  now++;
  scheduled.fn();
  const recovery = nodes(render());
  assert.ok(recovery.some(node => node.props?.['aria-label'] === 'Sign-in connection recovery'));
  recovery.find(node => node.type === 'button').props.onClick();
  assert.equal(continued, 1);
  cleanup();
  assert.equal(scheduled, null);
  slow = false; mounted = false;
  render();
  cleanup();
  assert.equal(scheduled, null, 'Leaving before twelve seconds cancels the recovery timer too');
  assert.equal(slow, false);
  assert.doesNotMatch(source, /signOut|removeItem|clear\(/);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<SplashScreen onContinueGuest=/);
  assert.match(app, /<AuthScreen connectionError=\{authRestoreError\}/);
});

test('Rejected session restoration stops loading and explicitly exposes its connection error', async () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect'
      && node.arguments[0]?.getText(parsed).includes('supabase.auth.getSession()')) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(effect);
  const code = ts.transpileModule(`globalThis.boot = ${effect.getText(parsed)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loading = [], messages = [];
  let unsubscribed = false, logged = false;
  const context = vm.createContext({
    supabase: { auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { unsubscribed = true; } } } }),
      getSession: () => Promise.reject(new Error('Backend unavailable')),
    } },
    console: { error() { logged = true; } },
    setAuthLoading: value => loading.push(value), setAuthRestoreError: value => messages.push(value),
    setAuthUser() {}, setRecoveringPassword() {},
    window: { setTimeout: (_callback, delay) => { assert.equal(delay, 18000); return 1; }, clearTimeout() {} },
  });
  test('Pending saved-session restoration leaves loading at eighteen seconds and accepts a late valid session', async () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const parsed = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect'
        && node.arguments[0]?.getText(parsed).includes('supabase.auth.getSession()')) effect = node.arguments[0];
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    const code = ts.transpileModule(`globalThis.boot = ${effect.getText(parsed)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    let timeout, resolveSession, cleared = false;
    const loading = [], messages = [], users = [];
    const context = vm.createContext({
      supabase: { auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: () => new Promise(resolve => { resolveSession = resolve; }),
      } },
      console: { error() {} },
      window: { setTimeout: (callback, delay) => { assert.equal(delay, 18000); timeout = callback; return 1; },
        clearTimeout: () => { cleared = true; } },
      setAuthLoading: value => loading.push(value), setAuthRestoreError: value => messages.push(value),
      setAuthUser: value => users.push(value), setRecoveringPassword() {},
    });
    vm.runInContext(code, context);
    const cleanup = context.boot();
    assert.equal(loading.length, 0);
    timeout();
    assert.equal(loading.at(-1), false);
    assert.match(messages.at(-1), /timed out/);
    const user = { id: 'test-user' };
    resolveSession({ data: { session: { user } }, error: null });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(users.at(-1), user);
    assert.equal(cleared, true);
    cleanup();
  });
  vm.runInContext(code, context);
  const cleanup = context.boot();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loading.at(-1), false);
  assert.match(messages.at(-1), /Could not connect to the sign-in service/);
  assert.equal(logged, true);
  cleanup();
  assert.equal(unsubscribed, true);
});
