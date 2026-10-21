import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { readRenderSnapshot, saveRenderSnapshot } from '../src/services/renderSnapshots.ts';
import { fetchPPRProjections, lastFiveAverage, moveMatchupPick, readMatchupPicks, readPlayerAverage, readPPRActuals, readPPRProjections } from '../src/services/matchupBoard.ts';

const pick = (id, position) => ({ id, position, name: `Player ${id}`, teamId: '1', gameId: 'NFL:123', headshot: '' });

const compiled = ts.transpileModule(readFileSync(new URL('../src/FavorableMatchups.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText
  .replace(/from ['"]react['"]/g, `from '${import.meta.resolve('react')}'`)
  .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
  .replace(/from ['"]lucide-react['"]/g, `from '${import.meta.resolve('lucide-react')}'`)
  .replace(/from ['"]\.\/services\/(sportsData|matchupBoard|analystReads|renderSnapshots)['"]/g,
    (_, name) => `from '${new URL(`../src/services/${name}.ts`, import.meta.url)}'`)
  .replace(/import OfflineImage from [^;]+;/, 'const OfflineImage = () => null;')
  .replace(/import \{ usePublicDataRevision \} from [^;]+;/, 'const usePublicDataRevision = () => 0;')
  .replace(/import \{ supabase \} from [^;]+;/, 'const supabase = null;')
  .replace(/import \{ useAnalystReadObserver \} from [^;]+;/, 'const useAnalystReadObserver = () => ({root:{current:null},error:""});');
const { default: FantasyBoard } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('Both Fantasy boards render saved players and metrics synchronously without requests or effects', () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalFetch = globalThis.fetch;
  const entries = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return entries.size; }, key: index => [...entries.keys()][index] ?? null,
    getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key),
  } });
  globalThis.fetch = () => { throw new Error('First render must not fetch'); };
  try {
    for (const boardType of ['top', 'hate']) {
      const key = `2026:7:${boardType}`;
      saveRenderSnapshot('fantasyBoard', key, { picks: [pick(boardType === 'top' ? '111' : '222', 'QB')], revision: 5 });
      const id = boardType === 'top' ? '111' : '222';
      saveRenderSnapshot('fantasyAverages', key, { [id]: { average: 281.5, games: 5 } });
      saveRenderSnapshot('fantasyPPR', key, { projections: { [id]: 20.3 }, actuals: { [id]: 22.4 } });
      const html = renderToStaticMarkup(createElement(FantasyBoard, { games: [], season: 2026, week: 7, user: null, boardType }));
      assert.match(html, new RegExp(`Player ${id}`));
      assert.match(html, /281\.5/);
      assert.match(html, /20\.3/);
      assert.doesNotMatch(html, /Loading this week/);
      assert.doesNotMatch(html, new RegExp(`Player ${boardType === 'top' ? '222' : '111'}`));
    }
    for (const [season, week] of [[2026, 8], [2025, 7]]) {
      const html = renderToStaticMarkup(createElement(FantasyBoard, { games: [], season, week, user: null, boardType: 'top' }));
      assert.doesNotMatch(html, /Player 111|281\.5|20\.3/);
      assert.match(html, /Loading this week/);
    }
    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    try {
      entries.set('gamewire-render-v1:/:fantasyBoard:2026:1:top', JSON.stringify({ version: 1, data: { picks: [{}], revision: 1 } }));
      assert.equal(readRenderSnapshot('fantasyBoard', '2026:1:top'), null);
      assert.equal(errors.length, 1);
    } finally { console.error = originalError; }
  } finally {
    globalThis.fetch = originalFetch;
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
    else delete globalThis.localStorage;
  }
});

test('Moves players only within their position without changing other groups', () => {
  const original = [pick('1', 'QB'), pick('2', 'RB'), pick('3', 'QB'), pick('4', 'QB')];
  const next = moveMatchupPick(original, '3', -1);
  assert.deepEqual(next.map((item) => item.id), ['3', '2', '1', '4']);
  assert.deepEqual(original.map((item) => item.id), ['1', '2', '3', '4']);
  assert.strictEqual(moveMatchupPick(original, '1', -1), original);
  assert.strictEqual(moveMatchupPick(original, '4', 1), original);
  assert.strictEqual(moveMatchupPick(original, 'missing', 1), original);
});

test('Published selection parser preserves ordering and rejects malformed players', () => {
  const picks = [pick('4', 'TE'), pick('2', 'RB')];
  assert.deepEqual(readMatchupPicks(picks), picks);
  assert.throws(() => readMatchupPicks({}));
  assert.throws(() => readMatchupPicks([{ ...pick('1', 'QB'), position: 'K' }]));
});

test('Average uses the five most recent games before kickoff, with zero preserved', () => {
  const recentGames = Array.from({ length: 8 }, (_, i) => ({
    gameId: String(i), date: `2026-09-${String(i + 1).padStart(2, '0')}T17:00:00Z`,
    stats: { passingYards: i * 10 },
  }));
  const game = { eventId: '7', date: '2026-09-08T17:00:00Z' };
  assert.deepEqual(lastFiveAverage({ recentGames }, 'QB', game), { average: 40, games: 5 });
  assert.equal(lastFiveAverage({ recentGames: [{ ...recentGames[0], stats: { rushingYards: 0 } }] }, 'RB', game).average, 0);
  assert.equal(lastFiveAverage(undefined, 'TE', game).average, null);
});

test('Missing stats do not become zeros or pull in older games', () => {
  const recentGames = Array.from({ length: 6 }, (_, i) => ({
    gameId: String(i), date: `2026-09-${String(i + 1).padStart(2, '0')}T17:00:00Z`,
    stats: i === 5 ? {} : { receivingYards: 40 },
  }));
  assert.deepEqual(lastFiveAverage({ recentGames }, 'WR', { eventId: 'next', date: '2026-10-01T17:00:00Z' }), { average: 40, games: 4 });
});

test('Bryce Young regular-season average excludes preseason, future games and blank stats', () => {
  const events = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i), { gameDate: `2026-09-${String(i + 1).padStart(2, '0')}T17:00:00Z` }]));
  const payload = {
    names: ['passingYards', 'rushingYards'], events,
    seasonTypes: [{ categories: [
      { splitType: '1', events: [{ eventId: '0', stats: ['999', '0'] }] },
      { splitType: '2', events: [329, 291, 287, 361].map((value, i) => ({ eventId: String(i + 1), stats: [String(value), '0'] })).concat([
        { eventId: '5', stats: ['--', '0'] }, { eventId: '6', stats: ['900', '0'] },
      ]) },
    ] }],
  };
  const game = { eventId: '6', date: events['6'].gameDate };
  assert.deepEqual(readPlayerAverage(payload, 'QB', game), { average: 317, games: 4 });
  assert.deepEqual(readPlayerAverage(payload, 'RB', game), { average: 0, games: 5 });
  assert.deepEqual(readPlayerAverage(payload, 'WR', game), { average: null, games: 0 });
  assert.throws(() => readPlayerAverage({}, 'QB', game), /invalid player game log/);
});

test('Projection requires the exact season/week, projected source and weekly split', () => {
  const base = { seasonId: 2026, scoringPeriodId: 6, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 17.8 };
  const rows = [
    { ...base, seasonId: 2025, appliedTotal: 99 },
    { ...base, scoringPeriodId: 5, appliedTotal: 88 },
    { ...base, statSourceId: 0, appliedTotal: 77 },
    { ...base, statSplitTypeId: 0, appliedTotal: 66 },
    base,
  ];
  const payload = { players: [{ player: { id: 123, stats: rows } }, { player: { id: 456, stats: [{ ...base, appliedTotal: 0 }] } }] };
  assert.deepEqual([...readPPRProjections(payload, 2026, 6)], [['123', 17.8], ['456', 0]]);
  assert.equal(readPPRProjections(payload, 2026, 7).size, 0);
  assert.throws(() => readPPRProjections({}, 2026, 6));
  assert.deepEqual([...readPPRActuals(payload, 2026, 6)], [['123', 77]]);
  assert.equal(readPPRActuals(payload, 2025, 6).size, 0);
});

test('Projection requests target selected players with the required limit sort and verify PPR', async (t) => {
  const calls = [];
  let scoringItems = [{ statId: 53, points: 1 }];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        settings: { scoringSettings: { scoringItems } },
        players: [{ player: { id: 3139477, stats: [{ seasonId: 2026, scoringPeriodId: 6, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 21.3 }] } }],
      }),
    };
  });
  const signal = new AbortController().signal;
  assert.equal((await fetchPPRProjections(2026, 6, [], signal)).size, 0);
  assert.equal(calls.length, 0);
  const result = await fetchPPRProjections(2026, 6, ['3139477', '3918298'], signal);
  assert.equal(result.get('3139477'), 21.3);
  assert.equal(result.has('3918298'), false);
  assert.match(calls[0].url, /seasons\/2026\/.*scoringPeriodId=6$/);
  const filter = JSON.parse(calls[0].options.headers['X-Fantasy-Filter']);
  assert.deepEqual(filter.players.filterIds.value, [3139477, 3918298]);
  assert.equal(filter.players.limit, 2);
  assert.equal(filter.players.sortPercOwned.sortPriority, 1);
  assert.equal(calls[0].options.signal, signal);
  scoringItems = [{ statId: 53, points: 0.5 }];
  await assert.rejects(fetchPPRProjections(2026, 6, ['3139477'], signal), /PPR scoring could not be verified/);
});
