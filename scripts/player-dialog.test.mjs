import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { jsx, jsxs } from 'react/jsx-runtime';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const directory = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'NFLPlayersDirectory');
assert.ok(directory, 'Player directory component exists');
const compiled = ts.transpileModule(directory.getText(parsed), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;

function setup() {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let revision = 0;
  const requests = [];
  const player = { id: 'player', name: 'Test Player', position: 'QB', recentGames: [] };
  const team = { id: 'away', name: 'Away', abbr: 'AWY' };
  const game = { id: 'NFL:1', sport: 'Football', feedPath: 'football/nfl', eventId: '1', seasonYear: 2026, away: team, home: { id: 'home', name: 'Home' } };
  const secondGame = { ...game, id: 'NFL:2', eventId: '2' };
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const context = vm.createContext({
    exports: {},
    require: () => ({ jsx, jsxs }),
    AbortController,
    console,
    usePublicDataRevision: () => revision,
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], (next) => {
        const value = typeof next === 'function' ? next(hooks[index]) : next;
        if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!depsEqual(hooks[index]?.deps, deps)) hooks[index] = { deps, value: factory() };
      return hooks[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!depsEqual(hooks[index]?.deps, deps)) effects.push(() => {
        hooks[index]?.cleanup?.();
        hooks[index] = { deps, cleanup: effect() };
      });
    },
    readGameDetailsSnapshot: () => ({ teamForms: [] }),
    fetchNFLGameDetails: (...args) => new Promise((resolve) => requests.push({ resolve, signal: args[4] })),
    getNFLGamePlayerPools: () => [{ team, players: [player] }],
    NFLGameWheel: 'game-wheel',
    NFLPlayerMiniWindow: 'player-dialog',
    TeamMark: 'team-mark',
    TeamFavoriteButton: 'team-favorite',
    FavoriteStarButton: 'favorite-star',
    OfflineImage: 'offline-image',
  });
  vm.runInContext(compiled, context);
  let tree;
  function render() {
    do {
      dirty = false; cursor = 0; effects = [];
      tree = context.NFLPlayersDirectory({ games: [game, secondGame], query: '', favorites: [], onToggleFavorite() {}, initialGameId: game.id });
      effects.forEach((effect) => effect());
    } while (dirty);
    return tree;
  }
  function find(predicate, node) {
    if (Array.isArray(node)) return node.flatMap((child) => find(predicate, child));
    if (!node || typeof node !== 'object' || !node.props) return [];
    return [...(predicate(node) ? [node] : []), ...find(predicate, node.props.children ?? null)];
  }
  render();
  return {
    requests, render,
    open() { find((node) => node.props.className === 'nfl-directory-player-main', tree)[0].props.onClick(); render(); },
    dialog() { return find((node) => node.type === 'player-dialog', tree)[0]; },
    refresh() { revision++; render(); },
    switchGame() { find((node) => node.type === 'game-wheel', tree)[0].props.onSelect(secondGame.id); render(); },
  };
}

test('Player dialog survives repeated refreshes before game details finish, and closes explicitly', async () => {
  const app = setup();
  app.open();
  assert.ok(app.dialog());
  for (let i = 0; i < 3; i++) {
    app.refresh();
    assert.ok(app.dialog(), 'A background refresh must not dismiss the selected player');
  }
  assert.equal(app.requests[0].signal.aborted, true);
  app.requests.at(-1).resolve({ teamForms: [] });
  await Promise.resolve();
  app.render();
  assert.ok(app.dialog(), 'Completing fresh details keeps the card open');
  app.dialog().props.onClose();
  app.render();
  assert.equal(app.dialog(), undefined);
});

test('Switching matchups closes the previous player even if its request is still pending', () => {
  const app = setup();
  app.open();
  assert.ok(app.dialog());
  app.switchGame();
  assert.equal(app.dialog(), undefined);
  assert.equal(app.requests[0].signal.aborted, true);
});
