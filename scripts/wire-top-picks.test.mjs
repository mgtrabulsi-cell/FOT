import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { orderedTopPicks, publishedSelections, wirePickLimit } from '../src/services/gamewaireOrder.ts';

const source = readFileSync(new URL('../src/WireTopPicks.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function render(reports, props, orders = [], leans = []) {
  let slot = 0;
  const states = [reports, true, '', 0, orders, leans], jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, console, Set, require(name) {
    if (name === 'react') return { useEffect() {}, useState: () => [states[slot++], () => {}] };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === './Gamewaire') return { PickCard: 'PickCard' };
    if (name === './services/gamewaireOrder') return { orderedTopPicks, publishedSelections, wirePickLimit };
    return {};
  } });
  vm.runInContext(code, context);
  const tree = context.exports.default(props);
  const nodes = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  return nodes(tree);
}
test('Wire shows exactly three mobile / five desktop picks, matching only unfinished games and saved order', () => {
  const picks = Array.from({ length: 6 }, (_, index) => ({
    key: String(index), start: '2026-10-27T23:00:00Z', sport: 'NBA', market: 'h2h', probability: 0.6 + index / 100, ev: 0.1,
    identifiers: { espnEventId: 'live' },
  }));
  const reports = [{ picks: [...picks, { ...picks[0], key: 'finished', identifiers: { espnEventId: 'final' } },
    { ...picks[0], key: 'other', identifiers: { espnEventId: 'other' } }] }];
  const props = { sport: 'NBA', userId: 'member', desktop: true, games: [{ eventId: 'live', status: 'LIVE' }, { eventId: 'final', status: 'FINAL' }] };
  const nodes = render(reports, props);
  const cards = nodes.filter((node) => node.type === 'PickCard');
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map((card) => card.props.pick.key), ['5', '4', '3', '2', '1']);
  const orders = [{ game_date: '2026-10-27', pick_keys: ['0', '2', '1', '3', '4', '5'], revision: 1 }];
  for (const desktop of [false, true]) {
    const displayed = render(reports, { ...props, desktop }, orders).filter((node) => node.type === 'PickCard');
    assert.deepEqual(displayed.map((card) => card.props.pick.key), ['0', '2', '1', '3', '4'].slice(0, desktop ? 5 : 3));
  }
  assert.ok(nodes.some((node) => node.type === 'a' && node.props.href === '#gamewaire'));
  assert.equal(render([], { sport: 'NBA', games: [] }).filter((node) => node.type === 'PickCard').length, 0);
  assert.doesNotMatch(source, /engineRequest|loadEngineHistory|gamewaire_runs/);
  assert.match(source, /gamewaire_team_leans/);
});
test('Wire includes published leans in the shared order and limit, deduplicates Top Pick keys and excludes finished games', () => {
  const pick = { key: 'top', start: '2026-10-28T23:00:00Z', sport: 'NBA', market: 'h2h', probability: 0.6,
    identifiers: { espnEventId: 'live' } };
  const lean = { ...pick, key: 'lean' };
  const leans = [lean, pick, { ...lean, key: 'final', identifiers: { espnEventId: 'final' } }].map((pick) => ({ team_lean: { pick } }));
  const props = { sport: 'NBA', userId: 'member', desktop: false, games: [{ eventId: 'live', status: 'LIVE' }, { eventId: 'final', status: 'FINAL' }] };
  const cards = render([{ picks: [pick] }], props, [{ game_date: '2026-10-28', pick_keys: ['lean', 'top'] }], leans)
    .filter((node) => node.type === 'PickCard');
  assert.deepEqual(cards.map((card) => card.props.pick.key), ['lean', 'top']);
  assert.deepEqual(cards.map((card) => card.props.lean), [true, false]);
});
test('Wire panels load on desktop or inside an explicitly expanded mobile disclosure', () => {
  const wrapper = readFileSync(new URL('../src/WireWithPicks.tsx', import.meta.url), 'utf8');
  assert.match(wrapper, /matchMedia\('\(min-width: 1100px\)'\)/);
  assert.match(wrapper, /desktop && panel/);
  assert.match(wrapper, /expanded && panel/);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<WireWithPicks games=\{nbaGames\} sport="NBA"/);
  assert.match(app, /<WireWithPicks games=\{games\} sport="NFL"/);
});

test('Mobile Top Picks start collapsed, mount only on expansion and unmount on collapse', () => {
  const wrapper = readFileSync(new URL('../src/WireWithPicks.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(wrapper, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  for (const desktop of [false, true]) {
    const state = [desktop, false];
    let slot = 0;
    const jsx = (type, props) => ({ type, props });
    const context = vm.createContext({ exports: {}, require(name) {
      if (name === 'react') return { lazy: () => 'WireTopPicks', Suspense: 'Suspense', useEffect() {},
        useState: () => { const index = slot++; return [state[index], (value) => { state[index] = value; }]; } };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      return {};
    } });
    vm.runInContext(compiled, context);
    const render = () => { slot = 0; return context.exports.default({ children: 'Scores', games: [], sport: 'NBA' }); };
    const nodes = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
      ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
    let tree = nodes(render());
    assert.equal(tree.filter((node) => node.type === 'WireTopPicks').length, desktop ? 1 : 0);
    if (desktop) {
      assert.equal(tree.find((node) => node.type === 'WireTopPicks').props.desktop, true);
      assert.equal(tree.filter((node) => node.type === 'details').length, 0);
      continue;
    }
    const disclosure = tree.find((node) => node.type === 'details');
    assert.equal(disclosure.props.open, undefined, 'Native disclosure starts closed');
    disclosure.props.onToggle({ currentTarget: { open: true } });
    tree = nodes(render());
    assert.equal(tree.filter((node) => node.type === 'WireTopPicks').length, 1);
    assert.equal(tree.find((node) => node.type === 'WireTopPicks').props.desktop, false);
    assert.ok(tree.findIndex((node) => node.type === 'summary') < tree.findIndex((node) => node.props?.className === 'wire-score-content'));
    disclosure.props.onToggle({ currentTarget: { open: false } });
    assert.equal(nodes(render()).filter((node) => node.type === 'WireTopPicks').length, 0);
  }
});
