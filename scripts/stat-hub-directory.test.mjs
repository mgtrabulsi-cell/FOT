import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('NFL saved rosters remain usable while loading and combine team, position, favorites, name sorting and search', () => {
  const file = ts.createSourceFile('App.tsx', readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['nflPlayerFavoriteTarget', 'getNFLGamePlayerPools', 'NFLPlayersDirectory'];
  const source = file.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(file)).join('\n') + '\nexport { NFLPlayersDirectory };';
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const player = (id, name, position) => ({ id, name, position, jersey: '1', gamesWithUsage: 5, passingAttempts: 0,
    targets: 10, receptions: 8, carries: 10, recentGames: [] });
  const away = { id: 'away', abbr: 'AWY', name: 'Away Team' }, home = { id: 'home', abbr: 'HME', name: 'Home Team' };
  const game = { id: 'game', eventId: 'game', sport: 'Football', status: 'UPCOMING', feedPath: 'football/nfl', seasonYear: 2026, away, home };
  const details = { teamForms: [{ teamId: away.id, skillPlayers: [player('z', 'Zeta Player', 'WR'), player('a', 'Alpha Player', 'WR')] },
    { teamId: home.id, skillPlayers: [player('b', 'Beta Player', 'RB')] }] };
  let cursor = 0;
  const slots = [];
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, navigator: { onLine: true },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => slots[i] = typeof next === 'function' ? next(slots[i]) : next]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect() {}, useMemo: fn => fn(), usePublicDataRevision: () => 0, readGameDetailsSnapshot: () => details,
    StatHubHeader: 'StatHubHeader', NFLGameWheel: 'NFLGameWheel', TeamMark: 'TeamMark', TeamFavoriteButton: 'TeamFavoriteButton',
    FavoriteStarButton: 'FavoriteStarButton', ChevronRight: 'ChevronRight', NFLPlayerMiniWindow: 'NFLPlayerMiniWindow',
    playerInitials: name => name[0], require: () => ({ jsx, jsxs: jsx }),
  });
  vm.runInContext(code, context);
  const props = { games: [game], query: '', favorites: [{ key: 'player:football/nfl:b' }], onToggleFavorite() {}, initialGameId: null };
  let tree;
  const nodes = () => {
    const result = [];
    const visit = value => { if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') { result.push(value); visit(value.props?.children); } };
    visit(tree); return result;
  };
  const render = () => { cursor = 0; tree = context.exports.NFLPlayersDirectory(props); };
  const players = () => nodes().filter(node => node.props?.className === 'nfl-directory-player-main');
  const select = (current, value) => { nodes().find(node => node.type === 'select' && node.props.value === current).props.onChange({ target: { value } }); render(); };
  const position = value => { nodes().find(node => node.type === 'button' && node.props.children === value).props.onClick(); render(); };
  render();
  assert.equal(players().length, 3, 'Cached players do not wait for the full matchup refresh');
  assert.ok(nodes().some(node => node.props?.className === 'stat-hub-refresh-note'));
  select('usage', 'name');
  assert.equal(players()[0].props['aria-label'], 'View Alpha Player stats');
  position('Favorites');
  assert.equal(players().length, 1);
  select('All', away.id);
  assert.equal(players().length, 0);
  select(away.id, home.id);
  position('WR');
  assert.equal(players().length, 0);
  position('RB');
  assert.equal(players().length, 1);
  props.query = 'missing'; render(); assert.equal(players().length, 0);
  props.query = 'beta'; render(); players()[0].props.onClick(); render();
  assert.equal(nodes().find(node => node.type === 'NFLPlayerMiniWindow').props.player.id, 'b');
});
