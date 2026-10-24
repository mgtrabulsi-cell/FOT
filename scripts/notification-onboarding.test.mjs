import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/NotificationOnboarding.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ''), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup(options = {}) {
  let cursor = 0, tree;
  const hooks = [], effects = [], calls = [], errors = [];
  const user = { id: 'new-user', user_metadata: { notification_onboarding_pending: options.pending ?? true } };
  const element = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({
    exports: {}, require: () => ({ jsx, jsxs: jsx }), Error,
    console: { error: (...args) => errors.push(args) },
    supportsPushNotifications: () => options.supported !== false, hasPushConfiguration: () => true,
    enablePushNotifications: async (...args) => { calls.push(['enable', ...args]); if (options.enableFailure) throw new Error('Permission denied'); },
    supabase: { auth: { updateUser: async (value) => { calls.push(['save', value]); return { error: options.saveFailure ? new Error('Save failed') : null }; } } },
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (value) => { hooks[index] = value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!hooks[index] || !deps.every((value, i) => Object.is(value, hooks[index].deps[i]))) {
        effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: effect() }; });
      }
    },
  });
  vm.runInContext(code, context);
  function render() {
    cursor = 0;
    tree = context.exports.default({ user });
    if (tree?.props.ref) tree.props.ref.current = element;
    effects.splice(0).forEach((effect) => effect());
  }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((child) => nodes(child));
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render();
  return {
    calls, errors, element, render, nodes,
    async click(label) {
      nodes().find((node) => node.type === 'button' && node.props.children === label).props.onClick();
      await new Promise((resolve) => setImmediate(resolve)); render();
    },
  };
}

test('New signup sets pending account metadata; old accounts never prompt', () => {
  const auth = readFileSync(new URL('../src/AuthScreen.tsx', import.meta.url), 'utf8');
  assert.match(auth, /notification_onboarding_pending: true/);
  const app = setup({ pending: false });
  assert.equal(app.nodes().length, 0);
  assert.equal(app.calls.length, 0);
});

test('Welcome uses a modal and never requests permission before an explicit enable click', async () => {
  const app = setup();
  assert.equal(app.element.open, true);
  assert.equal(app.calls.length, 0);
  await app.click('Turn on notifications');
  assert.equal(app.calls[0][0], 'enable');
  assert.equal(app.calls[0][1], 'new-user');
  assert.equal(app.calls[0][2], true);
  assert.equal(app.calls[1][1].data.notification_onboarding_pending, false);
  assert.equal(app.nodes().length, 0);
  assert.equal(app.element.open, false);
});

test('Not now saves the dismissal without enabling push; unsupported devices explain availability', async () => {
  const app = setup();
  await app.click('Not now');
  assert.deepEqual(app.calls.map((call) => call[0]), ['save']);
  const unsupported = setup({ supported: false });
  assert.equal(unsupported.nodes().some((node) => node.props?.children === 'Turn on notifications'), false);
  await unsupported.click('Continue');
  assert.deepEqual(unsupported.calls.map((call) => call[0]), ['save']);
});

test('Permission and account-save failures retain prompt and allow retry without repeating successful enable', async () => {
  const denied = setup({ enableFailure: true });
  await denied.click('Turn on notifications');
  assert.equal(denied.calls.length, 1);
  assert.equal(denied.nodes().some((node) => node.props?.role === 'alert'), true);
  const options = { saveFailure: true };
  const app = setup(options);
  await app.click('Turn on notifications');
  assert.equal(app.nodes().some((node) => node.props?.role === 'alert'), true);
  options.saveFailure = false;
  await app.click('Finish setup');
  assert.deepEqual(app.calls.map((call) => call[0]), ['enable', 'save', 'save']);
  assert.equal(app.nodes().length, 0);
});
