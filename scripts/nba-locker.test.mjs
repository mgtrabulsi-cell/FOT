import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { completedScoreUpdates } from '../src/services/lockerRoomScores.ts';
import { nbaCalendarDate } from '../src/services/sportsData.ts';

const source = readFileSync(new URL('../src/useLockerRoomHistory.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const favorite = { key: 'player:basketball/nba:1', id: '1', name: 'NBA Player', type: 'player', teamId: '2', position: 'PG', feedPath: 'basketball/nba' };
const game = { id: 'NBA:401', eventId: '401', league: 'NBA', sport: 'Basketball', feedPath: 'basketball/nba', status: 'FINAL', date: '2026-10-23T23:00:00Z',
  seasonYear: 2027, period: 'Q4', clock: '0.0', home: { id: '2', score: 100 }, away: { id: '3', score: 98 } };
function setup(records = new Map()) {
  const state = [], effects = [], calls = [];
  let cursor = 0, changed = false, result;
  const props = { userId: null, season: null, week: null, archiveDate: '2026-10-23', games: [game], favorites: [favorite],
    items: [{ kind: 'news', id: 'news', favoriteKey: favorite.key, favoriteName: favorite.name, headline: 'Actual team news', published: '2026-10-23T20:00:00Z' }], plays: [], enabled: true };
  const context = vm.createContext({
    exports: {}, supabase: null, console, AbortController, completedScoreUpdates, nbaCalendarDate,
    subscribeForegroundRefresh: () => () => {},
    localStorage: { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) },
    window: { setInterval: () => 1, clearInterval() {} },
    fetchNFLFavoritePlays: () => { throw new Error('NBA must not request NFL plays'); },
    fetchNFLLivePlayerStats: () => { throw new Error('NBA must not request NFL stats'); },
    fetchNBALivePlayerStats: async (...args) => { calls.push(args); return { '1': { points: 0, rebounds: 9, assists: 11 } }; },
    fetchNBAFavoritePlays: async () => [{ id: 'NBA:401:play:1', favoriteKey: favorite.key, favoriteName: favorite.name, timestamp: '2026-10-23T23:10:00Z', description: 'Makes basket', playLabel: 'Q1 5:00' }],
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (next) => {
        const value = typeof next === 'function' ? next(state[index]) : next;
        if (!Object.is(value, state[index])) { state[index] = value; changed = true; }
      }];
    },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!state[index] || !deps.every((value, i) => Object.is(value, state[index].deps[i]))) effects.push(() => {
        state[index]?.cleanup?.(); state[index] = { deps, cleanup: effect() };
      });
    },
  });
  vm.runInContext(code, context);
  function render() {
    let count = 0;
    do {
      assert.ok(++count < 30, 'Hook settles');
      cursor = 0; changed = false;
      result = context.exports.useLockerRoomHistory(props);
      effects.splice(0).forEach((effect) => effect());
    } while (changed);
  }
  async function settle() { for (let i = 0; i < 12; i++) { await new Promise((resolve) => setImmediate(resolve)); render(); } }
  render();
  return { props, calls, records, settle, render, get result() { return result; }, unmount() { state.forEach((entry) => entry?.cleanup?.()); } };
}

test('NBA favorites produce actual basketball stats, scoring plays, final scores and matching news in daily guest history', async () => {
  const app = setup();
  await app.settle();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][0], '401');
  assert.equal(app.result.players[0].stats.points, 0);
  assert.equal(app.result.players[0].stats.assists, 11);
  assert.equal(app.result.plays.length, 1);
  assert.equal(app.result.items.filter((item) => item.kind === 'score').length, 1);
  assert.equal(app.result.items.filter((item) => item.kind === 'news').length, 1);
  assert.equal(app.records.has('gamewire:locker:week:guest:NBA:2026-10-23'), true);
  const saved = app.records;
  app.unmount();
  const restored = setup(saved);
  restored.props.enabled = false;
  await restored.settle();
  assert.equal(restored.result.players[0].stats.rebounds, 9);
  restored.props.archiveDate = '2026-10-24'; restored.props.games = []; restored.props.items = [];
  restored.render(); await restored.settle();
  assert.equal(restored.result.players.length, 0);
  assert.equal(restored.result.items.length, 0);
  restored.unmount();
});

test('Real App guest favorite effects persist locally without copying account favorites across sign-out', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let restore;
  let persist;
  const historyFavorites = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect') {
      const callback = node.arguments[0]?.getText(parsed);
      if (callback?.includes('setFavorites(loadGuestFavorites())')) restore = callback;
      if (callback?.includes('favoritesRef.current = favorites')) persist = callback;
    }
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useLockerRoomHistory') {
      historyFavorites.push(node.arguments[0].properties.find((property) => property.name?.getText(parsed) === 'favorites').initializer.getText(parsed));
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(restore && persist);
  assert.equal(historyFavorites.length, 2, 'Both leagues must honor the same ownership gate');
  const saved = new Map();
  const guestFavorites = [favorite];
  const context = vm.createContext({
    supabase: {}, authUser: null, authLoading: false, favoritesOwnerId: 'account-before-sign-out',
    favorites: [{ ...favorite, name: 'Private account favorite' }], nbaFavorites: guestFavorites,
    favoritesRef: { current: [] }, guestFavoriteStorageKey: 'guest-favorites', console,
    loadGuestFavorites: () => guestFavorites,
    setFavorites: (value) => { context.favorites = value; },
    setFavoritesOwnerId: (value) => { context.favoritesOwnerId = value; },
    setScoreUpdates() {}, setPlayUpdates() {}, setNewsItems() {}, setFavoriteSyncError() {},
    localStorage: { setItem: (key, value) => saved.set(key, value) },
  });
  const compile = (expression) => vm.runInContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, context);
  const save = compile(persist);
  save();
  assert.equal(saved.size, 0, 'Sign-out cannot save the previous account into guest storage');
  compile(restore)();
  assert.equal(context.favoritesOwnerId, 'guest');
  save();
  assert.deepEqual(JSON.parse(saved.get('guest-favorites')), guestFavorites);
  for (const expression of historyFavorites) {
    assert.equal(compile(expression).length, 1, 'Configured Supabase must not exclude guest favorites from history');
    context.authUser = { id: 'new-account' };
    assert.equal(compile(expression).length, 0, 'Guest favorites are never assigned to a signed-in account');
    context.authUser = null;
  }
  saved.clear();
  context.authLoading = true;
  save();
  assert.equal(saved.size, 0, 'Authentication must settle before saving guest data');
});
