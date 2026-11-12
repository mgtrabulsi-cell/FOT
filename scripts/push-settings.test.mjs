import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/ProfilePage.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('ProfilePage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PushNotificationSettings');
const code = ts.transpileModule(component.getText(parsed), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function find(node, predicate) {
  if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== 'object') return undefined;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function fixture() {
  const hooks = [], requests = [], calls = [], listeners = new Map();
  let cursor = 0, effects = [], tree;
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({
    exports: {},
    require: () => ({ jsx, jsxs: jsx }), Bell: 'bell', CheckCircle2: 'check', Error,
    console: { error: (...args) => calls.push(['error', ...args]) },
    supportsPushNotifications: () => true, hasPushConfiguration: () => true,
    getPushSettings: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    enablePushNotifications: async () => { calls.push('enable'); },
    disablePushNotifications: async () => { calls.push('disable'); },
    updatePushPreference: async (_user, scores) => { calls.push(['preference', scores]); },
    sendTestPushNotification: async () => {},
    window: { addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener() {} },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useEffect(callback, deps) {
      const index = cursor++, previous = hooks[index];
      if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; });
      }
    },
  });
  vm.runInContext(code, context);
  function render() {
    cursor = 0; effects = [];
    tree = context.PushNotificationSettings({ user: { id: 'member' } });
    effects.forEach(callback => callback());
    return tree;
  }
  render();
  return {
    requests, calls, render, focus: () => listeners.get('focus')(),
    button: label => find(render(), node => node.type === 'button' && node.props.children === label),
    checkbox: () => find(render(), node => node.type === 'input'),
    settings: () => ({ enabled: hooks[3], scores: hooks[4] }),
    text: () => JSON.stringify(render()),
    async settle() { await new Promise(resolve => setImmediate(resolve)); render(); },
  };
}

test('A failed background notification check preserves the last confirmed enabled state and preference', async () => {
  const app = fixture();
  app.requests[0].resolve({ enabled: true, notifyScores: false }); await app.settle();
  app.focus();
  app.requests[1].reject(new Error('Offline')); await app.settle();
  assert.deepEqual(app.settings(), { enabled: true, scores: false });
  assert.match(app.text(), /Could not confirm/);
  assert.ok(app.calls.some(call => call[0] === 'error'));
  assert.ok(!app.calls.includes('disable'));
});
test('A status check started before enabling cannot turn notifications off afterward', async () => {
  const app = fixture();
  app.requests[0].resolve({ enabled: false, notifyScores: true }); await app.settle();
  const enable = app.button('Enable on this device');
  app.focus();
  enable.props.onClick(); await app.settle();
  app.requests[1].resolve({ enabled: false, notifyScores: false }); await app.settle();
  assert.deepEqual(app.settings(), { enabled: true, scores: true });
  assert.match(app.text(), /Notifications enabled/);
  assert.deepEqual(app.calls, ['enable']);
});
test('A stale check cannot undo a saved score-alert preference; overlapping updates are blocked', async () => {
  const app = fixture();
  app.requests[0].resolve({ enabled: true, notifyScores: true }); await app.settle();
  const checkbox = app.checkbox();
  app.focus();
  checkbox.props.onChange({ target: { checked: false } });
  app.focus();
  assert.equal(app.requests.length, 2, 'Focus must not start another status check during a write');
  checkbox.props.onChange({ target: { checked: true } });
  await app.settle();
  app.requests[1].resolve({ enabled: true, notifyScores: true }); await app.settle();
  assert.deepEqual(app.settings(), { enabled: true, scores: false });
  assert.deepEqual(app.calls, [['preference', false]]);
});
test('Only an explicit disable action turns notifications off and stale enabled checks cannot undo it', async () => {
  const app = fixture();
  app.requests[0].resolve({ enabled: true, notifyScores: true }); await app.settle();
  const disable = app.button('Turn off on this device');
  app.focus(); disable.props.onClick(); await app.settle();
  app.requests[1].resolve({ enabled: true, notifyScores: true }); await app.settle();
  assert.equal(app.settings().enabled, false);
  assert.deepEqual(app.calls, ['disable']);
});
