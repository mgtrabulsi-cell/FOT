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
test('Mobile box-score identities use full-width rows without an unused score column or broken words', () => {
  const theme = readFileSync(new URL('../src/sports-theme.css', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(theme, /\.wire-matchup-grid\.matchup-scoreboard \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(theme, /\.wire-matchup-grid\.matchup-scoreboard \.wire-matchup-team \{ display: grid; grid-template-columns: 76px minmax\(0, 1fr\)/);
  assert.match(theme, /\.wire-matchup-grid\.matchup-scoreboard \.wire-matchup-team-details h2 \{[^}]*overflow-wrap: normal; word-break: normal/);
  assert.match(theme, /\.matchup-scoreboard \.wire-matchup-score \{ grid-column: auto; grid-row: auto/);
  assert.match(css, /\.wire-team-bar \{ grid-template-columns: minmax\(0, 1fr\); gap: 6px/);
  assert.match(css, /\.wire-team-half-name \{ font-size: 14px; overflow-wrap: normal; word-break: normal/);
});
test('Simulation toggle remains red in both states and mobile cards reserve readable team-name space', () => {
  const css = readFileSync(new URL('../src/sports-theme.css', import.meta.url), 'utf8');
  assert.match(css, /\.wire-pregame-mode \.wire-simulation-toggle \{[^}]*min-height: 44px;[^}]*background: #a51c28;[^}]*color: #fff/);
  assert.match(css, /\.wire-pregame-mode \.wire-simulation-toggle\[aria-pressed="true"\] \{[^}]*background: #c62836;[^}]*color: #fff/);
  assert.match(css, /grid-template-areas: "status status" "bell teams" "footer footer"/);
  assert.match(css, /\.is-simulation-game \.wire-board-team-label \{[^}]*white-space: normal; overflow-wrap: normal; word-break: normal/);
});
test('Wire toggle shows simulated scores, opens the simulation directly, and restores normal pregame/live views', () => {
  const h = hooks(), jsx = (type, props) => ({ type, props });
  let availableSnapshot = snapshot;
  const context = vm.createContext({ exports: {}, window: { scrollTo() {} }, console, require(name) {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('sportsData')) return sports;
    if (name.includes('nflSituation')) return nflSituation;
    if (name.includes('useNFLBoardSimulations')) return { useNFLBoardSimulations: () => ({ simulations: availableSnapshot ? { [game.eventId]: availableSnapshot } : {}, errors: {}, rememberSimulation() {} }) };
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
  assert.equal(toggle('GamewAIre simulations').props.className, 'wire-simulation-toggle');
  assert.ok(tree.some(node => node.type === 'li' && node.props.className === 'notification-game-card is-simulation-game'));
  assert.deepEqual(tree.filter(node => node.props.className === 'wire-board-score').map(node => node.props.children), [22, 28]);
  for (const status of ['LIVE', 'FINAL']) {
    props.games = [{ ...game, status, away: { ...game.away, score: 12 }, home: { ...game.home, score: 17 } }];
    tree = render();
    assert.deepEqual(tree.filter(node => node.props.className === 'wire-board-score').map(node => node.props.children), [22, 28]);
    assert.ok(!tree.some(node => node.props.value === 12 || node.props.value === 17));
    availableSnapshot = null; tree = render();
    assert.deepEqual(tree.filter(node => node.props.className === 'wire-board-score').map(node => node.props.children), ['—', '—']);
    availableSnapshot = snapshot;
  }
  props.games = [game]; tree = render();
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
  assert.ok(tree.some(node => node.type === 'SimulationPanel'));
  assert.ok(!tree.some(node => node.type?.name === 'ScoringPlays'));
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '— – —'));
  tree.find(node => node.type === 'SimulationPanel').props.onScenarioChange('fixture'); tree = render();
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '22 – 28'));
  props.games = [{ ...props.games[0], status: 'FINAL' }];
  tree = render();
  assert.ok(tree.some(node => node.type === 'SimulationPanel'));
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '22 – 28'));
  toggle('Pregame stats').props.onClick(); tree = render();
  assert.ok(!tree.some(node => node.type === 'SimulationPanel'));
  assert.ok(tree.some(node => node.props.value === 12) && tree.some(node => node.props.value === 17));
  assert.ok(tree.some(node => node.type?.name === 'ScoringPlays'));
});
test('Opening a simulation panel after kickoff loads its saved archive on reload', async () => {
  const h = hooks(), timers = new Map(), loaded = [];
  let nextTimer = 0, requests = 0;
  const pastGame = { ...game, date: new Date(Date.now() - 60000).toISOString(), status: 'LIVE' };
  const archive = { ...snapshot, kickoff: pastGame.date };
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, AbortController, Error, console, window: {
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    addEventListener() {}, removeEventListener() {},
  }, require(name) {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('supabaseClient')) return { supabase: null };
    if (name.includes('gamewireBot')) return { loadGameSimulation: async received => {
      assert.equal(received.date, pastGame.date); requests++;
      return archive;
    } };
    return {};
  } });
  vm.runInContext(compile('../src/NFLGameSimulation.tsx'), context);
  context.exports.default({ game: pastGame, onForecast: forecast => loaded.push(forecast) });
  const stop = h.effects[1]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(loaded[0], archive);
  assert.equal(timers.size, 0);
  stop();
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
  const games = Array.from({ length: 7 }, (_, i) => ({ ...game, eventId: String(i), status: ['UPCOMING', 'LIVE', 'FINAL'][i % 3] }));
  context.exports.useNFLBoardSimulations(games, true);
  const stop = h.effects[0]();
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(peak, 3); assert.equal(Object.keys(h.state[0]).length, 7);
  assert.equal(h.state[0]['1'].status, 'ready');
  assert.equal(h.state[0]['2'].status, 'ready');
  fail = true; const [id, reload] = [...timers][0]; timers.delete(id); reload();
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state[0]['0'].status, 'ready'); assert.equal(h.state[1]['0'], 'Offline');
  stop(); assert.equal(timers.size, 0);
});
test('Live scoring area polls all plays, preserves them offline and cleans up on navigation', async () => {
  const h = hooks(), timers = new Map(), jsx = (type, props) => ({ type, props });
  let nextTimer = 0, fail = false;
  const context = vm.createContext({ exports: {}, AbortController, Error, console: { error() {} }, window: {
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
  }, require(name) {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('sportsData')) return { fetchNFLScoringPlays: async () => {
      if (fail) throw new Error('Offline');
      return [{ id: 'score', type: 'Field Goal Good', text: 'A reported field goal', period: 1, clock: '11:45', awayScore: 3, homeScore: 0 }];
    } };
    return {};
  } });
  vm.runInContext(compile('../src/TheWire.tsx') + '\nexports.ScoringPlays = ScoringPlays;', context);
  const props = { game: { ...game, status: 'LIVE' } };
  const render = () => { h.reset(); return elements(context.exports.ScoringPlays(props)); };
  render();
  const stop = h.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  let tree = render();
  assert.equal(tree.filter(node => node.type === 'li').length, 1);
  assert.ok(tree.some(node => node.type === 'small' && node.props.children.join('') === 'AWY 3 – 0 HOM'));
  fail = true;
  const [id, reload] = [...timers][0]; timers.delete(id); reload();
  await new Promise(resolve => setImmediate(resolve));
  tree = render();
  assert.equal(tree.filter(node => node.type === 'li').length, 1);
  assert.ok(tree.some(node => node.props.role === 'alert'));
  stop(); assert.equal(timers.size, 0);
  fail = false;
  props.game = { ...props.game, status: 'FINAL' };
  render();
  const stopFinal = h.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.size, 0);
  stopFinal();
});
