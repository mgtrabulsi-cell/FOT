import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fetchNBAScoreboard, nbaCalendarDate, readNBAScoreboard } from '../src/services/sportsData.ts';

const competitor = (id, side, score) => ({
  homeAway: side, score: String(score), team: { id, displayName: `NBA Team ${id}`, abbreviation: `T${id}` },
  records: [{ summary: '2-1' }], linescores: [{ period: 1, value: 28 }, { period: 2, value: 30 }],
});
const payload = (state = 'in', period = 2, displayClock = '5:20') => ({
  season: { year: 2027 }, events: [{
    id: '401', date: '2026-10-24T00:00:00Z', competitions: [{
      competitors: [competitor('1', 'away', 50), competitor('2', 'home', 48)],
      status: { period, displayClock, type: { state } }, venue: { fullName: 'NBA Arena' },
    }],
  }],
});

test('NBA scoreboards carry NBA identity, ESPN season, live quarter/clock and completed checkpoints', () => {
  const [game] = readNBAScoreboard(payload());
  assert.equal(game.id, 'NBA:401');
  assert.equal(game.feedPath, 'basketball/nba');
  assert.equal(game.league, 'NBA');
  assert.equal(game.sport, 'Basketball');
  assert.equal(game.seasonYear, 2027);
  assert.equal(game.period, 'Q2');
  assert.equal(game.clock, '5:20');
  assert.equal(game.status, 'LIVE');
  assert.equal(game.completedPeriods.length, 1);
  assert.equal(game.situation, undefined);
  assert.equal(readNBAScoreboard(payload('in', 5))[0].period, 'OT');
  assert.equal(readNBAScoreboard(payload('in', 6))[0].period, 'OT2');
  assert.equal(readNBAScoreboard(payload('post', 4))[0].status, 'FINAL');
  assert.deepEqual(readNBAScoreboard({ events: [] }), []);
  assert.throws(() => readNBAScoreboard({}), /invalid game list/);
  assert.throws(() => readNBAScoreboard({ events: [{ id: 'broken' }] }), /invalid matchup/);
});

test('NBA dates use Eastern calendar boundaries and requests preserve date and cancellation', async () => {
  assert.equal(nbaCalendarDate(new Date('2026-10-24T01:00:00Z')), '2026-10-23');
  const original = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (address, init) => {
    const url = new URL(address);
    assert.equal(url.pathname, '/apis/site/v2/sports/basketball/nba/scoreboard');
    assert.equal(url.searchParams.get('dates'), '20261023');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal);
    return Response.json(payload());
  };
  try {
    assert.equal((await fetchNBAScoreboard('2026-10-23', controller.signal)).length, 1);
    for (const date of ['2026-02-30', '', '2026/10/23']) await assert.rejects(fetchNBAScoreboard(date), /valid NBA calendar date/);
  } finally { globalThis.fetch = original; }
});

test('NBA does not opt favorite accounts into NFL push delivery and has separate daily archives', () => {
  const poller = readFileSync(new URL('../supabase/functions/poll-live-games/index.ts', import.meta.url), 'utf8');
  assert.match(poller, /\.filter\(\(favorite\) => favorite\.feedPath === 'football\/nfl'\)/);
  assert.match(poller, /if \(favorite\.feedPath !== 'football\/nfl'\) return false/);
  assert.doesNotMatch(poller, /basketball\/nba/);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /role="group" aria-label="Select sport"/);
  assert.match(app, /archiveDate: selectedNBADate/);
  const history = readFileSync(new URL('../src/useLockerRoomHistory.ts', import.meta.url), 'utf8');
  assert.match(history, /save_locker_room_daily_history/);
  assert.match(history, /game\.league === 'NBA'\s*\? await fetchNBALivePlayerStats/);
});
