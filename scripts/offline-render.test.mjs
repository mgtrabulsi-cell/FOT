import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Board day grouping follows the viewer's local clock; pin it so CI (UTC) matches US viewers.
process.env.TZ = 'America/New_York';
import { detailsSnapshotKey, readGameDetailsSnapshot, readRenderSnapshot, saveRenderSnapshot, stopRenderSnapshots, teamSnapshotKey, readNBADirectorySnapshot, readNBAComparisonSnapshot, subscribeRenderSnapshots, readLastNBAStatHub, saveLastNBAStatHub } from '../src/services/renderSnapshots.ts';
import { rankTeamAverages, teamComparisonMetrics } from '../src/services/teamComparisonRanks.ts';

const source = readFileSync(new URL('../src/TheWire.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText
  .replace(/from ['"]react['"]/g, `from '${import.meta.resolve('react')}'`)
  .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
  .replace(/from ['"]lucide-react['"]/g, `from '${import.meta.resolve('lucide-react')}'`)
  .replace(/from ['"].\/services\/sportsData['"]/g, `from '${new URL('../src/services/sportsData.ts', import.meta.url)}'`)
  .replace(/from ['"].\/services\/foregroundRefresh['"]/g, `from '${new URL('../src/services/foregroundRefresh.ts', import.meta.url)}'`)
  .replace(/from ['"].\/services\/renderSnapshots['"]/g, `from '${new URL('../src/services/renderSnapshots.ts', import.meta.url)}'`)
  .replace(/from ['"].\/services\/nflSituation.ts['"]/g, `from '${new URL('../src/services/nflSituation.ts', import.meta.url)}'`)
  .replace(/from ['"].\/services\/teamComparisonRanks.ts['"]/g, `from '${new URL('../src/services/teamComparisonRanks.ts', import.meta.url)}'`)
  .replace(/import OfflineImage from ['"].\/OfflineImage['"];/, 'const OfflineImage = () => null;')
  .replace(/import \{ useSwipeBack \} from ['"].\/useSwipeBack['"];/, 'const useSwipeBack = () => ({ current: null });')
  .replace(/import \{ ScoreTicker \} from ['"].\/ScoreTicker.tsx['"];/, 'const ScoreTicker = ({ value }) => value;')
  .replace(/import \{ getInterfaceScale \} from ['"].\/uiScale['"];/, 'const getInterfaceScale = () => 1;')
  .replace(/import \{ usePublicDataRevision \} from ['"].\/usePublicDataRevision['"];/, 'const usePublicDataRevision = () => 0;');
const { default: TheWire } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const { default: TeamComparison } = await import(`data:text/javascript;base64,${Buffer.from(compiled.replace("useState('boxscore')", "useState('teamStats')")).toString('base64')}`);

function withStorage(run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map();
  const target = {
    get length() { return entries.size; },
    key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: target });
  try { return run(target, entries); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
}

const away = { id: '1', name: 'Away Team', abbr: 'AWY', score: 0, record: '3-2', color: '#112233' };
const home = { ...away, id: '2', name: 'Home Team', abbr: 'HME' };
const game = {
  id: 'NFL:123', eventId: '123', feedPath: 'football/nfl', sport: 'Football', league: 'NFL',
  status: 'UPCOMING', period: '', clock: '', date: '2026-10-18T20:25:00Z', venue: 'Test Stadium', seasonYear: 2026, away, home,
};
const player = {
  id: '987', name: 'Saved Quarterback', position: 'QB', jersey: '4',
  gamesWithUsage: 5, passingAttempts: 150, targets: 0, receptions: 0, carries: 3, recentGames: [],
};
const categories = [{
  name: 'passing', title: 'Passing', labels: ['GP', 'CMP', 'ATT', 'YDS', 'TD', 'INT'],
  athletes: [{ ...player, shortName: player.name, stats: ['5', '120', '150', '1381', '10', '2'] }],
}];
const players = { data: { teamId: away.id, categories, failedPlayers: 0 }, players: [player] };
const props = { games: [game], query: '', favorites: [], featuredFavoriteTeamId: null, onToggleFavorite() {}, onOpenPlayer() {}, openGameId: game.id };

test('NFL dims only a final loser across the board, wheel, matchup and team tabs, leaving live games and ties unchanged', () => withStorage(() => {
  for (const [status, awayScore, homeScore, losingSide] of [
    ['FINAL', 10, 24, 'away'], ['FINAL', 31, 0, 'home'], ['FINAL', 17, 17, null],
    ['LIVE', 10, 24, null], ['UPCOMING', 0, 0, null],
  ]) {
    const matchup = { ...game, status, away: { ...away, score: awayScore }, home: { ...home, score: homeScore } };
    const board = renderToStaticMarkup(createElement(TheWire, { ...props, games: [matchup], openGameId: null }));
    assert.equal((board.match(/wire-board-team is-loser/g) ?? []).length, losingSide ? 1 : 0);
    const html = renderToStaticMarkup(createElement(TheWire, { ...props, games: [matchup] }));
    assert.equal((html.match(/wire-wheel-row is-loser/g) ?? []).length, losingSide ? 1 : 0);
    assert.equal((html.match(/wire-matchup-team wire-team-(?:left|right) is-loser/g) ?? []).length, losingSide ? 1 : 0);
    assert.equal((html.match(/wire-team-half wire-team-half-(?:away|home)[^"]* is-loser/g) ?? []).length, losingSide ? 1 : 0);
    if (losingSide) {
      assert.match(html, new RegExp(`wire-matchup-team wire-team-${losingSide === 'away' ? 'left' : 'right'} is-loser`));
      assert.match(html, new RegExp(`wire-team-half-${losingSide}[^"]* is-loser`));
    }
  }
}));

test('The Wire opens to a kickoff-ordered game board grouped TNF to MNF, with no stats until a game is opened', () => withStorage(() => {
  const at = (id, date, status = 'UPCOMING', extra = {}) => ({ ...game, ...extra, id: `NFL:${id}`, eventId: id, date, status });
  const games = [
    at('5', '2026-10-20T00:15:00Z', 'UPCOMING'),
    at('2', '2026-10-18T17:00:00Z', 'FINAL', { away: { ...away, score: 10 }, home: { ...home, score: 24 } }),
    at('1', '2026-10-16T00:15:00Z', 'FINAL'),
    at('4', '2026-10-19T00:20:00Z', 'LIVE', { situation: { possessionTeamId: home.id, fieldPosition: 'HME 20' } }),
    at('3', '2026-10-18T20:25:00Z'),
    at('6', '2026-10-18T13:30:00Z', 'FINAL', { venue: 'Wembley Stadium', venueCity: 'London', venueCountry: 'England' }),
  ];
  const html = renderToStaticMarkup(createElement(TheWire, { ...props, games, openGameId: null, now: Date.parse('2026-10-17T16:00:00Z') }));
  const order = [...html.matchAll(/data-game-id="NFL:(\d)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ['1', '6', '2', '3', '4', '5']);
  const days = [...html.matchAll(/class="wire-board-day-title"[^>]*>(.*?)<\/h2>/g)].map((match) => match[1]);
  assert.equal(days.length, 3);
  assert.equal(days.filter((day) => /^Sunday/.test(day)).length, 1);
  const titles = [...html.matchAll(/class="wire-board-slot-title">(.*?)<\/h3>/g)].map((match) => match[1]);
  assert.match(titles[0], /Thursday Night Football/);
  assert.match(titles[1], /INTL.*International Series · London/);
  assert.match(titles[1], /<svg class="wire-flag"/);
  assert.match(titles[4], /Sunday Night Football/);
  assert.match(titles[5], /Monday Night Football/);
  assert.match(html, /Wembley Stadium, London/);
  assert.match(html, /1 live/);
  assert.match(html, /Home Team has possession/);
  assert.match(html, /Ball at HME 20/);
  assert.match(html, /class="wire-board-team is-loser"/);
  assert.doesNotMatch(html, /wire-hero-banner|Player Box Score|All games|wire-board-spotlight/);
  const filtered = renderToStaticMarkup(createElement(TheWire, { ...props, games, openGameId: null, query: 'zzz' }));
  assert.match(filtered, /No games matched/);
  assert.doesNotMatch(filtered, /data-game-id=/);
}));

test('The MNF game is featured above the board from 6 AM Monday until 2 AM Tuesday ET', () => withStorage(() => {
  const at = (id, date, status = 'UPCOMING') => ({ ...game, id: `NFL:${id}`, eventId: id, date, status });
  const games = [
    at('1', '2026-10-16T00:15:00Z', 'FINAL'),
    at('2', '2026-10-18T17:00:00Z', 'FINAL'),
    at('3', '2026-10-20T00:15:00Z'),
  ];
  const render = (iso) => renderToStaticMarkup(createElement(TheWire, { ...props, games, openGameId: null, now: Date.parse(iso) }));
  const order = (html) => [...html.matchAll(/data-game-id="NFL:(\d)"/g)].map((match) => match[1]);
  // 6:00 AM Monday and 1:59 AM Tuesday ET (EDT = UTC-4).
  for (const iso of ['2026-10-19T10:00:00Z', '2026-10-20T05:59:00Z']) {
    const html = render(iso);
    assert.match(html, /class="wire-board-spotlight"[^]*?Tonight · Monday Night Football/);
    assert.deepEqual(order(html), ['3', '1', '2'], iso);
    assert.doesNotMatch(html, /class="wire-board-slot-title">.*?Monday Night Football/);
  }
  for (const iso of ['2026-10-19T09:59:00Z', '2026-10-20T06:00:00Z']) {
    const html = render(iso);
    assert.doesNotMatch(html, /wire-board-spotlight/, iso);
    assert.deepEqual(order(html), ['1', '2', '3'], iso);
  }
  const filtered = renderToStaticMarkup(createElement(TheWire, { ...props, games, openGameId: null, query: 'zzz', now: Date.parse('2026-10-19T12:00:00Z') }));
  assert.match(filtered, /No games matched/);
}));

test('Opening a game shows its stats area with a way back to the board', () => withStorage(() => {
  const html = renderToStaticMarkup(createElement(TheWire, props));
  assert.match(html, /All games/);
  assert.match(html, /wire-hero-banner/);
  assert.doesNotMatch(html, /wire-board-card/);
}));

test('An opening with no saved scoreboard renders safely before the first download', () => withStorage(() => {
  assert.doesNotThrow(() => renderToStaticMarkup(createElement(TheWire, { ...props, games: [] })));
}));

test('The Wire renders saved player names and season totals on its FIRST render without fetch or effects', () => withStorage(() => {
  saveRenderSnapshot('players', teamSnapshotKey(game.feedPath, away.id, game.seasonYear), players);
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('Network must not be needed for first render'); };
  try {
    const html = renderToStaticMarkup(createElement(TheWire, props));
    assert.match(html, /Saved Quarterback/);
    assert.match(html, /1381/);
    assert.match(html, /Away Team Passing season totals/);
    assert.doesNotMatch(html, /Loading player season totals/);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
}));

test('Live and final game tables also render synchronously from their own saved game', () => withStorage(() => {
  saveRenderSnapshot('box', 'football/nfl:123', {
    eventId: '123', status: 'Final', state: 'post', clock: '', period: 4, isLive: false, isFinal: true,
    teams: [away, home].map((team, index) => ({
      ...team, score: '21', abbreviation: team.abbr, homeAway: index ? 'home' : 'away',
      linescores: ['7', '7', '7', '0'], categories: index ? [] : categories, teamStats: [],
    })),
  });
  for (const status of ['LIVE', 'FINAL']) {
    const html = renderToStaticMarkup(createElement(TheWire, { ...props, games: [{ ...game, status }] }));
    assert.match(html, /Saved Quarterback/);
    assert.match(html, /1381/);
    assert.doesNotMatch(html, /Loading live box score/);
  }
}));

test('Pregame comparison shows all eight saved ranks on both sides, never in live/final stats', () => withStorage(() => {
  const teams = Array.from({ length: 32 }, (_, index) => ({
    teamId: String(index + 1),
    ...Object.fromEntries(teamComparisonMetrics.map(({ key }) => [key, index + 1])),
  }));
  teams[0].pointsPerGame = 2;
  const ranks = rankTeamAverages(teams, game.seasonYear);
  saveRenderSnapshot('teamRanks', `${game.feedPath}:${game.seasonYear}`, ranks);
  for (const team of teams.slice(0, 2)) saveRenderSnapshot('team', teamSnapshotKey(game.feedPath, team.teamId, game.seasonYear), team);
  const render = (status) => renderToStaticMarkup(createElement(TeamComparison, { ...props, games: [{ ...game, status }] }));
  const html = render('UPCOMING');
  assert.equal((html.match(/class="wire-comp-rank"/g) ?? []).length, 16);
  assert.equal((html.match(/T-31 NFL/g) ?? []).length, 2);
  assert.match(html, /#1 NFL/);
  assert.doesNotMatch(html, /Rank unavailable/);
  for (const status of ['LIVE', 'FINAL']) assert.doesNotMatch(render(status), /wire-comp-rank|T-31 NFL/);
  assert.equal(readRenderSnapshot('teamRanks', `${game.feedPath}:2025`), null);
  const originalError = console.error;
  let errors = 0;
  console.error = () => errors++;
  try {
    saveRenderSnapshot('teamRanks', 'invalid', { ...ranks, teams: Array(32).fill(ranks.teams[0]) });
    assert.equal(readRenderSnapshot('teamRanks', 'invalid'), null);
    assert.equal(errors, 1);
  } finally { console.error = originalError; }
}));

test('Live matchup and wheel show the possessing team and reported field location only while live', () => withStorage(() => {
  const situation = { possessionTeamId: away.id, fieldPosition: 'AWY 39', downDistance: '2nd & 3' };
  const render = (status, next = situation) => renderToStaticMarkup(createElement(TheWire, {
    ...props, games: [{ ...game, status, situation: next }],
  }));
  const live = render('LIVE');
  assert.equal((live.match(/aria-label="Away Team has possession"/g) ?? []).length, 2);
  assert.doesNotMatch(live, /Home Team has possession/);
  assert.match(live, /Ball at AWY 39/);
  const turnover = render('LIVE', { ...situation, possessionTeamId: home.id });
  assert.equal((turnover.match(/aria-label="Home Team has possession"/g) ?? []).length, 2);
  assert.doesNotMatch(turnover, /Away Team has possession/);
  const unavailable = render('LIVE', {});
  assert.match(unavailable, /Field position unavailable/);
  assert.doesNotMatch(unavailable, /has possession/);
  for (const status of ['FINAL', 'UPCOMING']) {
    const html = render(status);
    assert.doesNotMatch(html, /has possession|Ball at AWY 39|Field position unavailable/);
  }
}));

test('Saved displays isolate team, season, game and week; details keys ignore team order', () => withStorage(() => {
  const key = teamSnapshotKey('football/nfl', '1', 2026);
  saveRenderSnapshot('players', key, players);
  assert.deepEqual(readRenderSnapshot('players', key), players);
  assert.equal(readRenderSnapshot('players', teamSnapshotKey('football/nfl', '2', 2026)), null);
  assert.equal(readRenderSnapshot('players', teamSnapshotKey('football/nfl', '1', 2025)), null);
  assert.equal(readRenderSnapshot('box', 'football/nfl:999'), null);
  saveRenderSnapshot('scoreboard', 'current', { games: [game], failedLeagues: [], nflWeek: 6 });
  assert.equal(readRenderSnapshot('scoreboard', '5'), null);
  assert.equal(readRenderSnapshot('scoreboard', 'current').games[0].eventId, '123');
  assert.equal(detailsSnapshotKey('football/nfl', '123', 2026, ['1', '2']), detailsSnapshotKey('football/nfl', '123', 2026, ['2', '1']));
}));

test('Stat Hub can compose both saved team rosters without waiting for their combined request', () => withStorage(() => {
  const forms = [away, home].map((team) => ({ teamId: team.id, skillPlayers: [player], recentGames: [] }));
  for (const form of forms) {
    saveRenderSnapshot('details', detailsSnapshotKey(game.feedPath, game.eventId, game.seasonYear, [form.teamId]), { teamForms: [form] });
  }
  assert.deepEqual(readGameDetailsSnapshot(game.feedPath, game.eventId, game.seasonYear, [away.id, home.id]), { teamForms: forms });
  assert.equal(readGameDetailsSnapshot(game.feedPath, 'another-game', game.seasonYear, [away.id, home.id]), null);
}));

test('Display storage is bounded, preserves unrelated preferences, and retains a good copy on write failure', () => withStorage((storage, entries) => {
  storage.setItem('gamewire-favorites', 'keep');
  for (let i = 0; i < 170; i++) saveRenderSnapshot('players', `team:${i}`, players);
  assert.equal(entries.size, 161);
  assert.equal(storage.getItem('gamewire-favorites'), 'keep');
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  try {
    saveRenderSnapshot('players', 'team:169', { ...players, players: [] });
    assert.deepEqual(readRenderSnapshot('players', 'team:169'), players);
    assert.equal(errors.length, 1);
  } finally { console.error = originalError; }
}));

test('Invalid saved displays are rejected and reported instead of crashing a player table', () => withStorage((storage) => {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    for (const value of ['{broken', '{"version":1,"data":{}}', '{"version":0,"data":{}}']) {
      storage.setItem('gamewire-render-v1:/:players:bad', value);
      assert.equal(readRenderSnapshot('players', 'bad'), null);
    }
    assert.equal(errors.length, 3);
  } finally { console.error = originalError; }
}));

test('NBA summaries persist across reads and reject corrupted nested stats with an explicit error', () => withStorage((storage) => {
  const key = 'basketball/nba:401:2027';
  const summary = { eventId: '401', status: 'in', clock: '1:00', period: 'Q4', teams: [{ id: '1', stats: [],
    players: [{ id: '23', name: 'Saved NBA Player', position: 'G', stats: { points: 0 }, display: { MIN: '10' },
      starter: true, didNotPlay: false, reason: '' }] }], plays: [] };
  saveRenderSnapshot('nbaSummary', key, summary);
  assert.deepEqual(readRenderSnapshot('nbaSummary', key), summary);
  assert.equal(readRenderSnapshot('nbaSummary', 'basketball/nba:402:2027'), null);
  assert.equal(readRenderSnapshot('nbaSummary', 'basketball/nba:401:2028'), null);
  const errors = [], originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    summary.teams[0].players[0].display = null;
    storage.setItem(`gamewire-render-v1:/:nbaSummary:${key}`, JSON.stringify({ version: 1, data: summary }));
    assert.equal(readRenderSnapshot('nbaSummary', key), null);
    assert.equal(errors.length, 1);
  } finally { console.error = originalError; }
}));

test('NBA profiles, rankings and league snapshots survive reloads with isolated seasons and reject invalid data', () => withStorage((storage) => {
  const entries = [
    ['nbaProfile', 'profile:23:2027', { season: 2027, totals: { points: 0 }, averages: { points: 0 }, games: [
      { id: '401', date: '2026-10-24', opponent: 'BOS', result: 'W', score: '110-100', seasonType: 'Regular season', stats: { points: 0 } },
    ] }],
    ['nbaScoring', 'scoring:1,2:2027', { averages: { '23': 0 }, failed: [], updatedAt: Date.now() }],
    ['nbaLeague', 'nba-league', { teams: [{ id: '1', name: 'Team', abbr: 'TM', color: '123456', score: 0, record: '' }], season: 2027 }],
  ];
  for (const [kind, key, value] of entries) {
    saveRenderSnapshot(kind, key, value);
    assert.deepEqual(readRenderSnapshot(kind, key), value);
    assert.equal(readRenderSnapshot(kind, `${key}:other`), null);
  }
  const originalError = console.error, errors = [];
  console.error = (...args) => errors.push(args);
  try {
    storage.setItem('gamewire-render-v1:/:nbaProfile:bad', JSON.stringify({ version: 1, data: { season: 2027, averages: {}, totals: {}, games: [null] } }));
    assert.equal(readRenderSnapshot('nbaProfile', 'bad'), null);
    assert.equal(errors.length, 1);
  } finally { console.error = originalError; }
}));

test('NBA views compose team caches without a combined snapshot and notify already-open displays', () => withStorage(() => {
  const teams = ['a', 'b'].map(id => ({ id, name: id, abbr: id, color: '123456', score: 0, record: '' }));
  const players = [{ id: 'p1', name: 'Player', position: 'G', jersey: '', teamId: 'a' }];
  let notifications = 0;
  const unsubscribe = subscribeRenderSnapshots(() => notifications++);
  saveRenderSnapshot('nbaRoster', 'roster:a:2027', players);
  assert.equal(notifications, 1);
  assert.deepEqual(readNBADirectorySnapshot(teams, 2027), [{ team: teams[0], players }]);
  assert.equal(readNBADirectorySnapshot(teams, 2028), null);
  saveRenderSnapshot('nbaRoster', 'roster:b:2027', []);
  assert.equal(readNBADirectorySnapshot(teams, 2027).length, 2, 'Empty saved roster is valid');
  saveRenderSnapshot('nbaTeamSeason', 'season:a:2027', []);
  saveRenderSnapshot('nbaTeamSeason', 'season:b:2027', []);
  assert.deepEqual(readNBAComparisonSnapshot('a', 'b', 2027), { away: [], home: [] });
  assert.ok(readRenderSnapshot('nbaRoster', 'roster:a:2027', 300_000));
  assert.equal(readRenderSnapshot('nbaRoster', 'roster:a:2027', 0), null);
  unsubscribe();
  const before = notifications;
  saveRenderSnapshot('nbaRoster', 'roster:b:2028', []);
  assert.equal(notifications, before, 'Unmounted views do not receive cache notifications');
}));

test('Last NBA Stat Hub list migrates old saved directories, survives cache churn, and ignores empty replacements', () => withStorage((storage) => {
  const team = { id: 'a', name: 'Saved team', abbr: 'SAV', color: '123456', score: 0, record: '' };
  const groups = [{ team, players: [{ id: 'saved', name: 'Saved player', position: 'G', jersey: '1', teamId: team.id }] }];
  saveRenderSnapshot('nbaDirectory', 'directory:a:2027', groups);
  assert.deepEqual(readLastNBAStatHub(), { season: 2027, groups }, 'Existing users restore their old cache without a network visit');
  saveLastNBAStatHub(readLastNBAStatHub());
  for (let index = 0; index < 200; index++) saveRenderSnapshot('nbaPlayerSeason', `player-season:${index}:2027`, { season: 2027, averages: { points: index }, totals: {} });
  assert.equal(readRenderSnapshot('nbaDirectory', 'directory:a:2027'), null, 'Normal cache entry is evicted');
  assert.deepEqual(readLastNBAStatHub(), { season: 2027, groups }, 'Startup list survives player-stat cache churn');
  saveLastNBAStatHub({ season: 2028, groups: [] });
  assert.deepEqual(readLastNBAStatHub(), { season: 2027, groups });
  storage.removeItem('gamewire-render-v1:/:nbaStatHub:last');
  assert.equal(readLastNBAStatHub(), null, 'Removed storage is not secretly restored from another source');
}));

test('Account deletion stops late requests from recreating display snapshots', () => withStorage((storage) => {
  saveRenderSnapshot('players', 'before', players);
  stopRenderSnapshots();
  storage.removeItem('gamewire-render-v1:/:players:before');
  saveRenderSnapshot('players', 'late', players);
  assert.equal(storage.length, 0);
  assert.equal(readRenderSnapshot('players', 'late'), null);
}));
