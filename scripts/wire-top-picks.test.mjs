import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { rankTopPicks } from '../supabase/functions/_shared/gamewaire.ts';

const source = readFileSync(new URL('../src/WireTopPicks.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function render(reports, props) {
  let slot = 0;
  const states = [reports, true, '', 0], jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, console, Set, require(name) {
    if (name === 'react') return { useEffect() {}, useState: () => [states[slot++], () => {}] };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === './Gamewaire') return { PickCard: 'PickCard' };
    if (name === './services/gamewaire') return { rankTopPicks };
    return {};
  } });
  vm.runInContext(code, context);
  const tree = context.exports.default(props);
  const nodes = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  return nodes(tree);
}
test('Wire sidebar shows only published picks matching unfinished scoreboard games and ranks at most four', () => {
  const picks = Array.from({ length: 6 }, (_, index) => ({
    key: String(index), sport: 'NBA', market: 'h2h', probability: 0.6 + index / 100, ev: 0.1,
    identifiers: { espnEventId: 'live' },
  }));
  const reports = [{ picks: [...picks, { ...picks[0], key: 'finished', identifiers: { espnEventId: 'final' } },
    { ...picks[0], key: 'other', identifiers: { espnEventId: 'other' } }] }];
  const nodes = render(reports, { sport: 'NBA', userId: 'member', games: [{ eventId: 'live', status: 'LIVE' }, { eventId: 'final', status: 'FINAL' }] });
  const cards = nodes.filter((node) => node.type === 'PickCard');
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((card) => card.props.pick.key), ['5', '4', '3', '2']);
  assert.ok(nodes.some((node) => node.type === 'a' && node.props.href === '#gamewaire'));
  assert.equal(render([], { sport: 'NBA', games: [] }).filter((node) => node.type === 'PickCard').length, 0);
  assert.doesNotMatch(source, /engineRequest|loadEngineHistory|gamewaire_runs|gamewaire_team_leans/);
});
test('Wire panels are gated to desktop before lazy loading or requesting published picks', () => {
  const wrapper = readFileSync(new URL('../src/WireWithPicks.tsx', import.meta.url), 'utf8');
  assert.match(wrapper, /matchMedia\('\(min-width: 1100px\)'\)/);
  assert.match(wrapper, /desktop && <Suspense/);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<WireWithPicks games=\{nbaGames\} sport="NBA"/);
  assert.match(app, /<WireWithPicks games=\{games\} sport="NFL"/);
});
