import assert from 'node:assert/strict';
import test from 'node:test';
import { preloadNFLLiveBoxes } from '../src/services/nflBoxPreload.ts';
import { fetchNFLBoxScore } from '../src/services/sportsData.ts';
import { readRenderSnapshot } from '../src/services/renderSnapshots.ts';

test('Live NFL boxes preload before opening, reuse recent snapshots, and retain players after empty or failed refreshes', async () => {
  const originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return entries.size; }, key: (i) => [...entries.keys()][i] ?? null,
    getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  } });
  const game = { league: 'NFL', feedPath: 'football/nfl', eventId: '123', status: 'LIVE' };
  let requests = 0, empty = false;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(options.cache, 'no-store');
    assert.match(String(url), /summary\?event=123/);
    return Response.json({
      header: { competitions: [{
        status: { type: { state: 'in' }, displayClock: '5:00', period: 3 },
        competitors: ['1', '2'].map((id) => ({
          homeAway: id === '1' ? 'away' : 'home', team: { id, displayName: `Team ${id}`, abbreviation: id }, score: '7',
        })),
      }] },
      boxscore: { players: empty ? [] : ['1', '2'].map((id) => ({
        team: { id }, statistics: [{ name: 'passing', labels: ['YDS'], names: ['passingYards'],
          athletes: [{ athlete: { id: `p${id}`, displayName: 'Saved live player' }, stats: ['123'] }] }],
      })) },
    });
  };
  try {
    await preloadNFLLiveBoxes([game, { ...game, eventId: 'pre', status: 'UPCOMING' }, { ...game, eventId: 'final', status: 'FINAL' }], new AbortController().signal);
    assert.equal(requests, 1);
    const saved = readRenderSnapshot('box', 'football/nfl:123');
    assert.equal(saved.teams[0].categories[0].athletes[0].name, 'Saved live player');
    await preloadNFLLiveBoxes([game], new AbortController().signal);
    assert.equal(requests, 1, 'A just-saved open box is not downloaded again by the warmer');
    const key = [...entries.keys()].find((key) => key.endsWith('box:football/nfl:123'));
    const raw = JSON.parse(entries.get(key));
    raw.savedAt -= 16000; entries.set(key, JSON.stringify(raw));
    await preloadNFLLiveBoxes([game], new AbortController().signal);
    assert.equal(requests, 2, 'Stale live snapshots refresh');
    empty = true;
    await assert.rejects(fetchNFLBoxScore('football/nfl', '123'), /incomplete/);
    assert.equal(readRenderSnapshot('box', 'football/nfl:123').teams[0].categories[0].athletes.length, 1);
    globalThis.fetch = async () => { throw new Error('Offline'); };
    await assert.rejects(fetchNFLBoxScore('football/nfl', '123'), /Offline/);
    assert.equal(readRenderSnapshot('box', 'football/nfl:123').teams[0].categories[0].athletes.length, 1);
    const controller = new AbortController(); controller.abort();
    raw.savedAt = 0; entries.set(key, JSON.stringify(raw));
    await assert.rejects(preloadNFLLiveBoxes([game], controller.signal), { name: 'AbortError' });
  } finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
