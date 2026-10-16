import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { detailsSnapshotKey, readGameDetailsSnapshot, readRenderSnapshot, saveRenderSnapshot, stopRenderSnapshots, teamSnapshotKey } from '../src/services/renderSnapshots.ts';

const source = readFileSync(new URL('../src/TheWire.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText
  .replace(/from ['"]react['"]/g, `from '${import.meta.resolve('react')}'`)
  .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
  .replace(/from ['"]lucide-react['"]/g, `from '${import.meta.resolve('lucide-react')}'`)
  .replace(/from ['"].\/services\/sportsData['"]/g, `from '${new URL('../src/services/sportsData.ts', import.meta.url)}'`)
  .replace(/from ['"].\/services\/renderSnapshots['"]/g, `from '${new URL('../src/services/renderSnapshots.ts', import.meta.url)}'`)
  .replace(/import OfflineImage from ['"].\/OfflineImage['"];/, 'const OfflineImage = () => null;')
  .replace(/import \{ getInterfaceScale \} from ['"].\/uiScale['"];/, 'const getInterfaceScale = () => 1;')
  .replace(/import \{ usePublicDataRevision \} from ['"].\/usePublicDataRevision['"];/, 'const usePublicDataRevision = () => 0;');
const { default: TheWire } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

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
const props = { games: [game], query: '', favorites: [], featuredFavoriteTeamId: null, onToggleFavorite() {}, onOpenPlayer() {} };

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

test('Account deletion stops late requests from recreating display snapshots', () => withStorage((storage) => {
  saveRenderSnapshot('players', 'before', players);
  stopRenderSnapshots();
  storage.removeItem('gamewire-render-v1:/:players:before');
  saveRenderSnapshot('players', 'late', players);
  assert.equal(storage.length, 0);
  assert.equal(readRenderSnapshot('players', 'late'), null);
}));
