import assert from 'node:assert/strict';
import test from 'node:test';
import { nbaNearbyDates, preloadNBABoxes, preloadNBADates, saveNBASummary } from '../src/services/nbaPreload.ts';
import { gameSnapshotKey, readRenderSnapshot } from '../src/services/renderSnapshots.ts';

function storage() {
  const entries = new Map();
  return { get length() { return entries.size; }, key: (i) => [...entries.keys()][i] ?? null,
    getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) };
}
const game = { eventId: '401', feedPath: 'basketball/nba', seasonYear: 2027, status: 'FINAL', away: { id: '1' }, home: { id: '2' } };
const key = gameSnapshotKey(game.feedPath, game.eventId, game.seasonYear);
const player = { id: '23', name: 'Player', position: 'G', stats: { points: 0 }, display: {}, starter: true, didNotPlay: false, reason: '' };
const summary = { eventId: '401', status: 'post', clock: '0.0', period: 'Q4', teams: ['1', '2'].map((id) => ({ id, players: [player], stats: [] })), plays: [] };

test('preloaded NBA finals persist without opening, skip completed saved boxes, and live games refresh', async () => {
  const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() });
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ header: { competitions: [{ status: { type: { state: 'post' } } }] },
      boxscore: { players: ['1', '2'].map((id) => ({ team: { id }, statistics: [{ names: ['PTS'], athletes: [
        { athlete: { id: '23', displayName: 'Player', position: { abbreviation: 'G' } }, starter: true, stats: ['0'] },
      ] }] })) } });
  };
  try {
    assert.deepEqual(await preloadNBABoxes([game, { ...game, eventId: 'upcoming', status: 'UPCOMING' }], new AbortController().signal), []);
    assert.equal(requests, 1);
    assert.equal(readRenderSnapshot('nbaSummary', key).teams[0].players[0].stats.points, 0);
    await preloadNBABoxes([game], new AbortController().signal);
    assert.equal(requests, 1, 'Saved final is ready immediately without repeated preloads');
    await preloadNBABoxes([{ ...game, status: 'LIVE' }], new AbortController().signal);
    assert.equal(requests, 2);
    saveNBASummary(key, { ...summary, plays: Array.from({ length: 200 }, (_, i) => ({ id: String(i), text: 'Play', period: 4, clock: '0', scoring: false })) });
    assert.equal(readRenderSnapshot('nbaSummary', key).plays.length, 80);
    assert.throws(() => saveNBASummary(key, { ...summary, teams: [] }), /incomplete/);
    assert.equal(readRenderSnapshot('nbaSummary', key).teams.length, 2);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(preloadNBABoxes([{ ...game, status: 'LIVE' }], controller.signal), { name: 'AbortError' });
  } finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  }
});

test('next seven NBA dates and yesterday are saved for immediate selection, including empty schedules and month boundaries', async () => {
  const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() });
  const requests = [];
  globalThis.fetch = async (address) => { requests.push(String(address)); return Response.json({ events: [] }); };
  try {
    assert.deepEqual(nbaNearbyDates('2026-10-31'), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-10-30']);
    assert.deepEqual(await preloadNBADates('2026-10-31', new AbortController().signal), []);
    assert.equal(requests.length, 8);
    for (const date of nbaNearbyDates('2026-10-31')) assert.deepEqual(readRenderSnapshot('scoreboard', `NBA:${date}`).games, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  }
});
