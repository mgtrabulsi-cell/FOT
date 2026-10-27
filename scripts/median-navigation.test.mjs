import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { connectMedianNavigation, hashForView, viewFromHash } from '../src/services/medianNavigation.ts';

test('section routes and nested notification links preserve their destination', () => {
  for (const [view, hash] of [['Wire', '#wire'], ['Players', '#stat-hub'], ['Analyst', '#analyst-desk'], ['Gamewaire', '#gamewaire'], ['LiveWire', '#livewire'], ['Den', '#locker-room'], ['Profile', '#profile']]) {
    assert.equal(viewFromHash(hash), view);
    assert.equal(hashForView(view, '#unknown'), hash);
  }
  for (const [view, hash] of [['Wire', '#wire/game/123'], ['LiveWire', '#livewire/post/11111111-1111-4111-8111-111111111111'], ['Analyst', '#analyst-desk/story/11111111-1111-4111-8111-111111111111']]) {
    assert.equal(viewFromHash(hash), view);
    assert.equal(hashForView(view, hash), hash);
  }
  assert.equal(viewFromHash('#stat-hub-invalid'), null);
});

test('mobile navigation stays outside scaled app content and tracks visible viewport changes with cleanup', () => {
  const source = ts.transpileModule(readFileSync(new URL('../src/PrimaryNavigation.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const listeners = new Map(), viewportListeners = new Map(), effects = [], cleanups = [], styles = new Map();
  const viewport = { height: 800, offsetTop: 0, addEventListener: (type, fn) => viewportListeners.set(type, fn), removeEventListener: (type) => viewportListeners.delete(type) };
  const window = { innerHeight: 800, visualViewport: viewport,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (type, fn) => { const set = listeners.get(type) ?? new Set(); set.add(fn); listeners.set(type, set); },
    removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn); },
  };
  const body = {};
  const element = { style: { setProperty: (key, value) => styles.set(key, value), removeProperty: (key) => styles.delete(key) } };
  const jsx = (type, props) => { if (props.ref) props.ref.current = element; return { type, props }; };
  const context = vm.createContext({ exports: {}, window, document: { body }, require(name) {
    if (name === 'react') return { useRef: () => ({ current: null }), useState: (fn) => [fn(), () => {}], useEffect: (fn) => effects.push(fn) };
    if (name === 'react/jsx-runtime') return { jsx };
    if (name === 'react-dom') return { createPortal: (node, target) => ({ node, target }) };
    return {};
  } });
  vm.runInContext(source, context);
  const portal = context.exports.default({ children: 'tabs' });
  assert.equal(portal.target, body);
  assert.match(portal.node.props.className, /primary-nav-mobile/);
  effects.forEach((fn) => cleanups.push(fn()));
  assert.equal(styles.get('--navigation-bottom'), '0px');
  viewport.height = 650; viewportListeners.get('resize')();
  assert.equal(styles.get('--navigation-bottom'), '150px');
  viewport.offsetTop = 50; viewportListeners.get('scroll')();
  assert.equal(styles.get('--navigation-bottom'), '100px');
  viewport.height = 850; listeners.get('pageshow').forEach((fn) => fn());
  assert.equal(styles.get('--navigation-bottom'), '0px', 'Overscroll never produces a negative bottom inset');
  cleanups.forEach((fn) => fn());
  assert.equal(viewportListeners.size, 0);
  assert.ok([...listeners.values()].every((set) => set.size === 0));
  assert.equal(styles.size, 0);
});

test('native tabs stay disabled on immediate and delayed bridge readiness; browsers are unchanged', () => {
  const originals = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const classes = new Set();
  const calls = [];
  let previousReadyCalls = 0;
  const previousReady = () => previousReadyCalls++;
  const window = { median_library_ready: previousReady };
  const navigator = { userAgent: 'Mobile median' };
  const document = { documentElement: { classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } } };
  for (const [key, value] of Object.entries({ window, navigator, document })) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const stop = connectMedianNavigation();
    assert.equal(classes.size, 0);
    window.median = { tabNavigation: {
      setTabs: value => calls.push(['set', value]),
    } };
    window.median_library_ready();
    assert.equal(previousReadyCalls, 1);
    assert.equal(classes.size, 0);
    assert.deepEqual(calls, [['set', { enabled: false }]]);
    stop();
    assert.equal(window.median_library_ready, previousReady);
    connectMedianNavigation()();
    assert.deepEqual(calls.at(-1), ['set', { enabled: false }]);
    assert.equal(calls.length, 2);
    assert.equal(classes.size, 0);
    navigator.userAgent = 'Mobile Safari';
    const count = calls.length;
    connectMedianNavigation()();
    assert.equal(calls.length, count);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
