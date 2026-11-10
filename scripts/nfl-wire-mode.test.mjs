import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as sports from '../src/services/sportsData.ts';
import * as nflSituation from '../src/services/nflSituation.ts';
import * as simulation from '../supabase/functions/_shared/nflSimulation.ts';
import { featuredSimulationMinimums, fullPlayerPerformances, isFeaturedSimulationPlayer, simulationAccuracyStats } from '../supabase/functions/_shared/nflSimulationAccuracy.ts';

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
    useMemo: fn => fn(), useCallback: fn => fn, useEffect: effect => effects.push(effect), useId: () => 'test-accuracy',
  } };
}
const elements = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(elements)
  : [node, ...elements(node.props?.children)];
test('Simulation graphic access fails closed and only owner/admin roles can display downloads', async () => {
  for (const role of ['owner', 'admin', 'member', null, 'query-error']) {
    const h = hooks(), timers = [], listeners = new Map(), errors = [];
    let session = { user: { id: 'signed-in' } }, changed, resolveRole;
    const client = {
      auth: { getSession: async () => ({ data: { session }, error: null }),
        onAuthStateChange: fn => { changed = fn; return { data: { subscription: { unsubscribe() {} } } }; } },
      from(table) {
        assert.equal(table, 'livewire_roles');
        const q = { select: () => q, eq: (_key, id) => { assert.equal(id, 'signed-in'); return q; },
          maybeSingle: () => new Promise(resolve => { resolveRole = resolve; }) };
        return q;
      },
    };
    const context = vm.createContext({ exports: {}, console: { error: (...args) => errors.push(args) },
      window: { setTimeout: fn => timers.push(fn), addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) },
      require(name) { if (name === 'react') return h.react; return { supabase: client }; } });
    vm.runInContext(compile('../src/useSimulationGraphicAccess.ts'), context);
    assert.equal(context.exports.useSimulationGraphicAccess().allowed, false);
    const stop = h.effects[0]();
    await new Promise(resolve => setImmediate(resolve));
    resolveRole({ data: role ? { role } : null, error: role === 'query-error' ? new Error('Unavailable') : null });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.state[0], role === 'owner' || role === 'admin');
    assert.equal(!!h.state[1], role === 'query-error');
    assert.equal(errors.length, role === 'query-error' ? 1 : 0);
    listeners.get('focus')();
    assert.equal(h.state[0], role === 'owner' || role === 'admin', 'Focus rechecks must not tear down an existing admin graphic preview');
    await new Promise(resolve => setImmediate(resolve));
    session = null; changed();
    assert.equal(h.state[0], false, 'Sign-out hides controls immediately');
    resolveRole({ data: { role: 'owner' }, error: null });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.state[0], false, 'A stale permission response cannot restore access after sign-out');
    timers.forEach(fn => fn());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.state[0], false);
    stop();
    assert.equal(listeners.size, 0);
  }
});

test('Selecting a simulation player toggles an inline game log for the exact player and game', () => {
  const h = hooks(), jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, require(name) {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('NFLSimulationPlayerLog')) return { default: 'PlayerLog' };
    if (name.includes('/nflSimulation')) return simulation;
    return {};
  } });
  vm.runInContext(compile('../src/NFLGameSimulation.tsx') + '\nexports.TeamSimulation = TeamSimulation;', context);
  const range = value => ({ mean: value, p10: value, median: value, p90: value });
  const player = { id: '4362628', name: 'Receiver', position: 'WR', issue: null,
    stats: { receptions: range(6), receivingYards: range(80), receivingTouchdowns: range(1) } };
  const team = { id: '1', name: 'Team', abbr: 'HOM', score: range(24), players: [player],
    totals: Object.fromEntries(['passingYards', 'rushingYards', 'receptions', 'otherReceivingYards', 'otherReceptions', 'otherRushingYards'].map(key => [key, range(10)])) };
  const render = () => { h.reset(); return elements(context.exports.TeamSimulation({ team, game })); };
  let tree = render();
  const trigger = () => tree.find(node => node.props['aria-label'] === 'View Receiver game log');
  assert.equal(trigger().props['aria-expanded'], false);
  trigger().props.onClick(); tree = render();
  assert.equal(trigger().props['aria-expanded'], true);
  const log = tree.find(node => node.type === 'PlayerLog');
  assert.equal(log.props.player, player); assert.equal(log.props.game, game);
  log.props.onClose(); tree = render();
  assert.ok(!tree.some(node => node.type === 'PlayerLog'));
});

test('Player log renders actual zero TDs and missing values distinctly and handles loading, failure and cancellation', async () => {
  const h = hooks(), jsx = (type, props) => ({ type, props });
  let resolveRequest, signal;
  const context = vm.createContext({ exports: {}, AbortController, Date, console: { error() {} }, require(name) {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    return { fetchPlayerGameLog: (_id, _game, received) => { signal = received; return new Promise(resolve => { resolveRequest = resolve; }); } };
  } });
  vm.runInContext(compile('../src/NFLSimulationPlayerLog.tsx'), context);
  const props = { player: { id: '1', name: 'Receiver', position: 'WR' }, game, onClose() {} };
  const render = () => { h.reset(); return elements(context.exports.default(props)); };
  assert.ok(render().some(node => node.props.children === 'Loading past games…'));
  const stop = h.effects[0]();
  resolveRequest([{ gameId: 'old', date: '2025-11-01T18:00:00Z', opponentAbbreviation: 'vs CLE', result: 'W', score: '24-20', stats: { receptions: 5, receivingYards: 80, receivingTouchdowns: 0 } }]);
  await new Promise(resolve => setImmediate(resolve));
  let tree = render();
  assert.ok(tree.some(node => node.type === 'td' && node.props.children === 0));
  assert.ok(tree.some(node => node.props['aria-label'] === 'Statistic unavailable'));
  assert.ok(tree.some(node => node.type === 'th' && node.props.children === 'REC TD'));
  h.state[2] = 'Feed unavailable'; h.state[0] = [];
  tree = render();
  assert.ok(tree.some(node => node.props.role === 'alert'));
  tree.find(node => node.props.children === 'Retry game log').props.onClick();
  assert.equal(h.state[3], 1);
  stop(); assert.equal(signal.aborted, true);
});

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
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.wire-pregame-mode \[role="group"\] \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.wire-pregame-mode button \{ min-width: 0; min-height: 48px;[^}]*white-space: normal/);
});
test('Wire toggle shows simulated scores, opens the simulation directly, and restores normal pregame/live views', () => {
  const h = hooks(), jsx = (type, props) => ({ type, props });
  let availableSnapshot = snapshot;
  const context = vm.createContext({ exports: {}, window: { scrollTo() {} }, console, require(name) {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('sportsData')) return sports;
    if (name.includes('nflSituation')) return nflSituation;
    if (name.includes('/nflSimulation')) return simulation;
    if (name.includes('useNFLBoardSimulations')) return { useNFLBoardSimulations: () => ({ simulations: availableSnapshot ? { [game.eventId]: availableSnapshot } : {}, errors: {}, rememberSimulation(forecast) { availableSnapshot = forecast; } }) };
    if (name.includes('NFLGameSimulation')) return { default: 'SimulationPanel' };
    if (name.includes('NFLSimulationAccuracy')) return { NFLSimulationResults: 'ResultsArea' };
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
  assert.equal(toggle('GamewAIre simulations').props['aria-pressed'], true);
  assert.equal(toggle('Matchups').props['aria-pressed'], false);
  assert.ok(tree.some(node => node.type === 'li' && node.props.className === 'notification-game-card is-simulation-game'));
  assert.deepEqual(tree.filter(node => node.props.className === 'wire-board-score').map(node => node.props.children), [22, 28]);
  toggle('Matchups').props.onClick(); tree = render();
  assert.equal(toggle('Matchups').props['aria-pressed'], true);
  assert.ok(tree.some(node => node.type === 'li' && node.props.className === 'notification-game-card'));
  toggle('GamewAIre simulations').props.onClick(); tree = render();
  assert.equal(toggle('GamewAIre simulations').props['aria-pressed'], true);
  assert.equal(toggle('GamewAIre simulations').props.className, 'wire-simulation-toggle');
  assert.ok(tree.some(node => node.type === 'li' && node.props.className === 'notification-game-card is-simulation-game'));
  assert.deepEqual(tree.filter(node => node.props.className === 'wire-board-score').map(node => node.props.children), [22, 28]);
  availableSnapshot = { ...snapshot, scenarios: [{ ...snapshot.scenarios[0],
    home: { ...snapshot.scenarios[0].home, score: { mean: 24.2 } },
    away: { ...snapshot.scenarios[0].away, score: { mean: 24.3 } },
    projectedOvertime: { home: 27, away: 24, source: 'pregame' },
  }] };
  tree = render();
  assert.deepEqual(tree.filter(node => node.props.className === 'wire-board-score').map(node => node.props.children), [24, 27]);
  assert.ok(tree.some(node => node.type === 'small' && node.props.children === 'PROJECTED F/OT'));
  delete availableSnapshot.scenarios[0].projectedOvertime;
  tree = render();
  assert.deepEqual(tree.filter(node => node.props.className === 'wire-board-score').map(node => node.props.children), ['—', '—']);
  assert.ok(tree.some(node => node.type === 'small' && node.props.children === 'OT final unavailable'));
  availableSnapshot = snapshot;
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
  panel.props.onForecast({ ...snapshot, qbMatchup: { scenarioId: 'backup' } }); tree = render();
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '15 – 30'));
  panel.props.onForecast({ ...snapshot, qbMatchup: { scenarioId: 'unsupported' } }); tree = render();
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '— – —'));
  toggle('Matchups').props.onClick(); tree = render();
  assert.ok(!tree.some(node => node.type === 'SimulationPanel'));
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === 'vs'));
  props.games = [{ ...game, status: 'LIVE', away: { ...game.away, score: 12 }, home: { ...game.home, score: 17 } }];
  tree = render(); toggle('GamewAIre simulations').props.onClick(); tree = render();
  assert.ok(tree.some(node => node.type === 'SimulationPanel'));
  assert.ok(!tree.some(node => node.type?.name === 'ScoringPlays'));
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '— – —'));
  tree.find(node => node.type === 'SimulationPanel').props.onForecast(snapshot); tree = render();
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '22 – 28'));
  props.games = [{ ...props.games[0], status: 'FINAL' }];
  tree = render();
  assert.ok(tree.some(node => node.type === 'SimulationPanel'));
  assert.ok(tree.some(node => node.props.className === 'wire-matchup-score' && node.props.children === '22 – 28'));
  toggle('Matchups').props.onClick(); tree = render();
  assert.ok(!tree.some(node => node.type === 'SimulationPanel'));
  assert.ok(tree.some(node => node.props.value === 12) && tree.some(node => node.props.value === 17));
  assert.ok(tree.some(node => node.type?.name === 'ScoringPlays'));
  toggle('Simulation Results').props.onClick(); tree = render();
  assert.equal(toggle('Simulation Results').props['aria-pressed'], true);
  assert.ok(tree.some(node => node.type === 'ResultsArea'));
  assert.ok(!tree.some(node => node.props.className === 'wire-board-score' || node.type === 'SimulationPanel'));
  toggle('Matchups').props.onClick(); tree = render();
  assert.equal(toggle('Simulation Results').props['aria-pressed'], false);
  assert.ok(tree.some(node => node.props.className === 'wire-board-score'));
  h.state.length = 0;
  props.openGameId = game.id;
  props.games = [game];
  availableSnapshot = snapshot;
  tree = render();
  assert.equal(toggle('GamewAIre simulations').props['aria-pressed'], true);
  assert.ok(tree.some(node => node.type === 'SimulationPanel'), 'A directly opened game also starts in simulation mode before effects run');
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
    if (name.includes('useSimulationGraphicAccess')) return { useSimulationGraphicAccess: () => ({ allowed: false, error: '' }) };
    if (name.includes('/nflSimulation')) return simulation;
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
      return [
        { id: 'score', type: 'Rushing Touchdown', text: 'A reported rushing touchdown', period: 1, clock: '11:45', awayScore: 3, homeScore: 0 },
        { id: 'score2', type: 'Passing Touchdown', text: 'A reported passing touchdown', period: 2, clock: '6:00', awayScore: 10, homeScore: 0 },
        { id: 'score3', type: 'Field Goal Good', text: 'Overtime field goal', period: 5, clock: '4:00', awayScore: 13, homeScore: 10 },
      ];
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
  assert.equal(tree.filter(node => node.type === 'li').length, 3);
  const quarters = tree.filter(node => node.type === 'section' && node.props.className === 'wire-scoring-quarter');
  assert.deepEqual(quarters.map(node => node.props['aria-label']), ['Quarter 1', 'Quarter 2', 'Overtime']);
  assert.equal(tree.filter(node => node.type === 'h4').length, 3);
  assert.ok(!tree.some(node => node.type === 'details' || node.type === 'summary'));
  assert.ok(tree.some(node => node.type === 'b' && node.props.children === 'RUSHING TOUCHDOWN'));
  assert.ok(tree.some(node => node.type === 'b' && node.props.children === 'PASSING TOUCHDOWN'));
  assert.ok(tree.some(node => node.type === 'small' && node.props.children.join('') === 'AWY 3 – 0 HOM'));
  fail = true;
  const [id, reload] = [...timers][0]; timers.delete(id); reload();
  await new Promise(resolve => setImmediate(resolve));
  tree = render();
  assert.equal(tree.filter(node => node.type === 'li').length, 3);
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
test('Accuracy UI shows simulated and actual lines and ranks players only within the chosen statistic', async () => {
  const h = hooks(), timers = new Map(), jsx = (type, props) => ({ type, props });
  const report = { pending: 0, issues: [], games: [{ eventId: game.eventId, kickoff: game.date, scenario: 'Verified QB',
    away: { abbr: 'AWY', projected: 22.5, actual: 21 }, home: { abbr: 'HOM', projected: 28.5, actual: 28 }, error: 1, issues: [],
    players: [
      { playerId: '6', name: 'Low volume passer', stat: 'passingYards', projected: 100, actual: 100, error: 0, team: 'AWY', position: 'QB' },
      { playerId: '2', name: 'Less close', stat: 'passingYards', projected: 280, actual: 250, error: 30, team: 'HOM', position: 'QB' },
      { playerId: '1', name: 'Closest passer', stat: 'passingYards', projected: 244, actual: 250, error: 6, team: 'AWY', position: 'QB' },
      { playerId: '4', name: 'Third passer', stat: 'passingYards', projected: 290, actual: 250, error: 40, team: 'AWY', position: 'QB' },
      { playerId: '5', name: 'Fourth passer', stat: 'passingYards', projected: 300, actual: 250, error: 50, team: 'HOM', position: 'QB' },
      { playerId: '3', name: 'Receiver', stat: 'receptions', projected: 7, actual: 8, error: 1, team: 'AWY', position: 'WR' },
    ] }] };
  const firstGame = report.games[0];
  report.games.push(...Array.from({ length: 3 }, (_, index) => ({ ...firstGame, eventId: String(700 + index), error: index + 2, players: [] })));
  const context = vm.createContext({ exports: {}, AbortController, console, window: {
    setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id),
  }, require(name) {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('gamewireBot')) return { loadSimulationAccuracy: async () => report };
    if (name.includes('nflSimulationAccuracy')) return { featuredSimulationMinimums, fullPlayerPerformances, isFeaturedSimulationPlayer, simulationAccuracyStats };
    return {};
  } });
  vm.runInContext(compile('../src/NFLSimulationAccuracy.tsx'), context);
  const props = { games: report.games.map(row => ({ ...game, eventId: row.eventId, status: 'FINAL' })), weekly: true };
  const render = () => { h.reset(); return elements(context.exports.default(props)); };
  render(); const stop = h.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  let tree = render();
  const playerNames = () => tree.filter(node => node.type === 'th' && node.props.scope === 'row').map(node => node.props.children.filter(value => typeof value === 'string').join(''));
  assert.match(playerNames()[4], /Low volume passer/);
  assert.match(playerNames()[5], /Closest passer/);
  assert.match(playerNames()[6], /Less close/);
  assert.equal(playerNames().length, 9);
  assert.ok(tree.some(node => node.type === 'td' && node.props.children.join?.('') === '23 – 29'));
  const gameCard = () => tree.find(node => node.type === 'button' && node.props['aria-controls'] === 'test-accuracy-games');
  const playerCard = () => tree.find(node => node.type === 'button' && node.props['aria-controls'] === 'test-accuracy-players');
  assert.equal(gameCard().props['aria-expanded'], false);
  assert.equal(playerCard().props['aria-expanded'], false);
  assert.equal(elements(gameCard()).filter(node => node.props.role === 'listitem').length, 3);
  const playerPreview = elements(playerCard()).filter(node => node.props.role === 'listitem');
  assert.equal(playerPreview.length, 3);
  assert.ok(!elements(playerCard()).some(node => typeof node.props.children === 'string' && /Low volume passer/.test(node.props.children)));
  assert.ok(!elements(playerCard()).some(node => typeof node.props.children === 'string' && /Fourth passer/.test(node.props.children)));
  assert.equal(tree.find(node => node.props.id === 'test-accuracy-games').props.hidden, true);
  gameCard().props.onClick(); tree = render();
  assert.equal(gameCard().props['aria-expanded'], true);
  assert.equal(tree.find(node => node.props.id === 'test-accuracy-games').props.hidden, false);
  playerCard().props.onClick(); tree = render();
  assert.equal(playerCard().props['aria-expanded'], true);
  assert.equal(tree.find(node => node.props.id === 'test-accuracy-players').props.hidden, false);
  assert.ok(tree.some(node => node.type === 'td' && node.props.children === '244.0'));
  assert.ok(tree.some(node => node.type === 'td' && node.props.children === 250));
  tree.find(node => node.type === 'select').props.onChange({ target: { value: 'receptions' } });
  tree = render();
  assert.match(playerNames()[4], /Receiver/);
  assert.equal(playerNames().length, 5);
  firstGame.players.push(...[
    { stat: 'receivingYards', projected: 100, actual: 60, error: 40 },
    { stat: 'receivingTouchdowns', projected: .5, actual: 1, error: .5 },
  ].map(row => ({ ...row, playerId: '3', name: 'Receiver', team: 'AWY', position: 'WR' })));
  tree = render();
  const full = tree.find(node => node.props['aria-label'] === 'Full Player Performances');
  assert.ok(full);
  const fullTree = elements(full);
  assert.ok(fullTree.some(node => node.type === 'h5' && node.props.children === 'Receiver'));
  assert.ok(fullTree.some(node => node.type === 'td' && node.props.children === '40.0'));
  assert.ok(fullTree.some(node => node.type === 'p' && /not exact-stat accuracy/.test(node.props.children)));
  tree.find(node => node.type === 'select').props.onChange({ target: { value: 'passingYards' } });
  tree = render();
  assert.ok(elements(tree.find(node => node.props['aria-label'] === 'Full Player Performances'))
    .some(node => node.type === 'h5' && node.props.children === 'Receiver'));
  stop(); assert.equal(timers.size, 0);
});
test('Dedicated results area selects individual games and explains games that have not finished', () => {
  const h = hooks(), jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, require(name) {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    return {};
  } });
  vm.runInContext(compile('../src/NFLSimulationAccuracy.tsx'), context);
  const props = { games: [{ ...game, status: 'FINAL' }, { ...game, eventId: '456', status: 'LIVE' }] };
  const render = () => { h.reset(); return elements(context.exports.NFLSimulationResults(props)); };
  let tree = render();
  const area = () => tree.find(node => node.type?.name === 'NFLSimulationAccuracy');
  assert.equal(area().props.games.length, 2); assert.equal(area().props.weekly, true);
  tree.find(node => node.type === 'select').props.onChange({ target: { value: game.eventId } }); tree = render();
  assert.equal(area().props.games.length, 1); assert.equal(area().props.games[0].eventId, game.eventId);
  assert.equal(area().props.weekly, false);
  tree.find(node => node.type === 'select').props.onChange({ target: { value: '456' } }); tree = render();
  assert.ok(tree.some(node => node.props.role === 'status' && /after a game finishes/.test(node.props.children)));
});
test('Results controls have explicit dark surfaces, readable contrast and mobile-stacked cards', () => {
  const css = readFileSync(new URL('../src/sports-theme.css', import.meta.url), 'utf8');
  const rule = css.match(/\.wire-simulation-results :is\(button, select\), \.nfl-simulation-accuracy :is\(button, select\) \{[^}]*background: (#[\da-f]+); color: (#[\da-f]+);/);
  assert.ok(rule);
  const luminance = hex => hex.slice(1).match(/../g).map(value => Number.parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const background = luminance(rule[1]), foreground = luminance(rule[2]);
  assert.ok((Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) >= 4.5);
  assert.match(css, /\.wire-simulation-results option, \.nfl-simulation-accuracy option \{ background: #102137; color: #e8f4ff;/);
  assert.match(css, /@media \(max-width: 760px\) \{ \.nfl-accuracy-cards \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.nfl-simulation-accuracy \.nfl-accuracy-table-wrap :is\(th, td\) \{ background: #0b192a; color: #e8f4ff;/);
  assert.match(css, /\.nfl-simulation-accuracy \.nfl-accuracy-table-wrap thead th \{ background: #15334d; color: #bceaff;/);
  assert.match(css, /\.nfl-accuracy-cards > \.nfl-accuracy-card:has\(\.nfl-accuracy-card-toggle\[aria-expanded="true"\]\) \{ grid-column: 1 \/ -1; \}/);
  for (const [bg, fg] of [['#0b192a', '#e8f4ff'], ['#15334d', '#bceaff'], ['#10243c', '#e8f4ff'],
    ['#0b192a', '#b6c8dd'], ['#162e48', '#7ee6b2']]) {
    assert.ok((luminance(fg) + .05) / (luminance(bg) + .05) >= 4.5, `${fg} on ${bg}`);
  }
});
