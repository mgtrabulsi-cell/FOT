import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/NBAExperience.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const away = { id: '1', name: 'Atlanta Hawks', abbr: 'ATL', score: 100, record: '1-0' };
const home = { id: '2', name: 'Boston Celtics', abbr: 'BOS', score: 99, record: '0-1' };
const game = { id: 'NBA:401', eventId: '401', feedPath: 'basketball/nba', league: 'NBA', seasonYear: 2027,
  date: '2026-10-23T23:00:00Z', status: 'LIVE', period: 'Q4', clock: '1:00', away, home, venue: 'Arena' };

function setup(mode = 'wire') {
  let cursor = 0, changed = false, tree;
  const slots = [], effects = [], requests = [];
  const props = { mode, games: [game], status: 'ready', query: '', favorites: [], onToggleFavorite() {}, onRetry() {},
    initialGameId: game.id, onSelectGame(id) { props.initialGameId = id; } };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; changed = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !deps.every((value, i) => Object.is(value, slots[index].deps[i]))) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !deps.every((value, i) => Object.is(value, slots[index].deps[i]))) {
        effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const data = {
    nbaTeamFavorite: (team) => ({ ...team, key: `team:basketball/nba:${team.id}`, type: 'team' }),
    fetchNBASummary: async (id) => { requests.push(id); return { status: 'in', teams: [], plays: [] }; },
    fetchNBALeague: async () => ({ teams: [away, home], season: 2027 }),
  };
  const context = vm.createContext({
    exports: {}, AbortController, navigator: { onLine: true }, document: { visibilityState: 'visible' },
    window: { setInterval: () => 1, clearInterval() {} },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === './services/nbaData') return data;
      if (name === './services/foregroundRefresh') return { subscribeForegroundRefresh: () => () => {} };
      return {};
    },
  });
  vm.runInContext(code, context);
  function render() {
    let count = 0;
    do {
      assert.ok(++count < 30, 'Render settles');
      cursor = 0; changed = false; tree = context.exports.default(props);
      effects.splice(0).forEach((effect) => effect());
    } while (changed);
  }
  const nodes = () => {
    const result = [];
    function visit(node) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      result.push(node); visit(node.props?.children);
    }
    visit(tree); return result;
  };
  render();
  return { props, requests, render, nodes,
    async settle() { for (let i = 0; i < 5; i++) { await new Promise(setImmediate); render(); } },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test('NBA Wire starts as an NFL-style vertical board and requests full details only after a game click', async () => {
  const app = setup();
  await app.settle();
  const board = () => app.nodes().find((node) => node.props?.className === 'wire-board');
  assert.ok(board(), 'Returning to Wire starts at the board even with a remembered selection');
  assert.equal(app.requests.length, 0);
  assert.equal(app.nodes().some((node) => node.props?.className === 'nba-matchup'), false);
  const card = app.nodes().find((node) => node.props?.['data-game-id'] === game.id);
  assert.match(card.props['aria-label'], /Atlanta Hawks at Boston Celtics, live Q4 1:00/);
  card.props.onClick(); app.render(); await app.settle();
  assert.deepEqual(app.requests, ['401']);
  assert.equal(board(), undefined);
  assert.ok(app.nodes().find((node) => node.props?.className === 'nba-matchup'));
  assert.equal(app.nodes().filter((node) => node.type?.name === 'PlayerBox').length, 2);
  app.nodes().find((node) => node.props?.className === 'nba-detail-navigation').props.children.props.onClick();
  app.render(); await app.settle();
  assert.ok(board());
  assert.equal(app.requests.length, 1, 'Returning does not request a hidden matchup');
  app.props.query = 'does not match'; app.render();
  assert.equal(app.nodes().some((node) => node.props?.['data-game-id']), false);
  app.unmount();
});

test('A changed NBA date returns to the board; Stat Hub keeps its wheel and roster workflow', async () => {
  const app = setup();
  app.nodes().find((node) => node.props?.['data-game-id']).props.onClick();
  app.render(); await app.settle();
  app.props.games = [{ ...game, id: 'NBA:402', eventId: '402' }];
  app.props.initialGameId = null;
  app.render(); await app.settle();
  assert.ok(app.nodes().find((node) => node.props?.className === 'wire-board'));
  assert.deepEqual(app.requests, ['401']);
  app.unmount();
  const stats = setup('stats');
  await stats.settle();
  assert.equal(stats.nodes().some((node) => node.props?.className === 'wire-board'), false);
  assert.ok(stats.nodes().find((node) => node.props?.className === 'nba-game-wheel'));
  assert.ok(stats.nodes().find((node) => node.type?.name === 'Roster'));
  assert.equal(stats.requests.length, 0);
  stats.unmount();
});
