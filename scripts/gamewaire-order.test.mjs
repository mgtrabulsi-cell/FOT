import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as orderHelpers from '../src/services/gamewaireOrder.ts';

const { orderedTopPicks, movePick, pickOrderDate } = orderHelpers;
const picks = Array.from({ length: 7 }, (_, index) => ({
  key: `${index}`, start: '2026-10-28T01:00:00Z', sport: index % 2 ? 'NFL' : 'NBA',
  market: 'h2h', subject: `Team ${index}`, home: 'Home', away: 'Away', probability: 0.6 + index / 100,
}));
test('Editorial order spans sports, ignores removed keys and appends new picks with model ranking without mutating estimates', () => {
  const snapshot = JSON.stringify(picks);
  const orders = [{ game_date: '2026-10-27', pick_keys: ['removed', '0', '1', '2'], revision: 2 }];
  assert.deepEqual(orderedTopPicks(picks, orders).map((pick) => pick.key), ['0', '1', '2', '6', '5', '4', '3']);
  assert.deepEqual(orderedTopPicks(picks.filter((pick) => pick.sport === 'NBA'), orders).map((pick) => pick.key), ['0', '2', '6', '4']);
  assert.deepEqual(orderedTopPicks(picks, [{ ...orders[0], game_date: '2026-10-28' }]).map((pick) => pick.key), ['6', '5', '4', '3', '2', '1', '0']);
  assert.equal(pickOrderDate('2026-10-28T01:00:00Z'), '2026-10-27');
  assert.equal(pickOrderDate('2026-12-01T04:30:00Z'), '2026-11-30');
  assert.equal(JSON.stringify(picks), snapshot);
  assert.deepEqual(movePick(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(movePick(['a', 'b'], 0, -1), ['a', 'b']);
});

const source = readFileSync(new URL('../src/GamewairePickOrder.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
function editor(response = { data: { revision: 1 }, error: null }, props = {}) {
  const states = [], refs = [], calls = [];
  let slot = 0, refSlot = 0, refreshed = 0, notified = 0, hovered = null;
  const rows = new Map(picks.map((pick) => [pick.key, { closest() { return this; } }]));
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, console, Map,
    document: { elementFromPoint: () => hovered },
    window: { innerHeight: 1000, scrollBy() {} }, require(name) {
    if (name === 'react') return { useEffect() {}, useLayoutEffect() {},
      useRef(initial) { const i = refSlot++; return refs[i] ??= { current: initial }; },
      useState(initial) { const i = slot++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
        return [states[i], (value) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; } };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === './services/gamewaireOrder') return orderHelpers;
    if (name === './services/gamewaireOrderRefresh') return { notifyPickOrderSaved() { notified++; } };
    if (name === './services/supabaseClient') return { supabase: { rpc: async (...args) => { calls.push(args); return response; } } };
    return {};
  } });
  vm.runInContext(code, context);
  const nodes = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const render = () => { slot = 0; refSlot = 0; return nodes(context.exports.default({
    picks, date: '2026-10-27', refresh: () => { refreshed++; }, onSave: () => { refreshed++; },
    ...props,
  })); };
  return { render, states, refs, calls, refreshed: () => refreshed, notified: () => notified,
    hover(key) {
      refs[0].current = { querySelectorAll: () => states[0].map((key) => rows.get(key)), setPointerCapture() {} };
      hovered = rows.get(key);
    } };
}
test('Three-line handles support keyboard ordering and save one free revision-checked RPC', async () => {
  const fixture = editor();
  let nodes = fixture.render();
  const handle = nodes.find((node) => node.props?.className === 'gai-order-handle');
  assert.equal(nodes.filter((node) => node.type === 'i').length, 21);
  let prevented = false;
  handle.props.onKeyDown({ key: 'End', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  nodes = fixture.render();
  assert.equal(nodes.filter((node) => node.type === 'li').at(-1).props['data-pick-key'], '6');
  const save = nodes.find((node) => node.type === 'button' && node.props.children === 'Save order · 0 credits');
  assert.equal(save.props.disabled, false);
  save.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0][0], 'gamewaire_save_pick_order');
  assert.deepEqual([...fixture.calls[0][1].ordered_keys], ['5', '4', '3', '2', '1', '0', '6']);
  assert.equal(fixture.calls[0][1].expected_revision, 0);
  assert.equal(fixture.refreshed(), 1);
  assert.equal(fixture.notified(), 1);
  assert.ok(fixture.render().some((node) => node.props?.role === 'status' && node.props.children === 'Order saved for everyone.'));
  assert.doesNotMatch(source, /engineRequest|analyze|gamewaire_publish|fetch\(/);
});
test('Save failures retain draft and surface backend error, pointer cancellation restores pre-drag order', async () => {
  const fixture = editor({ data: null, error: { message: 'Order changed elsewhere' } });
  let nodes = fixture.render();
  let handle = nodes.find((node) => node.props?.className === 'gai-order-handle');
  handle.props.onPointerDown({ button: 0, pointerId: 7, currentTarget: { setPointerCapture() {} } });
  nodes = fixture.render();
  handle = nodes.find((node) => node.props?.className === 'gai-order-handle');
  handle.props.onKeyDown({ key: 'End', preventDefault() {} });
  fixture.render().find((node) => node.type === 'ol').props.onPointerCancel();
  assert.deepEqual([...fixture.states[0]], ['6', '5', '4', '3', '2', '1', '0']);
  nodes = fixture.render();
  nodes.find((node) => node.props?.className === 'gai-order-handle').props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  nodes = fixture.render();
  nodes.find((node) => node.type === 'button' && node.props.children === 'Save order · 0 credits').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.refreshed(), 0);
  assert.equal(fixture.notified(), 0);
  assert.deepEqual([...fixture.states[0]], ['5', '6', '4', '3', '2', '1', '0']);
  assert.ok(fixture.render().some((node) => node.props?.role === 'alert' && node.props.children[0] === 'Order changed elsewhere'));
});
test('Published pick cards reorder inline through filters while saving the complete site-wide order', async () => {
  const fixture = editor(undefined, { visibleKeys: ['0', '2', '4', '6'], renderPick: (pick, rank) => ({ type: 'PickCard', props: { pick, rank } }) });
  let nodes = fixture.render();
  assert.equal(nodes.filter((node) => node.type === 'PickCard').length, 4);
  nodes.find((node) => node.props?.className === 'gai-order-handle').props.onKeyDown({ key: 'End', preventDefault() {} });
  nodes = fixture.render();
  assert.deepEqual(nodes.filter((node) => node.type === 'PickCard').map((node) => node.props.pick.key), ['4', '2', '0', '6']);
  nodes.find((node) => node.type === 'button' && node.props.children === 'Save order · 0 credits').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([...fixture.calls[0][1].ordered_keys], ['5', '4', '3', '2', '1', '0', '6']);
  const page = readFileSync(new URL('../src/Gamewaire.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /<details className="gai-order-tools"/);
  assert.match(page, /renderPick=\{/);
});

test('Successful saves notify mounted panels and other tabs; cleanup removes listeners', () => {
  const raw = readFileSync(new URL('../src/services/gamewaireOrderRefresh.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const listeners = new Map(), writes = [];
  const context = vm.createContext({ exports: {}, Event, console,
    localStorage: { setItem: (...args) => writes.push(args) },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name),
      dispatchEvent: (event) => listeners.get(event.type)?.(event) },
  });
  vm.runInContext(compiled, context);
  let refreshed = 0;
  const cleanup = context.exports.subscribePickOrderRefresh(() => refreshed++);
  context.exports.notifyPickOrderSaved();
  assert.equal(refreshed, 1);
  assert.equal(writes[0][0], 'gamewire-pick-order-updated');
  listeners.get('storage')({ key: writes[0][0] });
  assert.equal(refreshed, 2);
  listeners.get('storage')({ key: 'unrelated' });
  assert.equal(refreshed, 2);
  cleanup();
  assert.equal(listeners.size, 0);
});
test('Touch pointer sorting uses a stable list capture and moves across multiple rows before release', () => {
  const fixture = editor();
  let nodes = fixture.render();
  fixture.hover('3');
  nodes.find((node) => node.props?.className === 'gai-order-handle').props.onPointerDown({
    button: 0, pointerId: 7, pointerType: 'touch',
  });
  nodes = fixture.render();
  nodes.find((node) => node.type === 'ol').props.onPointerMove({ pointerType: 'touch', clientX: 100, clientY: 400 });
  assert.deepEqual([...fixture.states[0]], ['5', '4', '3', '6', '2', '1', '0']);
  fixture.render().find((node) => node.type === 'ol').props.onPointerUp();
  assert.equal(fixture.states[5], null);
});
