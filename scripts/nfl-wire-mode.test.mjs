import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as sports from '../src/services/sportsData.ts';
import * as nflSituation from '../src/services/nflSituation.ts';

const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const game = { id: 'NFL:123', eventId: '123', feedPath: 'football/nfl', sport: 'Football', league: 'NFL',
  status: 'UPCOMING', date: new Date(Math.floor(Date.now() / 1000) * 1000 + 86400000).toISOString(), seasonYear: 2026, venue: 'Fixture stadium',
  away: { id: '1', name: 'Away Team', abbr: 'AWY', score: 0, color: '#112233' },
  home: { id: '2', name: 'Home Team', abbr: 'HOM', score: 0, color: '#112233' } };
const snapshot = { status: 'ready', eventId: game.eventId, kickoff: game.date.replace('.000Z', 'Z'), scenarios: [{
  id: 'fixture', issue: null, home: { id: '2', score: { mean: 28.2 } }, away: { id: '1', score: { mean: 21.7 } },
}, { id: 'backup', issue: null, home: { id: '2', score: { mean: 30.2 } }, away: { id: '1', score: { mean: 14.7 } } },
{ id: 'unsupported', issue: 'Insufficient QB evidence', home: null, away: null }] };
function hooks() {
  const state = [], effects = [];
  let slot = 0;
  return { state, effects, reset() { slot = 0; effects.length = 0; }, react: {
    useState(initial) { const index = slot++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useRef(initial) { const index = slot++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect: effect => effects.push(effect),
  } };
}
const elements = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(elements)
  : [node, ...elements(node.props?.children)];
test('Wire toggle shows simulated scores, opens the simulation directly, and restores normal pregame/live views', () => {
  const h = hooks(), jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, window: { scrollTo() {} }, console, require(name) {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('sportsData')) return sports;
    if (name.includes('nflSituation')) return nflSituation;
    if (name.includes('useNFLBoardSimulations')) return { useNFLBoardSimulations: () => ({ simulations: { [game.eventId]: snapshot }, errors: {}, rememberSimulation() {} }) };
    if (name.includes('NFLGameSimulation')) return { default: 'SimulationPanel' };
    if (name.includes('useSwipeBack')) return { useSwipeBack: () => ({ current: null }) };
    if (name.includes('uiScale')) return { getInterfaceScale: () => 1 };
    if (name.includes('usePublicDataRevision')) return { usePublicDataRevision: () => 0 };
    if (name.includes('renderSnapshots')) return { readRenderSnapshot: () => null, teamSnapshotKey: () => 'fixture' };
    if (name.includes('teamComparisonRanks')) return { teamComparisonMetrics: [] };
    return { default: () => null };
  } });
  vm.runInContext(compile('../src/TheWire.tsx'), context);
  const props = { games: [game], query: '', favorites: [], featuredFavoriteTeamId: null, onToggleFavorite() {}, onOpenPlayer() {} };
  const render = () => { h.reset(); return elements(context.exports.default(props)); };
  let tree = render();
  const toggle = label => tree.find(node => node.type === 'button' && node.props.children === label);
  assert.equal(toggle('Pregame stats').props['aria-pressed'], true);
  assert.ok(tree.some(node => node.type === 'li' && node.props.className === 'notification-game-card'));
  toggle('GamewAIre simulations').props.onClick(); tree = render();
  assert.equal(toggle('GamewAIre simulations').props['aria-pressed'], true);
  assert.ok(tree.some(node => node.type === 'li' && node.props.className === 'notification-game-card is-simulation-game'));
  assert.deepEqual(tree.filter(node => node.props.className === 'wire-board-score').map(node => node.props.children), [22, 28]);
  tree.find(node => node.props['data-game-id'] === game.id).props.onClick(); tree = render();
  const panel = tree.find(node => node.type === 'SimulationPanel');
  assert.equal(panel.props.game.eventId, game.eventId); assert.equal(panel.props.initialSimulation, snapshot);
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '22 – 28'));
  panel.props.onScenarioChange('backup'); tree = render();
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '15 – 30'));
  panel.props.onScenarioChange('unsupported'); tree = render();
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '— – —'));
  toggle('Pregame stats').props.onClick(); tree = render();
  assert.ok(!tree.some(node => node.type === 'SimulationPanel'));
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === 'vs'));
  props.games = [{ ...game, status: 'LIVE', away: { ...game.away, score: 12 }, home: { ...game.home, score: 17 } }];
  tree = render(); toggle('GamewAIre simulations').props.onClick(); tree = render();
  assert.ok(!tree.some(node => node.type === 'SimulationPanel'));
  assert.ok(tree.some(node => node.props.value === 12) && tree.some(node => node.props.value === 17));
});
test('Scoreboard simulation loading is bounded, preserves saved results on failure and stops on cleanup', async () => {
  const h = hooks(), timers = new Map();
  let nextTimer = 0, active = 0, peak = 0, fail = false;
  const context = vm.createContext({ exports: {}, AbortController, Error, console: { error() {} }, window: {
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
  }, require(name) {
    if (name === 'react') return h.react;
    return { loadGameSimulation: async game => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve)); active--;
      if (fail) throw new Error('Offline');
      return { ...snapshot, eventId: game.eventId, kickoff: game.date };
    } };
  } });
  vm.runInContext(compile('../src/useNFLBoardSimulations.ts'), context);
  const games = Array.from({ length: 7 }, (_, i) => ({ ...game, eventId: String(i) }));
  context.exports.useNFLBoardSimulations(games, true);
  const stop = h.effects[0]();
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(peak, 3); assert.equal(Object.keys(h.state[0]).length, 7);
  fail = true; const [id, reload] = [...timers][0]; timers.delete(id); reload();
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state[0]['0'].status, 'ready'); assert.equal(h.state[1]['0'], 'Offline');
  stop(); assert.equal(timers.size, 0);
});
