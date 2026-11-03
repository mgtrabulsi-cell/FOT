import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideLiveFeedPoll, liveFeedQueryDates, nflSeasonYear, normalizeNBAGames, normalizeNFLGames, readAPISportsResponse, utcDay,
} from '../supabase/functions/_shared/apiSportsFeed.ts';
import { applyLiveFeed, completedPeriodScores, fetchLiveFeed, readLiveFeedRows } from '../src/services/liveFeed.ts';

const nflGame = (overrides = {}) => ({
  game: {
    id: 21632,
    date: { timezone: 'UTC', date: '2026-11-02', time: '01:20', timestamp: 1793582400 },
    status: { short: 'FT', long: 'Finished', timer: null },
    ...overrides.game,
  },
  teams: { home: { id: 18, name: 'Washington Commanders' }, away: { id: 12, name: 'Philadelphia Eagles' } },
  scores: {
    home: { quarter_1: 3, quarter_2: 10, quarter_3: 3, quarter_4: 11, overtime: null, total: 27 },
    away: { quarter_1: 10, quarter_2: 0, quarter_3: 0, quarter_4: 0, overtime: null, total: 10 },
    ...overrides.scores,
  },
});

test('NFL games normalize finals, live quarters, halftime and scheduled kickoffs without inventing data', () => {
  const [finished] = normalizeNFLGames({ response: [nflGame()] });
  assert.deepEqual(finished, {
    sport: 'NFL', provider_game_id: '21632', start_time: '2026-11-02T01:20:00.000Z',
    away_name: 'Philadelphia Eagles', home_name: 'Washington Commanders',
    away_score: 10, home_score: 27,
    away_linescore: [10, 0, 0, 0], home_linescore: [3, 10, 3, 11],
    status: 'FINAL', period: 4, clock: null,
  });
  const [live] = normalizeNFLGames({ response: [nflGame({
    game: { id: 1, date: { timestamp: 1793582400 }, status: { short: 'Q2', long: 'In Play', timer: '7:41' } },
    scores: { home: { quarter_1: 3, quarter_2: 7, quarter_3: null, quarter_4: null, overtime: null, total: 10 },
      away: { quarter_1: 0, quarter_2: 0, quarter_3: null, quarter_4: null, overtime: null, total: 0 } },
  })] });
  assert.equal(live.status, 'LIVE');
  assert.equal(live.period, 2);
  assert.equal(live.clock, '7:41');
  assert.deepEqual(live.home_linescore, [3, 7]);
  const [half] = normalizeNFLGames({ response: [nflGame({ game: { id: 2, date: { timestamp: 1793582400 }, status: { short: 'HT', long: 'Halftime', timer: null } } })] });
  assert.equal(half.clock, 'Halftime');
  assert.equal(half.period, 2);
  const [upcoming] = normalizeNFLGames({ response: [nflGame({
    game: { id: 3, date: { timestamp: 1793582400 }, status: { short: 'NS', long: 'Not Started', timer: null } },
    scores: { home: { total: null }, away: { total: null } },
  })] });
  assert.equal(upcoming.status, 'UPCOMING');
  assert.equal(upcoming.away_score, null);
  assert.deepEqual(upcoming.away_linescore, []);
});

const nbaGame = (overrides = {}) => ({
  id: 17031, league: 'standard', season: 2026,
  date: { start: '2026-11-02T01:30:00.000Z' },
  status: { clock: null, halftime: false, short: 3, long: 'Finished' },
  periods: { current: 4, total: 4 },
  teams: { visitors: { id: 16, name: 'LA Clippers', code: 'LAC' }, home: { id: 11, name: 'Golden State Warriors', code: 'GSW' } },
  scores: { visitors: { linescore: ['37', '20', '28', '27'], points: 112 }, home: { linescore: ['29', '34', '29', '32'], points: 124 } },
  ...overrides,
});

test('NBA games normalize finals and live clocks, convert string linescores and skip non-standard leagues', () => {
  const [finished] = normalizeNBAGames({ response: [nbaGame()] });
  assert.deepEqual(finished, {
    sport: 'NBA', provider_game_id: '17031', start_time: '2026-11-02T01:30:00.000Z',
    away_name: 'LA Clippers', home_name: 'Golden State Warriors',
    away_score: 112, home_score: 124,
    away_linescore: [37, 20, 28, 27], home_linescore: [29, 34, 29, 32],
    status: 'FINAL', period: 4, clock: null,
  });
  const [live] = normalizeNBAGames({ response: [nbaGame({
    status: { clock: '5:12', halftime: false, short: 2, long: 'In Play' }, periods: { current: 3, total: 4 },
    scores: { visitors: { linescore: ['30', '25', '10'], points: 65 }, home: { linescore: ['28', '31', '12'], points: 71 } },
  })] });
  assert.equal(live.status, 'LIVE');
  assert.equal(live.period, 3);
  assert.equal(live.clock, '5:12');
  assert.equal(normalizeNBAGames({ response: [nbaGame({ league: 'vegas' })] }).length, 0);
  const [scheduled] = normalizeNBAGames({ response: [nbaGame({
    status: { clock: null, halftime: false, short: 1, long: 'Scheduled' }, periods: { current: 0, total: 4 },
    scores: { visitors: { linescore: [], points: null }, home: { linescore: [], points: null } },
  })] });
  assert.equal(scheduled.status, 'UPCOMING');
});

test('Plan and quota errors from API-Sports surface instead of erasing saved games', () => {
  assert.throws(() => readAPISportsResponse({ errors: { plan: 'Free plans do not have access to this season.' }, response: [] }), /Free plans/);
  assert.throws(() => readAPISportsResponse({ errors: [], response: 'bad' }), /invalid/);
  assert.deepEqual(readAPISportsResponse({ errors: [], response: [] }), []);
});

test('Poll decisions respect per-sport budgets, live cadences and UTC day rollovers', () => {
  const now = new Date('2026-11-02T23:00:00Z');
  const liveGame = [{ start_time: '2026-11-02T22:00:00Z', status: 'LIVE' }];
  assert.equal(decideLiveFeedPoll('NFL', now, null, []).poll, true, 'First poll always runs');
  const recent = { day: '2026-11-02', requests_used: 10, last_polled_at: '2026-11-02T22:59:30Z' };
  assert.equal(decideLiveFeedPoll('NFL', now, recent, liveGame).poll, false, 'NFL waits a full cadence between polls');
  assert.equal(decideLiveFeedPoll('NFL', now, { ...recent, last_polled_at: '2026-11-02T22:58:00Z' }, liveGame).poll, true, 'NFL polls every minute during live games');
  assert.equal(decideLiveFeedPoll('NFL', now, { ...recent, last_polled_at: '2026-11-02T22:50:00Z' }, []).poll, false, 'Idle NFL waits fifteen minutes');
  assert.equal(decideLiveFeedPoll('NBA', now, { day: '2026-11-02', requests_used: 88, last_polled_at: '2026-11-02T20:00:00Z' }, liveGame).poll, false, 'The NBA free budget is never exceeded');
  assert.equal(decideLiveFeedPoll('NBA', new Date('2026-11-03T00:30:00Z'), { day: '2026-11-02', requests_used: 88, last_polled_at: '2026-11-02T23:00:00Z' }, liveGame).poll, true, 'Budgets reset at the UTC day rollover');
  assert.equal(decideLiveFeedPoll('NBA', now, { day: '2026-11-02', requests_used: 10, last_polled_at: '2026-11-02T22:55:00Z' }, liveGame).poll, false, 'NBA live cadence is slower than NFL');
  assert.equal(decideLiveFeedPoll('NBA', now, { day: '2026-11-02', requests_used: 10, last_polled_at: '2026-11-02T22:45:00Z' }, liveGame).poll, true);
  const upcoming = [{ start_time: '2026-11-02T23:05:00Z', status: 'UPCOMING' }];
  assert.equal(decideLiveFeedPoll('NFL', now, { ...recent, last_polled_at: '2026-11-02T22:58:00Z' }, upcoming).poll, true, 'Pregame windows count as live');
});

test('Query dates span the Eastern game day and the NFL season year rolls over in March', () => {
  assert.deepEqual(liveFeedQueryDates(new Date('2026-11-02T20:00:00Z')), ['2026-11-02', '2026-11-03']);
  assert.deepEqual(liveFeedQueryDates(new Date('2026-11-03T02:00:00Z')), ['2026-11-02', '2026-11-03'], 'Late Eastern evenings stay on the same game day');
  assert.equal(nflSeasonYear(new Date('2026-11-02T20:00:00Z')), 2026);
  assert.equal(nflSeasonYear(new Date('2027-01-15T20:00:00Z')), 2026, 'January playoff games belong to the prior season');
  assert.equal(utcDay(new Date('2026-11-03T02:00:00Z')), '2026-11-03');
});

const feedRow = (overrides = {}) => ({
  provider_game_id: '21632', start_time: '2026-11-02T01:20:00.000Z',
  away_name: 'Philadelphia Eagles', home_name: 'Washington Commanders',
  away_score: 10, home_score: 20,
  away_linescore: [10, 0, 0], home_linescore: [3, 10, 7],
  status: 'LIVE', period: 3, clock: '4:12', fetched_at: new Date().toISOString(),
  ...overrides,
});

const espnGame = (overrides = {}) => ({
  id: 'NFL:401', eventId: '401', feedPath: 'football/nfl', sport: 'Football', league: 'NFL',
  status: 'LIVE', period: 'Q3', clock: '5:00', date: '2026-11-02T01:20:00Z',
  venue: 'Northwest Stadium', seasonYear: 2026,
  away: { id: '21', name: 'Philadelphia Eagles', abbr: 'PHI', score: 10, record: '6-2', color: '#004c54' },
  home: { id: '28', name: 'Washington Commanders', abbr: 'WSH', score: 13, record: '3-5', color: '#5a1414' },
  completedPeriods: [{ period: 1, awayScore: 10, homeScore: 3 }],
  situation: { down: 2, distance: 7 },
  ...overrides,
});

test('The live overlay replaces scores, clock and period for matched games and labels the provider', () => {
  const [game] = applyLiveFeed([espnGame()], [feedRow()]);
  assert.equal(game.liveSource, 'api-sports');
  assert.equal(game.away.score, 10);
  assert.equal(game.home.score, 20);
  assert.equal(game.period, 'Q3');
  assert.equal(game.clock, '4:12');
  assert.deepEqual(game.completedPeriods, [
    { period: 1, awayScore: 10, homeScore: 3 },
    { period: 2, awayScore: 10, homeScore: 13 },
  ]);
  assert.deepEqual(game.situation, { down: 2, distance: 7 }, 'ESPN situation details stay during live play');
  assert.equal(game.away.record, '6-2', 'ESPN enrichment is preserved');
});

test('The overlay never resurrects finished games, ignores upcoming rows and leaves unmatched games alone', () => {
  const finalGame = espnGame({ status: 'FINAL', clock: 'Final' });
  assert.equal(applyLiveFeed([finalGame], [feedRow()])[0].liveSource, undefined, 'An ESPN final never reverts to live');
  assert.equal(applyLiveFeed([espnGame()], [feedRow({ status: 'UPCOMING' })])[0].liveSource, undefined, 'Upcoming rows never override live data');
  const other = espnGame({ away: { ...espnGame().away, name: 'Dallas Cowboys' } });
  assert.equal(applyLiveFeed([other], [feedRow()])[0].liveSource, undefined, 'Different matchups never cross-contaminate');
  const farApart = applyLiveFeed([espnGame({ date: '2026-11-09T01:20:00Z' })], [feedRow()]);
  assert.equal(farApart[0].liveSource, undefined, 'Same matchup a week apart is a different game');
  const ended = applyLiveFeed([espnGame()], [feedRow({ status: 'FINAL', away_linescore: [10, 0, 0, 0], home_linescore: [3, 10, 7, 7], away_score: 10, home_score: 27, clock: null, period: 4 })])[0];
  assert.equal(ended.status, 'FINAL');
  assert.equal(ended.clock, 'Final');
  assert.equal(ended.situation, undefined, 'Down and distance clear when the game ends');
  assert.equal(ended.completedPeriods.length, 4);
});

test('Completed period scores stay cumulative, include halftime and never count the running quarter', () => {
  assert.deepEqual(completedPeriodScores({ status: 'LIVE', period: 3, clock: '4:12', away_linescore: [10, 0, 7], home_linescore: [3, 10, 0] }), [
    { period: 1, awayScore: 10, homeScore: 3 }, { period: 2, awayScore: 10, homeScore: 13 },
  ]);
  assert.deepEqual(completedPeriodScores({ status: 'LIVE', period: 2, clock: 'Halftime', away_linescore: [10, 0], home_linescore: [3, 10] }), [
    { period: 1, awayScore: 10, homeScore: 3 }, { period: 2, awayScore: 10, homeScore: 13 },
  ]);
  assert.deepEqual(completedPeriodScores({ status: 'LIVE', period: 1, clock: '12:00', away_linescore: [0], home_linescore: [0] }), []);
});

test('The live feed read uses public-only credentials, filters by freshness and tolerates malformed rows', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(new URL(url));
    assert.equal(options.headers.apikey, 'public-test-key');
    assert.equal(options.headers.Authorization, undefined);
    return Response.json([feedRow(), { provider_game_id: 42 }, 'garbage']);
  };
  try {
    const rows = await fetchLiveFeed('NFL', undefined, { url: 'https://gamewire.test/', key: 'public-test-key' }, Date.parse('2026-11-02T03:00:00Z'));
    assert.equal(rows.length, 1, 'Malformed rows are dropped');
    assert.equal(rows[0].provider_game_id, '21632');
    const [request] = requests;
    assert.equal(request.pathname, '/rest/v1/live_feed_games');
    assert.equal(request.searchParams.get('sport'), 'eq.NFL');
    assert.equal(request.searchParams.get('fetched_at'), 'gte.2026-11-02T02:57:00.000Z', 'NFL rows older than three minutes are stale');
    assert.deepEqual(await fetchLiveFeed('NFL', undefined, null), [], 'Unconfigured builds skip the feed');
  } finally {
    globalThis.fetch = original;
  }
});

test('Live feed rows validate required fields before reaching the scoreboard', () => {
  assert.throws(() => readLiveFeedRows({}), /invalid/);
  assert.deepEqual(readLiveFeedRows([{ ...feedRow(), status: 'HALFTIME' }]), [], 'Unknown statuses are rejected');
  assert.deepEqual(readLiveFeedRows([{ ...feedRow(), start_time: 'yesterday' }]), [], 'Invalid timestamps are rejected');
  const [row] = readLiveFeedRows([{ ...feedRow(), away_score: '10', away_linescore: ['x', 3] }]);
  assert.equal(row.away_score, null, 'String scores are not trusted');
  assert.deepEqual(row.away_linescore, [3], 'Only numeric linescore entries survive');
});
