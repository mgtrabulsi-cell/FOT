import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { nbaPreviousGame } from '../src/services/nbaBackToBack.ts';
import { nbaCalendarDate } from '../src/services/sportsData.ts';
import { nbaLiveScore } from '../src/services/nbaLiveScore.ts';
import { saveNBASummary } from '../src/services/nbaPreload.ts';

const code = ts.transpileModule(readFileSync(new URL('../src/NBAExperience.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const away = { id: '1', name: 'Atlanta Hawks', abbr: 'ATL', score: 100, record: '1-0' };
const home = { id: '2', name: 'Boston Celtics', abbr: 'BOS', score: 99, record: '0-1' };
const game = { id: 'NBA:401', eventId: '401', feedPath: 'basketball/nba', league: 'NBA', seasonYear: 2027,
  date: '2026-10-23T23:00:00Z', status: 'LIVE', period: 'Q4', clock: '1:00', away, home, venue: 'Arena' };

function setup(mode = 'wire', snapshots = new Map(), component, dataOverrides = {}) {
  let cursor = 0, changed = false, tree;
  const slots = [], effects = [], requests = [], timers = new Map();
  const snapshotListeners = new Set();
  const saveSnapshot = (kind, key, value) => {
    snapshots.set(`${kind}:${key}`, value);
    snapshotListeners.forEach(listener => listener());
  };
  let timerId = 0;
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
    fetchNBARoster: async () => [],
    fetchNBAPointsPerGame: async () => ({ averages: {}, failed: [] }),
    fetchNBAPlayerProfile: async () => ({ games: [], averages: {}, totals: {} }),
    nbaStatOptions: [{ key: 'points', label: 'Points' }, { key: 'rebounds', label: 'Rebounds' }],
  };
  Object.assign(data, dataOverrides);
  const context = vm.createContext({
    exports: {}, AbortController, Error, HTMLElement: class {}, navigator: { onLine: true }, document: { visibilityState: 'visible' },
    window: { setInterval: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; }, clearInterval: (id) => timers.delete(id) },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === './services/nbaData') return data;
      if (name === './services/nbaBackToBack') return { nbaPreviousGame };
      if (name === './services/nbaLiveScore') return { nbaLiveScore };
      if (name === './services/sportsData') return { nbaCalendarDate };
      if (name === './services/renderSnapshots') return {
        readLastNBAStatHub: () => snapshots.get('nbaStatHub:last') ?? null,
        saveLastNBAStatHub: (value) => {
          if (JSON.stringify(snapshots.get('nbaStatHub:last')) !== JSON.stringify(value)) saveSnapshot('nbaStatHub', 'last', value);
        },
        subscribeRenderSnapshots: (listener) => { snapshotListeners.add(listener); return () => snapshotListeners.delete(listener); },
        readNBAComparisonSnapshot: (away, home, season) => {
          const combined = snapshots.get(`nbaComparison:comparison:${away}:${home}:${season}`);
          const a = snapshots.get(`nbaTeamSeason:season:${away}:${season}`) ?? combined?.away;
          const b = snapshots.get(`nbaTeamSeason:season:${home}:${season}`) ?? combined?.home;
          return a && b ? { away: a, home: b } : null;
        },
        readNBADirectorySnapshot: (teams, season) => {
          const combined = snapshots.get(`nbaDirectory:directory:${teams.map(team => team.id).join(',')}:${season}`);
          const groups = teams.flatMap(team => {
            const players = snapshots.get(`nbaRoster:roster:${team.id}:${season}`) ?? combined?.find(group => group.team.id === team.id)?.players;
            return players ? [{ team, players }] : [];
          });
          return groups.length ? groups : null;
        },
        nbaResourceSnapshots: (kind) => ({
          read: (key) => snapshots.get(`${kind}:${key}`) ?? null,
          save: (key, value) => saveSnapshot(kind, key, value),
        }),
        gameSnapshotKey: (feed, event, season) => `${feed}:${event}:${season}`,
        readRenderSnapshot: (kind, key) => snapshots.get(`${kind}:${key}`) ?? null,
        saveRenderSnapshot: (kind, key, value) => snapshots.set(`${kind}:${key}`, value),
      };
      if (name === './services/nbaPreload') return { saveNBASummary: (key, value, previous) => {
        saveNBASummary(key, value, previous);
        snapshots.set(`nbaSummary:${key}`, value);
      } };
      if (name === './services/foregroundRefresh') return { subscribeForegroundRefresh: () => () => {} };
      return {};
    },
  });
  vm.runInContext(`${code}\nexports.BackToBackBadge = BackToBackBadge; exports.PlayerBox = PlayerBox; exports.PlayByPlay = PlayByPlay; exports.LatestPlay = LatestPlay; exports.useDragScroll = useDragScroll; exports.NBADirectory = NBADirectory; exports.PlayerProfile = PlayerProfile; exports.PregameComparison = PregameComparison; exports.Roster = Roster; exports.TeamSeason = TeamSeason;`, context);
  function render() {
    let count = 0;
    do {
      assert.ok(++count < 30, 'Render settles');
      cursor = 0; changed = false; tree = component ? context.exports[component.name](component.props) : context.exports.default(props);
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
  return { props, requests, render, nodes, components: context.exports, data, timers, saveSnapshot,
    async settle() { for (let i = 0; i < 5; i++) { await new Promise(setImmediate); render(); } },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test('Opening live NBA details shows current Wire scores immediately with saved stats, then accepts newer summary scores without regressing', async () => {
  const saved = { eventId: game.eventId, status: 'in', period: 'Q3', clock: '5:00', awayScore: 80, homeScore: 79,
    teams: [{ id: away.id, players: [{ id: 'p', name: 'Saved scorer' }], stats: [] }], plays: [] };
  let resolve;
  const app = setup('wire', new Map([[`nbaSummary:basketball/nba:${game.eventId}:${game.seasonYear}`, saved]]), undefined,
    { fetchNBASummary: () => new Promise((done) => { resolve = done; }) });
  const score = () => app.nodes().find((node) => node.props?.className === 'nba-score');
  app.nodes().find((node) => node.props?.['data-game-id']).props.onClick(); app.render();
  assert.ok(JSON.stringify(score()).includes('100'), 'Current board score appears before the summary resolves');
  assert.ok(JSON.stringify(score()).includes('Q4'));
  assert.equal(app.nodes().find((node) => node.type?.name === 'PlayerBox').props.box.players[0].name, 'Saved scorer');
  resolve({ ...saved, period: 'Q4', clock: '0:45', awayScore: 102, homeScore: 101 }); await app.settle();
  assert.ok(JSON.stringify(score()).includes('102'), 'Newer live summary updates the score');
  [...app.timers.values()].find((timer) => timer.delay === 15000).callback(); app.render();
  assert.ok(JSON.stringify(score()).includes('102'), 'Starting another refresh does not roll back to the older board');
  resolve(saved); await app.settle();
  assert.ok(JSON.stringify(score()).includes('100'), 'An older summary never replaces the more advanced board score');
  app.unmount();
});

test('NBA score selection handles quarters, overtime, halftime, finals and reported corrections without taking maximum scores', () => {
  const summary = { status: 'in', period: 'Q4', clock: '1:30', awayScore: 98, homeScore: 97 };
  assert.equal(nbaLiveScore(game, summary, false).awayScore, 100);
  assert.equal(nbaLiveScore(game, { ...summary, clock: '0:30', awayScore: 99 }, false).awayScore, 99, 'A later official correction is not discarded');
  assert.equal(nbaLiveScore({ ...game, period: 'OT1', clock: '4:00' }, summary, false).period, 'OT1');
  assert.equal(nbaLiveScore({ ...game, period: 'Halftime', clock: '' }, { ...summary, period: 'Q2', clock: '1:00' }, false).period, 'Halftime');
  assert.equal(nbaLiveScore({ ...game, status: 'FINAL' }, summary, false).awayScore, 100);
  assert.equal(nbaLiveScore(game, { ...summary, status: 'post', awayScore: 110 }, true).awayScore, 110);
});

test('NBA B2B badges match only teams that played the previous Eastern night and link to that exact box', () => {
  const current = { ...game, date: '2026-11-02T00:00:00Z' };
  const previous = { ...game, id: 'NBA:400', eventId: '400', status: 'FINAL', date: '2026-11-01T02:30:00Z',
    home: { ...home, id: 'other', name: 'Other Team' } };
  assert.equal(nbaPreviousGame(current, away.id, [previous]), previous, 'Eastern date, not UTC date or a 24-hour cutoff');
  assert.equal(nbaPreviousGame(current, home.id, [previous]), undefined);
  for (const candidate of [
    { ...previous, status: 'UPCOMING' }, { ...previous, status: 'LIVE' },
    { ...previous, date: '2026-10-30T23:00:00Z' }, { ...previous, date: current.date },
    { ...previous, league: 'NFL' },
  ]) assert.equal(nbaPreviousGame(current, away.id, [candidate]), undefined);
  const badge = setup('wire', new Map(), { name: 'BackToBackBadge', props: { game: current, team: away, previousGames: [previous] } });
  const link = badge.nodes().find((node) => node.type === 'a');
  assert.equal(link.props.children, 'B2B');
  assert.equal(link.props.href, '#wire/nba/2026-10-31/400');
  assert.match(link.props['aria-label'], /Atlanta Hawks back-to-back.*Other Team/);
  badge.unmount();
  const board = setup();
  board.props.previousGames = [previous]; board.render();
  assert.equal(board.nodes().filter((node) => node.type?.name === 'BackToBackBadge').length, 2);
  assert.equal(board.nodes().find((node) => node.props?.['data-game-id']).type, 'button');
  board.nodes().find((node) => node.props?.['data-game-id']).props.onClick(); board.render();
  assert.equal(board.nodes().filter((node) => node.type?.name === 'BackToBackBadge').length, 2, 'Both matchup headings retain badges');
  board.unmount();
});

test('NBA pregame list cards show reported signed spreads accessibly, never missing, live or final lines', () => {
  const app = setup();
  for (const [spread, expected] of [[-7.5, 'BOS -7.5'], [6.5, 'BOS +6.5'], [0, 'BOS 0'], [null, null], [undefined, null]]) {
    app.props.games = [{ ...game, status: 'UPCOMING', nbaMarket: { spread } }];
    app.render();
    const badge = app.nodes().find((node) => node.props?.className === 'wire-board-spread');
    const card = app.nodes().find((node) => node.props?.['data-game-id']);
    if (expected) {
      assert.ok(badge);
      assert.ok(card.props['aria-label'].includes(`Spread ${expected}`));
      assert.equal(JSON.stringify(badge).includes(String(spread)), true);
    } else {
      assert.equal(badge, undefined);
      assert.equal(card.props['aria-label'].includes('Spread'), false);
    }
  }
  for (const status of ['LIVE', 'FINAL']) {
    app.props.games = [{ ...game, status, nbaMarket: { spread: -7.5 } }];
    app.render();
    assert.equal(app.nodes().some((node) => node.props?.className === 'wire-board-spread'), false);
    assert.equal(app.nodes().find((node) => node.props?.['data-game-id']).props['aria-label'].includes('Spread'), false);
  }
  app.unmount();
});

test('NBA pregame spread appears in matchup details only before tipoff, including even spreads', () => {
  for (const spread of [-7.5, 6.5, 0, null]) {
    const app = setup('wire', new Map(), undefined, { fetchNBASummary: () => new Promise(() => {}) });
    app.props.games = [{ ...game, status: 'UPCOMING', nbaMarket: { spread } }];
    app.render();
    app.nodes().find((node) => node.props?.['data-game-id']).props.onClick(); app.render();
    const badge = app.nodes().find((node) => node.props?.['aria-label'] === 'Pregame spread');
    if (spread === null) assert.equal(badge, undefined);
    else {
      assert.ok(badge);
      assert.match(JSON.stringify(badge), new RegExp(spread > 0 ? '\\+6.5' : String(spread)));
    }
    app.props.games = [{ ...game, nbaMarket: { spread } }]; app.render();
    assert.equal(app.nodes().some((node) => node.props?.['aria-label'] === 'Pregame spread'), false);
  }
});

test('NBA pregame and Stat Hub resources render saved data synchronously and retain it after failed refresh', async () => {
  const savedPlayer = { id: 'p1', name: 'Saved player', position: 'G', jersey: '1', teamId: away.id };
  const cases = [
    ['Roster', 'nbaRoster:roster:1:2027', [savedPlayer], { team: away, season: 2027, query: '', favorites: [], toggle() {}, open() {} }, 'fetchNBARoster'],
    ['TeamSeason', 'nbaTeamSeason:season:1:2027', [{ name: 'points', label: 'Points', display: '110' }], { team: away, season: 2027 }, 'fetchNBATeamSeason'],
    ['PregameComparison', 'nbaComparison:comparison:1:2:2027', { away: [], home: [] }, { game }, 'fetchNBATeamSeason'],
    ['NBADirectory', 'nbaDirectory:directory:1,2:2027', [{ team: away, players: [savedPlayer] }, { team: home, players: [] }],
      { teams: [away, home], season: 2027, query: '', favorites: [], toggle() {}, open() {}, live: false }, 'fetchNBARoster'],
    ['PlayerProfile', 'nbaProfile:profile:p1:2027', { season: 2027, games: [], totals: {}, averages: { points: 24 } },
      { player: savedPlayer, team: away, season: 2027, favorites: [], toggle() {}, close() {} }, 'fetchNBAPlayerProfile'],
  ];
  for (const [name, key, saved, props, fetcher] of cases) {
    const app = setup('stats', new Map([[key, saved]]), { name, props }, {
      [fetcher]: async () => { throw new Error('Offline test'); },
    });

    const resource = () => app.nodes().find((node) => node.type?.name === 'ResourceMessage');
    assert.deepEqual(JSON.parse(JSON.stringify(resource().props.data)), saved, `${name} has saved data on its first render before network completion`);
    await app.settle();
    assert.deepEqual(JSON.parse(JSON.stringify(resource().props.data)), saved, `${name} retains saved content after a failed refresh`);
    assert.equal(resource().props.error, name === 'NBADirectory' ? 'Some player lists could not be refreshed. Saved players remain available.' : 'Offline test');
    app.unmount();
  }
});

test('Stat Hub opens its last player list without any schedule or league response', () => {
  const player = { id: 'saved', name: 'Last viewed player', position: 'G', jersey: '1', teamId: away.id };
  const last = { season: 2027, groups: [{ team: away, players: [{ ...player, id: 'first', name: 'Z first saved player' }, player] }, { team: home, players: [] }] };
  const snapshots = new Map([['nbaStatHub:last', last]]);
  const app = setup('stats', snapshots, undefined, { fetchNBALeague: () => new Promise(() => {}) });
  app.props.games = []; app.props.status = 'loading'; app.render();
  const directory = app.nodes().find(node => node.type?.name === 'NBADirectory');
  assert.ok(directory, 'Directory mounts before schedule or league data is available');
  assert.equal(directory.props.season, 2027);
  assert.equal(directory.props.teams.length, 2);
  assert.equal(directory.props.savedListOnly, true);
  const list = setup('stats', snapshots, { name: 'NBADirectory', props: directory.props });
  assert.ok(list.nodes().some(node => node.props?.['aria-label'] === 'View Last viewed player stats'));
  assert.equal(list.nodes().filter(node => node.props?.className === 'nfl-directory-player-main')[0].props['aria-label'], 'View Z first saved player stats', 'Last displayed ordering survives before scoring data loads');
  assert.equal(list.nodes().find(node => node.type?.name === 'ResourceMessage').props.loading, false);
  app.unmount(); list.unmount();
});

test('A new matchup immediately shows both current teams rather than an unrelated last-viewed team', async () => {
  const player = { id: 'saved', name: 'Yesterday player', position: 'G', jersey: '1', teamId: 'old' };
  const oldTeam = { ...away, id: 'old', name: 'Yesterday team' };
  const snapshots = new Map([['nbaStatHub:last', { season: 2026, groups: [{ team: oldTeam, players: [player] }] }]]);
  let release;
  const props = { teams: [away, home], season: 2027, query: '', favorites: [], toggle() {}, open() {}, live: false };
  const app = setup('stats', snapshots, { name: 'NBADirectory', props }, {
    fetchNBARoster: id => id === away.id ? new Promise(resolve => { release = resolve; }) : Promise.resolve([]),
  });
  assert.equal(app.nodes().some(node => node.props?.['aria-label'] === 'View Yesterday player stats'), false);
  assert.equal(app.nodes().filter(node => node.props?.className === 'nfl-directory-team').length, 2);
  assert.ok(JSON.stringify(app.nodes()).includes(away.name));
  assert.ok(JSON.stringify(app.nodes()).includes(home.name));
  release([{ ...player, id: 'current', name: 'Current player', teamId: away.id }]);
  await app.settle();
  assert.ok(app.nodes().some(node => node.props?.['aria-label'] === 'View Current player stats'));
  assert.equal(app.nodes().some(node => node.props?.['aria-label'] === 'View Yesterday player stats'), false);
  assert.equal(snapshots.get('nbaStatHub:last').season, 2027);
  app.unmount();
});

test('Failed and empty roster refreshes never replace a good last-viewed player list', async () => {
  for (const fail of [false, true]) {
    const player = { id: 'saved', name: 'Retained player', position: 'G', jersey: '1', teamId: away.id };
    const last = { season: 2027, groups: [{ team: away, players: [player] }] };
    const snapshots = new Map([['nbaStatHub:last', last]]);
    const app = setup('stats', snapshots, { name: 'NBADirectory', props: {
      teams: [away, home], season: 2027, query: '', favorites: [], toggle() {}, open() {}, live: false,
    } }, { fetchNBARoster: async () => { if (fail) throw new Error('Offline'); return []; } });
    await app.settle();
    assert.ok(app.nodes().some(node => node.props?.['aria-label'] === 'View Retained player stats'));
    assert.ok(app.nodes().find(node => node.type?.name === 'ResourceMessage').props.error);
    assert.deepEqual(snapshots.get('nbaStatHub:last'), last);
    app.unmount();
  }
});

test('NBA directory renders individual saved teams immediately and notices preloads while its request is pending', async () => {
  const player = { id: 'p1', name: 'Instant player', position: 'G', jersey: '1', teamId: away.id };
  let rosterRequests = 0;
  const props = { teams: [away, home], season: 2027, query: '', favorites: [], toggle() {}, open() {}, live: false };
  const app = setup('stats', new Map([['nbaRoster:roster:1:2027', [player]]]), { name: 'NBADirectory', props }, {
    fetchNBARoster: () => { rosterRequests++; return new Promise(() => {}); },
    fetchNBAPointsPerGame: () => new Promise(() => {}),
  });
  const panels = () => app.nodes().filter(node => node.props?.className === 'nfl-directory-team');
  assert.equal(panels().length, 2, 'Both matchup panels remain visible even when only one roster is cached');
  assert.ok(app.nodes().some(node => node.props?.['aria-label'] === 'View Instant player stats'));
  app.saveSnapshot('nbaRoster', 'roster:2:2027', [{ ...player, id: 'p2', teamId: home.id }]);
  app.render();
  assert.equal(panels().length, 2, 'Background-saved second team becomes visible without finishing the pending request');
  assert.equal(rosterRequests, 2, 'Cache notifications do not restart roster requests');
  app.saveSnapshot('nbaScoring', 'scoring:1,2:2027', { averages: { p1: 24 }, failed: [] });
  app.render();
  assert.equal(app.nodes().filter(node => node.type?.name === 'ResourceMessage')[1].props.data.averages.p1, 24);
  app.unmount();
});

test('Both Stat Hub teams remain visible while one roster is slow or fails, and available players publish immediately', async () => {
  for (const fail of [false, true]) {
    let finish;
    const player = { id: 'fast-player', name: 'Available player', position: 'G', jersey: '1', teamId: away.id };
    const app = setup('stats', new Map(), { name: 'NBADirectory', props: {
      teams: [away, home], season: 2027, query: '', favorites: [], toggle() {}, open() {}, live: true,
    } }, { fetchNBARoster: (id) => id === away.id ? Promise.resolve([player]) : new Promise((resolve, reject) => {
      finish = () => fail ? reject(new Error('Home roster offline')) : resolve([{ ...player, id: 'home-player', teamId: home.id }]);
    }) });
    try {
      assert.equal(app.nodes().filter((node) => node.props?.className === 'nfl-directory-team').length, 2);
      await app.settle();
      assert.ok(app.nodes().some((node) => node.props?.['aria-label'] === 'View Available player stats'), 'Fast roster does not wait for the slow team');
      assert.equal(app.nodes().filter((node) => node.props?.className === 'nfl-directory-team').length, 2);
      finish(); await app.settle();
      assert.equal(app.nodes().filter((node) => node.props?.className === 'nfl-directory-team').length, 2);
      assert.ok(app.nodes().some((node) => node.props?.['aria-label'] === 'View Available player stats'));
      if (fail) assert.match(app.nodes().find((node) => node.type?.name === 'ResourceMessage').props.error, /could not be refreshed/);
    } finally { app.unmount(); }
  }
});

test('NBA Stat Hub reuses recent saved scoring order without another player-stat request burst', async () => {
  const player = { id: 'p1', name: 'Saved scorer', position: 'G', jersey: '1', teamId: away.id };
  const snapshots = new Map([
    ['nbaDirectory:directory:1,2:2027', [{ team: away, players: [player] }, { team: home, players: [] }]],
    ['nbaScoring:scoring:1,2:2027', { averages: { p1: 25 }, failed: [], updatedAt: Date.now() }],
  ]);
  let calls = 0;
  const app = setup('stats', snapshots, { name: 'NBADirectory', props: {
    teams: [away, home], season: 2027, query: '', favorites: [], toggle() {}, open() {}, live: false,
  } }, { fetchNBAPointsPerGame: async () => { calls++; return { averages: {}, failed: [] }; } });
  await app.settle();
  assert.equal(calls, 0);
  assert.equal(app.nodes().filter((node) => node.type?.name === 'ResourceMessage')[1].props.data.averages.p1, 25);
  app.unmount();
});

test('NBA dims only final losers on the board, wheel, names and individual scores, including fresh summary finals', async () => {
  for (const [status, awayScore, homeScore, expectedLoser] of [
    ['FINAL', 100, 99, home.id], ['FINAL', 0, 99, away.id], ['FINAL', 99, 99, null],
    ['LIVE', 100, 99, null], ['UPCOMING', 0, 0, null],
  ]) {
    const app = setup();
    app.props.games = [{ ...game, status, away: { ...away, score: awayScore }, home: { ...home, score: homeScore } }];
    app.data.fetchNBASummary = async () => ({ status: status === 'FINAL' ? 'post' : status === 'LIVE' ? 'in' : 'pre',
      awayScore, homeScore, teams: [], plays: [] });
    app.render(); await app.settle();
    const boardLosers = app.nodes().filter((node) => node.props?.className === 'wire-board-team is-loser');
    assert.equal(boardLosers.length, expectedLoser ? 1 : 0);
    if (expectedLoser) assert.equal(boardLosers[0].props.children[2].props.children, expectedLoser === away.id ? awayScore : homeScore);
    app.nodes().find((node) => node.props?.['data-game-id']).props.onClick();
    app.render(); await app.settle();
    const matchup = app.nodes().find((node) => node.props?.className === 'nba-matchup');
    assert.equal(matchup.props.children[0].props.className === 'is-loser', expectedLoser === away.id);
    assert.equal(matchup.props.children[2].props.className === 'is-loser', expectedLoser === home.id);
    const scoreSpans = app.nodes().filter((node) => node.type === 'span' && typeof node.props.children === 'number' && node.props.className === 'is-loser');
    assert.equal(scoreSpans.length, expectedLoser ? 1 : 0, 'Only the losing half of the combined score is muted');
    const wheel = app.nodes().find((node) => node.props?.className?.startsWith('nba-game-option'));
    assert.equal(wheel.props.children[1].filter((node) => node.props.className === 'is-loser').length, expectedLoser ? 1 : 0);
    app.unmount();
  }
  const app = setup();
  app.data.fetchNBASummary = async () => ({ status: 'post', awayScore: 110, homeScore: 112, teams: [], plays: [] });
  app.nodes().find((node) => node.props?.['data-game-id']).props.onClick();
  app.render(); await app.settle();
  const matchup = app.nodes().find((node) => node.props?.className === 'nba-matchup');
  assert.equal(matchup.props.children[0].props.className, 'is-loser', 'New final summary overrides older live scoreboard scores');
  assert.notEqual(matchup.props.children[2].props.className, 'is-loser');
  app.unmount();
});

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
  app.nodes().find((node) => node.props?.className === 'nba-detail-navigation').props.children[0].props.onClick();
  app.render(); await app.settle();
  assert.ok(board());
  assert.equal(app.requests.length, 1, 'Returning does not request a hidden matchup');
  app.props.query = 'does not match'; app.render();
  assert.equal(app.nodes().some((node) => node.props?.['data-game-id']), false);
  app.unmount();
});

test('NBA push deep link opens the requested box once the date schedule arrives without affecting normal board entry', async () => {
  const app = setup();
  app.props.games = [];
  app.props.openGameId = game.id;
  app.render();
  await app.settle();
  assert.equal(app.requests.length, 0);
  app.props.games = [game];
  app.render();
  await app.settle();
  assert.ok(app.nodes().some((node) => node.props?.className === 'nba-matchup'));
  assert.ok(app.requests.includes(game.eventId));
  app.nodes().find((node) => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('All games')).props.onClick();
  app.render();
  await app.settle();
  assert.ok(app.nodes().some((node) => node.props?.className === 'wire-board'), 'All games remains usable after a notification open');
  app.unmount();
});

test('Latest NBA play follows live summary polling, highlights scores and retains the last play on failure', async () => {
  const app = setup();
  let plays = [{ id: 'first', period: 4, clock: '1:00', text: 'Reported basket', scoring: true, teamId: away.id, awayScore: 100, homeScore: 99 }];
  app.data.fetchNBASummary = async () => ({ status: 'in', teams: [], plays });
  app.nodes().find((node) => node.props?.['data-game-id']).props.onClick();
  app.render(); await app.settle();
  const latest = () => app.nodes().find((node) => node.type?.name === 'LatestPlay');
  assert.equal(latest().props.play.id, 'first');
  const card = app.components.LatestPlay(latest().props);
  assert.equal(card.props.className, 'wire-latest-play is-scoring');
  assert.equal(card.props['aria-live'], 'polite');
  assert.equal(card.props['aria-atomic'], 'true');
  assert.ok(descendants(card).some((node) => node.type === 'p' && node.props.children === 'Reported basket'));
  const poll = [...app.timers.values()].find((timer) => timer.delay === 15000);
  assert.ok(poll, 'Live matchup checks latest play every 15 seconds');
  plays = [...plays, { ...plays[0], id: 'second', text: 'Reported timeout', scoring: false }];
  poll.callback(); await app.settle();
  assert.equal(latest().props.play.id, 'second');
  app.data.fetchNBASummary = async () => { throw new Error('Feed temporarily unavailable'); };
  poll.callback(); await app.settle();
  assert.equal(latest().props.play.id, 'second', 'Failed refresh does not clear the latest play');
  assert.ok(app.nodes().some((node) => node.type?.name === 'ResourceMessage' && node.props.error.includes('Feed temporarily unavailable')));
  app.nodes().find((node) => node.props?.className === 'nba-detail-navigation').props.children[0].props.onClick();
  app.render(); await app.settle();
  assert.equal(app.timers.size, 0, 'Hidden matchup stops live polling');
  assert.equal(latest(), undefined);
  app.unmount();
});

test('NBA Stat Hub navigation sits beside All games above the scoreboard and opens the selected game', async () => {
  const app = setup();
  let opened;
  app.props.onOpenStatHub = (id) => { opened = id; };
  app.nodes().find((node) => node.props?.['data-game-id']).props.onClick();
  app.render(); await app.settle();
  const navigation = app.nodes().find((node) => node.props?.className === 'nba-detail-navigation');
  const button = navigation.props.children[1];
  assert.equal(button.props.className, 'nba-open-stats');
  assert.equal(app.nodes().filter((node) => node.props?.className === 'nba-open-stats').length, 1);
  assert.ok(app.nodes().indexOf(navigation) < app.nodes().findIndex((node) => node.props?.className === 'nba-matchup'));
  button.props.onClick();
  assert.equal(opened, game.id);
  app.unmount();
});

test('NBA reopens a saved box synchronously before refresh, isolates games/seasons and retains it offline', async () => {
  const snapshots = new Map();
  const first = setup('wire', snapshots);
  first.data.fetchNBASummary = async () => ({ eventId: '401', teams: [{ id: away.id, players: [{ id: 'saved' }] }], plays: [] });
  first.nodes().find((node) => node.props?.['data-game-id']).props.onClick();
  first.render(); await first.settle(); first.unmount();
  const reopened = setup('wire', snapshots);
  let complete;
  reopened.data.fetchNBASummary = () => new Promise((resolve) => { complete = resolve; });
  const box = () => reopened.nodes().find((node) => node.type?.name === 'PlayerBox')?.props.box;
  reopened.nodes().find((node) => node.props?.['data-game-id']).props.onClick(); reopened.render();
  assert.equal(box().players[0].id, 'saved', 'Saved stats render before the network resolves');
  complete({ eventId: '401', teams: [{ id: away.id, players: [{ id: 'fresh' }] }], plays: [] });
  await reopened.settle();
  assert.equal(box().players[0].id, 'fresh');
  reopened.data.fetchNBASummary = async () => { throw new Error('Offline'); };
  reopened.timers.values().next().value.callback(); await reopened.settle();
  assert.equal(box().players[0].id, 'fresh');
  assert.match(reopened.nodes().find((node) => node.type?.name === 'ResourceMessage').props.error, /Offline/);
  for (const next of [{ ...game, seasonYear: 2028 }, { ...game, id: 'NBA:402', eventId: '402' }]) {
    reopened.props.games = [next]; reopened.props.initialGameId = next.id;
    reopened.render();
    assert.equal(box(), undefined, 'No snapshot leaks to another season or event');
  }
  reopened.unmount();
});

test('NBA opens a background-preloaded box on its first detail render without requiring a previous game visit', () => {
  const snapshots = new Map();
  const app = setup('wire', snapshots);
  snapshots.set('nbaSummary:basketball/nba:401:2027', { teams: [{ id: away.id, players: [{ id: 'preloaded' }] }], plays: [] });
  app.data.fetchNBASummary = () => new Promise(() => {});
  app.nodes().find((node) => node.props?.['data-game-id']).props.onClick(); app.render();
  assert.equal(app.nodes().find((node) => node.type?.name === 'PlayerBox').props.box.players[0].id, 'preloaded');
  app.unmount();
});

test('NBA live boxes retain in-memory stats through empty/partial refreshes even if device storage was cleared', async () => {
  const saved = { eventId: game.eventId, status: 'in', period: 'Q4', clock: '1:00', plays: [],
    teams: [away, home].map((team) => ({ id: team.id, stats: [], players: [{
      id: `player-${team.id}`, name: `Saved ${team.name} player`, stats: { points: 12, rebounds: 0 }, display: {},
    }] })) };
  const key = `nbaSummary:basketball/nba:${game.eventId}:${game.seasonYear}`;
  const snapshots = new Map([[key, saved]]);
  let resolve;
  const app = setup('wire', snapshots, undefined, { fetchNBASummary: () => new Promise((done) => { resolve = done; }) });
  const box = () => app.nodes().find((node) => node.type?.name === 'PlayerBox').props.box;
  try {
    app.nodes().find((node) => node.props?.['data-game-id']).props.onClick(); app.render();
    assert.equal(box().players[0].stats.points, 12);
    snapshots.delete(key);
    resolve({ ...saved, teams: [] }); await app.settle();
    assert.equal(box().players[0].stats.points, 12);
    assert.match(app.nodes().find((node) => node.type?.name === 'ResourceMessage').props.error, /incomplete/);
    const timer = [...app.timers.values()].find((item) => item.delay === 15000);
    timer.callback(); app.render();
    assert.equal(box().players[0].stats.points, 12, 'Polling never clears visible rows');
    resolve({ ...saved, teams: saved.teams.map((team) => ({ ...team, players: team.players.map((player) => ({ ...player, stats: {} })) })) });
    await app.settle();
    assert.equal(box().players[0].stats.rebounds, 0, 'A partial response cannot erase a genuine zero');
    timer.callback(); app.render();
    resolve({ ...saved, teams: saved.teams.map((team) => ({ ...team, players: team.players.map((player) => ({ ...player, stats: { points: 14, rebounds: 1 } })) })) });
    await app.settle();
    assert.equal(box().players[0].stats.points, 14, 'A complete refresh still updates');
  } finally { app.unmount(); }
});

test('NBA box-score table and all column headers remain visible before any player data arrives', () => {
  const app = setup();
  const tree = app.components.PlayerBox({ team: away, favorites: [], toggle() {}, open() {} });
  const nodes = descendants(tree);
  assert.equal(nodes.filter((node) => node.type === 'table' && node.props.className === 'nba-table nba-box').length, 1);
  assert.equal(nodes.filter((node) => node.type === 'th' && node.props.scope === 'col').length, 13);
  assert.match(JSON.stringify(tree), /Waiting for reported player statistics/);
  assert.equal(nodes.some((node) => node.type === 'td' && node.props.children === 0), false);
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
  const rows = nodes.filter((node) => node.type === 'tr' && node.props?.className !== 'nba-box-group'
    && descendants(node).some((child) => child.props?.className === 'nba-player-link'));
  const identities = rows.map((row) => descendants(row).find((node) => node.props?.className === 'nba-box-full-name').props.children);
  assert.deepEqual(Array.from(identities), [...starters, bench, dnp].map((item) => item.name));
  assert.equal(players[0], bench, 'Sorting never mutates incoming feed data');
  const points = nodes.filter((node) => node.props?.['data-label'] === 'PTS');
  assert.equal(points.length, 6);
  assert.ok(points.every((node) => node.props.children === '0'));
  assert.equal(nodes.filter((node) => node.props?.className === 'nba-dnp').length, 1);
  assert.deepEqual(nodes.filter((node) => node.type === 'tbody').map((node) => node.props['aria-label']), ['Starting five', 'Bench']);
  const firstStats = descendants(rows[0]).filter((node) => node.props?.['data-label']).slice(0, 6).map((node) => node.props['data-label']);
  assert.deepEqual(firstStats, ['MIN', 'PTS', 'REB', 'AST', 'FG', 'FT']);
  const headers = nodes.filter((node) => node.props?.className === 'nba-box-group');
  assert.ok(headers.every((header) => descendants(header).filter((node) => node.type === 'th').length === 13), 'Both sections repeat aligned stat headers');
  assert.ok(rows.every((row) => descendants(row).filter((node) => node.type === 'td').length === (row === rows.at(-1) ? 1 : 12)), 'Each player has a single table row, with one spanning DNP cell when needed');
  const identity = descendants(rows[0]).find((node) => node.props?.className === 'nba-box-identity');
  assert.ok(identity.props.children.some((node) => node.type?.name === 'FavoriteButton'));
  assert.equal(descendants(identity).some((node) => node.type?.name === 'OfflineImage'), false);
  assert.equal(nodes.some((node) => node.props?.className === 'nba-box-short-name'), false, 'Full names only, without abbreviations');
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
  assert.ok(stats.nodes().find((node) => node.props?.className === 'nfl-game-wheel-tabs'));
  assert.ok(stats.nodes().find((node) => node.type?.name === 'NBADirectory'));
  assert.equal(stats.requests.length, 0);
  stats.unmount();
});

test('NBA Stat Hub matches NFL wheel markup and shows both matchup teams without the Wire scoreboard', async () => {
  const app = setup('stats');
  await app.settle();
  const wheel = app.nodes().find((node) => node.props?.className === 'nfl-game-wheel-tabs');
  assert.equal(wheel.props.selected, game.id);
  assert.equal(wheel.props.options[0].label, 'ATL @ BOS');
  assert.equal(app.nodes().some((node) => node.props?.className === 'nba-matchup'), false);
  const directory = app.nodes().find((node) => node.type?.name === 'NBADirectory');
  assert.deepEqual(Array.from(directory.props.teams, (team) => team.id), [away.id, home.id]);
  assert.equal(directory.props.live, true);
  app.unmount();
});

test('NBA Stat Hub retains all-team browsing when the selected date has no games', async () => {
  const app = setup('stats');
  app.props.games = []; app.render(); await app.settle();
  const select = app.nodes().find((node) => node.type === 'select');
  assert.ok(select);
  select.props.onChange({ target: { value: home.id } }); app.render();
  const directory = app.nodes().find((node) => node.type?.name === 'NBADirectory');
  assert.deepEqual(Array.from(directory.props.teams, (team) => team.id), [home.id]);
  assert.equal(directory.props.season, 2027);
  app.unmount();
});

test('NBA directory uses paired NFL team panels with actual positions, search, player and favorite actions', async () => {
  let opened;
  const props = { teams: [away, home], season: 2027, query: '', favorites: [], toggle() {}, open(player, team) { opened = [player.id, team.id]; }, live: true };
  const app = setup('stats', new Map(), { name: 'NBADirectory', props });
  app.data.fetchNBARoster = async (id) => [{ id: `player-${id}`, name: `Full Player ${id}`, position: id === away.id ? 'G' : 'C', jersey: '2',
    ...(id === away.id ? { headshot: 'https://a.espncdn.com/player-1.png' } : {}) }];
  // Retry the initial empty response using the resource's standard retry action.
  app.nodes().find((node) => node.type?.name === 'ResourceMessage').props.retry(); app.render(); await app.settle();
  assert.equal(app.nodes().filter((node) => node.props?.className === 'nfl-directory-team').length, 2);
  const photos = app.nodes().filter((node) => node.props?.className === 'nba-directory-headshot');
  assert.equal(photos.length, 1, 'Players without a supplied headshot remain name-only');
  assert.equal(photos[0].props.src, 'https://a.espncdn.com/player-1.png');
  assert.equal(photos[0].props.loading, 'lazy');
  assert.equal(photos[0].props.alt, '');
  const player = app.nodes().find((node) => node.props?.className === 'nfl-directory-player-main');
  player.props.onClick(); assert.deepEqual(opened, ['player-1', away.id]);
  const filter = app.nodes().find((node) => node.props?.role === 'tab' && node.props.children === 'C');
  filter.props.onClick(); app.render();
  assert.equal(app.nodes().filter((node) => node.props?.className === 'nfl-directory-player').length, 1);
  props.query = 'missing'; app.render();
  assert.equal(app.nodes().filter((node) => node.props?.className === 'nfl-directory-player').length, 0);
  assert.equal(app.nodes().filter((node) => node.type?.name === 'FavoriteButton').length, 2);
  app.unmount();
});

test('NBA selected-player window leads with NFL stat tabs and per-game chart, keeping zeros and missing values distinct', async () => {
  const props = { player: { id: '23', name: 'Actual Player', position: 'G', jersey: '23', headshot: 'https://a.espncdn.com/player-23.png' }, team: away, season: 2027, favorites: [], toggle() {}, close() {} };
  const app = setup('stats', new Map(), { name: 'PlayerProfile', props });
  assert.equal(app.nodes().find((node) => node.props?.className === 'nba-profile-headshot').props.src, props.player.headshot);
  delete props.player.headshot; app.render();
  assert.equal(app.nodes().filter((node) => node.props?.className === 'nba-profile-headshot').length, 0);
  app.data.fetchNBAPlayerProfile = async () => ({ games: [
    { id: '1', date: '2026-10-20', opponent: 'BOS', result: 'W', seasonType: 'Regular Season', stats: { points: 0, rebounds: 2 } },
    { id: '2', date: '2026-10-21', opponent: 'NY', result: 'L', seasonType: 'Regular Season', stats: { rebounds: 3 } },
  ], totals: {}, averages: {} });
  app.nodes().find((node) => node.type?.name === 'ResourceMessage').props.retry(); app.render(); await app.settle();
  assert.ok(app.nodes().find((node) => node.props?.className === 'nfl-player-dialog nba-stat-dialog'));
  assert.ok(app.nodes().find((node) => node.props?.className === 'nfl-player-stat-tabs'));
  assert.deepEqual(app.nodes().filter((node) => node.props?.className === 'nfl-game-bar-value').map((node) => node.props.children), ['—', '0']);
  app.nodes().find((node) => node.props?.className === 'nfl-player-stat-tabs').props.onSelect('rebounds'); app.render();
  assert.deepEqual(app.nodes().filter((node) => node.props?.className === 'nfl-game-bar-value').map((node) => node.props.children), ['3', '2']);
  assert.ok(app.nodes().find((node) => node.type === 'details'));
  app.unmount();
});

test('NBA directory orders each team top-to-bottom by season PPG, with zeros before missing and stable name ties', async () => {
  const props = { teams: [away, home], season: 2027, query: '', favorites: [], toggle() {}, open() {}, live: false };
  const app = setup('stats', new Map(), { name: 'NBADirectory', props });
  app.data.fetchNBARoster = async (teamId) => ['missing', 'zero', 'second', 'first', 'tie'].map((id) => ({ id: `${teamId}-${id}`, name: id, position: 'G', jersey: '' }));
  app.data.fetchNBAPointsPerGame = async () => ({ averages: Object.fromEntries([away, home].flatMap((team) => [
    [`${team.id}-zero`, 0], [`${team.id}-second`, 12], [`${team.id}-first`, 24], [`${team.id}-tie`, 12],
  ])), failed: [] });
  app.nodes().find((node) => node.type?.name === 'ResourceMessage').props.retry(); app.render(); await app.settle();
  const panels = app.nodes().filter((node) => node.props?.className === 'nfl-directory-team');
  for (const panel of panels) {
    const names = descendants(panel).filter((node) => node.props?.className === 'nfl-directory-player-main').map((node) => node.props.children[1].props.children[0].props.children);
    assert.deepEqual(names, ['first', 'second', 'tie', 'zero', 'missing']);
  }
  app.unmount();
});

test('Shared NFL/NBA tabs preserve scale-aware dragging, click selection and keyboard click behavior', () => {
  const source = ts.transpileModule(readFileSync(new URL('../src/DraggableTabs.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, window: { setTimeout() {} }, require(name) {
    if (name === 'react') return { useRef: (value) => ({ current: value }), useEffect() {} };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === './uiScale') return { getInterfaceScale: () => .5 };
    return {};
  } });
  vm.runInContext(source, context);
  const selected = [];
  const tree = context.exports.default({ options: [{ key: 'nba', label: 'NY @ BOS' }], selected: 'nba', onSelect: (key) => selected.push(key) });
  const strip = { scrollLeft: 0, classList: { add() {}, remove() {} }, setPointerCapture() {}, hasPointerCapture() { return false; } };
  const event = { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100, currentTarget: strip,
    target: { closest: () => ({ dataset: { tabKey: 'nba' } }) }, preventDefault() {} };
  tree.props.onPointerDown(event);
  tree.props.onPointerMove({ ...event, clientX: 50 });
  assert.equal(strip.scrollLeft, 100, 'Dragging accounts for Stat Hub interface scale');
  tree.props.onPointerUp(event);
  let suppressed = false;
  tree.props.onClickCapture({ preventDefault() { suppressed = true; }, stopPropagation() {} });
  assert.equal(suppressed, true);
  assert.deepEqual(selected, [], 'Dragging does not change the selected game');
  tree.props.onPointerDown(event); tree.props.onPointerUp(event);
  assert.deepEqual(selected, ['nba']);
  tree.props.children[0].props.onClick();
  assert.deepEqual(selected, ['nba', 'nba'], 'Keyboard-generated click retains selection');
});

test('Full NBA game log includes every season game and every box-score column independently of chart selection', async () => {
  const props = { player: { id: '23', name: 'Actual Player', position: 'G' }, team: away, season: 2027, favorites: [], toggle() {}, close() {} };
  const app = setup('stats', new Map(), { name: 'PlayerProfile', props });
  app.data.fetchNBAPlayerProfile = async () => ({ games: Array.from({ length: 25 }, (_, i) => ({
    id: String(i), date: '2026-10-21', atVs: '@', opponent: 'BOS', result: 'W', score: '100-99', seasonType: i < 20 ? 'Regular Season' : 'Preseason',
    display: { MIN: '30:30', FG: '0-5', FT: '0-0', '3PT': '0-2' }, stats: { points: 0, rebounds: 5, assists: 6 },
  })), totals: {}, averages: {} });
  app.nodes().find((node) => node.type?.name === 'ResourceMessage').props.retry(); app.render(); await app.settle();
  const log = () => app.nodes().find((node) => node.props?.className === 'nba-table nba-game-log');
  const rows = () => descendants(log()).filter((node) => node.type === 'tr');
  assert.equal(rows().length, 26, 'All 25 game rows, not only the 15 chart games');
  assert.equal(descendants(rows()[0]).filter((node) => node.type === 'th').length, 14);
  const values = descendants(rows()[1]).filter((node) => node.type === 'td').map((node) => node.props.children);
  assert.deepEqual(values.slice(1, 8), ['30:30', '0', '5', '6', '0-5', '0-0', '0-2']);
  assert.equal(values.at(-1), '—');
  app.nodes().find((node) => node.props?.className === 'nfl-player-stat-tabs').props.onSelect('rebounds'); app.render();
  assert.deepEqual(descendants(rows()[1]).filter((node) => node.type === 'td').map((node) => node.props.children), values);
  app.nodes().find((node) => node.type === 'select').props.onChange({ target: { value: 'Preseason' } }); app.render();
  assert.equal(rows().length, 6);
  app.unmount();
});
