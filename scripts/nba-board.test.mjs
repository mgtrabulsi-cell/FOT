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
    nbaPlayerFavorite: (player) => ({ ...player, key: `player:basketball/nba:${player.id}`, type: 'player' }),
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
  vm.runInContext(`${code}\nexports.PlayerBox = PlayerBox; exports.PlayByPlay = PlayByPlay; exports.useDragScroll = useDragScroll;`, context);
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
  return { props, requests, render, nodes, components: context.exports,
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
  assert.equal(app.nodes().filter((node) => node.type?.name === 'PlayerBox').length, 1);
  assert.equal(app.nodes().find((node) => node.type?.name === 'PlayerBox').props.team.id, away.id);
  app.nodes().find((node) => node.props?.className === 'nba-segments nba-team-toggle').props.children[1].props.onClick();
  app.render();
  assert.equal(app.nodes().find((node) => node.type?.name === 'PlayerBox').props.team.id, home.id);
  app.nodes().find((node) => node.props?.className === 'nba-detail-navigation').props.children.props.onClick();
  app.render(); await app.settle();
  assert.ok(board());
  assert.equal(app.requests.length, 1, 'Returning does not request a hidden matchup');
  app.props.query = 'does not match'; app.render();
  assert.equal(app.nodes().some((node) => node.props?.['data-game-id']), false);
  app.unmount();
});

function descendants(tree) {
  const found = [];
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    found.push(node); visit(node.props?.children);
  }
  visit(tree); return found;
}

test('NBA player box stably places all reported starters ahead of bench, retaining DNP and real zeros', () => {
  const app = setup();
  const player = (id, starter, extra = {}) => ({ id, name: `Player ${id}`, position: 'G', starter, stats: { points: 0 },
    display: {}, didNotPlay: false, ...extra });
  const bench = player('bench', false);
  const starters = Array.from({ length: 5 }, (_, i) => player(`starter-${i}`, true));
  const dnp = player('dnp', false, { didNotPlay: true, reason: "Coach's decision" });
  const players = [bench, ...starters, dnp];
  const tree = app.components.PlayerBox({ team: away, box: { players }, favorites: [], toggle() {}, open() {} });
  const nodes = descendants(tree);
  const rows = nodes.filter((node) => node.type === 'tbody')[0].props.children;
  const identities = rows.map((row) => descendants(row).find((node) => node.props?.className === 'nba-player-link').props.children[1].props.children[0]);
  assert.deepEqual(Array.from(identities), [...starters, bench, dnp].map((item) => item.name));
  assert.equal(players[0], bench, 'Sorting never mutates incoming feed data');
  const points = nodes.filter((node) => node.props?.['data-label'] === 'PTS');
  assert.equal(points.length, 6);
  assert.ok(points.every((node) => node.props.children === '0'));
  assert.equal(nodes.filter((node) => node.props?.className === 'nba-dnp').length, 1);
  app.unmount();
});

test('Play-by-play groups newest quarters and overtime first, reverses plays without changing source data', () => {
  const app = setup();
  const play = (id, period, clock) => ({ id, period, clock, text: id, scoring: false });
  const plays = [play('q1-start', 1, '12:00'), play('q1-end', 1, '0.0'), play('q4-start', 4, '12:00'),
    play('q4-end', 4, '0.0'), play('ot-start', 5, '5:00'), play('ot-latest', 5, '1:00')];
  const nodes = descendants(app.components.PlayByPlay({ plays, game, upcoming: false }));
  const quarters = nodes.filter((node) => node.props?.className === 'nba-play-quarter');
  assert.deepEqual(quarters.map((node) => node.props['aria-label']), ['Overtime 1', 'Quarter 4', 'Quarter 1']);
  const text = nodes.filter((node) => node.type === 'p' && typeof node.props.children === 'string').map((node) => node.props.children);
  assert.deepEqual(text, ['ot-latest', 'ot-start', 'q4-end', 'q4-start', 'q1-end', 'q1-start']);
  assert.equal(plays[0].id, 'q1-start');
  app.unmount();
});

test('Horizontal dragging scrolls, suppresses accidental clicks, and preserves ordinary clicks and touch', () => {
  const app = setup();
  const drag = app.components.useDragScroll();
  drag.ref.current = { scrollLeft: 100 };
  let prevented = false, stopped = false;
  drag.onPointerDown({ pointerType: 'mouse', button: 0, clientX: 150 });
  drag.onPointerMove({ buttons: 1, clientX: 100, preventDefault() { prevented = true; } });
  assert.equal(drag.ref.current.scrollLeft, 150);
  drag.onClickCapture({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.ok(prevented && stopped);
  prevented = false;
  drag.onPointerDown({ pointerType: 'mouse', button: 0, clientX: 100 });
  drag.onClickCapture({ preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, false);
  drag.onPointerDown({ pointerType: 'touch', button: 0, clientX: 100 });
  drag.onPointerMove({ buttons: 1, clientX: 50, preventDefault() {} });
  assert.equal(drag.ref.current.scrollLeft, 150, 'Touch scrolling remains browser-native');
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
