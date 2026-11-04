import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/NotificationBell.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
async function click({ supported = true, permission = 'granted', signedIn = true, failure = false } = {}) {
  const calls = [], states = [];
  let slot = 0;
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, Error, Notification: {
    requestPermission() { calls.push('permission'); return Promise.resolve(permission); },
  }, require(name) {
    if (name === 'react') return { useState(initial) { const i = slot++; states[i] = initial; return [initial, (value) => { states[i] = value; }]; } };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === './services/pushNotifications') return {
      supportsPushNotifications: () => supported,
      async enablePushNotifications(...args) { calls.push(args); if (failure) throw new Error('Subscription failed'); },
    };
    if (name === './services/supabaseClient') return { supabase: { auth: { async getSession() {
      calls.push('account'); return { data: { session: signedIn ? { user: { id: 'member' } } : null }, error: null };
    } } } };
    return {};
  } });
  vm.runInContext(code, context);
  const tree = context.exports.default();
  assert.equal(calls.length, 0, 'No permission request without a click');
  tree.props.children[0].props.onClick({ stopPropagation() { calls.push('stop'); } });
  await new Promise((resolve) => setImmediate(resolve));
  return { calls, states };
}
test('Bell requests permission from click and enables posts plus favorite score alerts', async () => {
  const { calls, states } = await click();
  assert.deepEqual(calls, ['stop', 'permission', 'account', ['member', true]]);
  assert.equal(states[1], true);
  assert.match(states[2], /Notifications enabled/);
});
test('Unsupported, denied, signed-out and failed subscriptions show explicit errors', async () => {
  for (const options of [{ supported: false }, { permission: 'denied' }, { signedIn: false }, { failure: true }]) {
    const { states } = await click(options);
    assert.equal(states[1], false);
    assert.equal(states[3], true);
    assert.ok(states[2]);
  }
});
