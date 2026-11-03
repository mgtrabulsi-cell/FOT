import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideLiveFeedPoll, decideNFLDetailTargets, liveFeedQueryDates, nflSeasonYear, normalizeNBAGames,
  normalizeNFLGameDetails, normalizeNFLGames, readAPISportsResponse, utcDay,
} from '../supabase/functions/_shared/apiSportsFeed.ts';
import {
  apiSportsBoxScore, applyLiveFeed, completedPeriodScores, fetchLiveFeed, fetchLiveFeedGameDetails, readLiveFeedRows,
} from '../src/services/liveFeed.ts';

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
  const demoted = applyLiveFeed([finalGame], [feedRow()])[0];
  assert.equal(demoted.liveSource, undefined, 'An ESPN final never reverts to live');
  assert.equal(demoted.providerGameId, '21632', 'The provider link is still recorded');
  const pregame = applyLiveFeed([espnGame()], [feedRow({ status: 'UPCOMING' })])[0];
  assert.equal(pregame.liveSource, undefined, 'Upcoming rows never override live data');
  assert.equal(pregame.providerGameId, '21632');
  const stale = applyLiveFeed([espnGame()], [feedRow({ fetched_at: new Date(Date.now() - 10 * 60_000).toISOString() })])[0];
  assert.equal(stale.liveSource, undefined, 'Stale live rows never override the feed');
  assert.equal(stale.providerGameId, '21632');
  const oldFinal = applyLiveFeed([espnGame()], [feedRow({ status: 'FINAL', fetched_at: new Date(Date.now() - 20 * 3_600_000).toISOString(), clock: null, period: 4 })])[0];
  assert.equal(oldFinal.status, 'FINAL', 'Final rows never go stale');
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
    assert.equal(request.searchParams.get('fetched_at'), 'gte.2026-10-31T03:00:00.000Z', 'Rows are bounded to the last two days');
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

const detailPlayersPayload = {
  response: [
    { team: { id: 18, name: 'Washington Commanders' }, groups: [
      { name: 'Passing', players: [
        { player: { id: 25745, name: 'Jayden Daniels', image: 'https://media.api-sports.io/american-football/players/25745.png' },
          statistics: [{ name: 'comp att', value: '16/29' }, { name: 'yards', value: '217' }, { name: 'passing touch downs', value: '1' }, { name: 'two pt', value: null }] },
      ] },
      { name: 'Kick Returns', players: [
        { player: { id: 7, name: 'Luke McCaffrey', image: null },
          statistics: [{ name: 'total', value: '2' }, { name: 'yards', value: '44' }] },
      ] },
      { name: 'Empty Group', players: [] },
    ] },
    { team: { id: 12, name: 'Philadelphia Eagles' }, groups: [
      { name: 'Rushing', players: [
        { player: { id: 219, name: 'Saquon Barkley', image: 'https://media.api-sports.io/american-football/players/219.png' },
          statistics: [{ name: 'total rushes', value: '18' }, { name: 'yards', value: '88' }, { name: 'rushing touch downs', value: '1' }] },
      ] },
    ] },
  ],
};
const detailTeamsPayload = {
  response: [
    { team: { id: 18, name: 'Washington Commanders' }, statistics: {
      first_downs: { total: 16, third_down_efficiency: '5-13' }, yards: { total: 339 },
      passing: { total: 204, comp_att: '16/29' }, posession: { total: '26:29' }, turnovers: { total: 1 },
    } },
    { team: { id: 12, name: 'Philadelphia Eagles' }, statistics: { yards: { total: 288 }, penalties: { total: '9-70' } } },
  ],
};
const finalRow = () => ({ ...feedRow(), status: 'FINAL', period: 4, clock: null, away_score: 10, home_score: 27 });

test('Game details normalize player groups and curated team stats per side without inventing values', () => {
  const payload = normalizeNFLGameDetails(finalRow(), detailPlayersPayload, detailTeamsPayload);
  assert.equal(payload.status, 'FINAL');
  assert.equal(payload.home.apiSportsId, '18');
  assert.equal(payload.away.apiSportsId, '12');
  assert.equal(payload.home.groups.length, 2, 'Empty groups are dropped');
  const passing = payload.home.groups[0];
  assert.equal(passing.players[0].name, 'Jayden Daniels');
  assert.deepEqual(passing.players[0].stats[0], { name: 'comp att', value: '16/29' });
  assert.equal(passing.players[0].stats[3].value, null, 'Null statistics stay null, never zero');
  assert.deepEqual(payload.home.teamStats.find((stat) => stat.name === 'Possession'), { name: 'Possession', value: '26:29' });
  assert.deepEqual(payload.away.teamStats, [{ name: 'Total yards', value: '288' }, { name: 'Penalties', value: '9-70' }]);
  const missingSide = normalizeNFLGameDetails({ ...finalRow(), away_name: 'Someone Else' }, detailPlayersPayload, detailTeamsPayload);
  assert.equal(missingSide.away, null, 'Unmatched team names never cross-assign stats');
});

test('Detail polling refreshes stale live games first, snapshots finals once and respects the cap', () => {
  const now = new Date('2026-11-02T23:00:00Z');
  const games = [
    { provider_game_id: 'live-stale', status: 'LIVE' },
    { provider_game_id: 'live-fresh', status: 'LIVE' },
    { provider_game_id: 'final-new', status: 'FINAL' },
    { provider_game_id: 'final-done', status: 'FINAL' },
    { provider_game_id: 'pregame', status: 'UPCOMING' },
  ];
  const details = [
    { provider_game_id: 'live-stale', status: 'LIVE', fetched_at: '2026-11-02T22:50:00Z' },
    { provider_game_id: 'live-fresh', status: 'LIVE', fetched_at: '2026-11-02T22:59:00Z' },
    { provider_game_id: 'final-done', status: 'FINAL', fetched_at: '2026-11-02T20:00:00Z' },
    { provider_game_id: 'final-new', status: 'LIVE', fetched_at: '2026-11-02T22:58:00Z' },
  ];
  assert.deepEqual(decideNFLDetailTargets(games, details, now, 6), ['live-stale', 'final-new']);
  assert.deepEqual(decideNFLDetailTargets(games, details, now, 1), ['live-stale'], 'Budget caps apply');
  assert.deepEqual(decideNFLDetailTargets(games, [], now, 6), ['live-stale', 'live-fresh', 'final-new', 'final-done'], 'Missing details are fetched');
  assert.deepEqual(decideNFLDetailTargets(games, details, now, 0), [], 'No budget means no detail requests');
});

const gameDetails = (overrides = {}) => ({
  status: 'FINAL', clock: null, period: 4,
  away: { apiSportsId: '12', name: 'Philadelphia Eagles', teamStats: [{ name: 'Total yards', value: '288' }], groups: [
    { name: 'Rushing', players: [{ id: '219', name: 'Saquon Barkley', image: 'https://media.api-sports.io/american-football/players/219.png',
      stats: [{ name: 'total rushes', value: '18' }, { name: 'yards', value: '88' }, { name: 'kick return td', value: null }] }] },
    { name: 'Kick Returns', players: [{ id: '7', name: 'Luke McCaffrey', image: null, stats: [{ name: 'total', value: '2' }] }] },
  ] },
  home: { apiSportsId: '18', name: 'Washington Commanders', teamStats: [], groups: [
    { name: 'Passing', players: [{ id: '25745', name: 'Jayden Daniels', image: null,
      stats: [{ name: 'comp att', value: '16/29' }, { name: 'rating', value: '58.9' }] }] },
  ] },
  fetched_at: new Date().toISOString(),
  ...overrides,
});

test('The box score adapter keeps ESPN identity, maps category names for filters and labels stats readably', () => {
  const game = espnGame({ status: 'FINAL', completedPeriods: [
    { period: 1, awayScore: 10, homeScore: 3 }, { period: 2, awayScore: 10, homeScore: 13 },
    { period: 3, awayScore: 10, homeScore: 16 }, { period: 4, awayScore: 10, homeScore: 27 },
  ] });
  const box = apiSportsBoxScore(gameDetails(), game);
  assert.equal(box.source, 'api-sports');
  assert.equal(box.eventId, '401', 'ESPN event IDs are preserved for snapshots and navigation');
  assert.equal(box.isFinal, true);
  assert.equal(box.status, 'Final');
  const [away, home] = box.teams;
  assert.equal(away.id, '21', 'ESPN team IDs are preserved');
  assert.equal(away.record, '6-2', 'ESPN records are preserved');
  assert.deepEqual(away.linescores, ['10', '0', '0', '0'], 'Linescores derive from cumulative period scores');
  assert.equal(away.categories[0].name, 'rushing');
  assert.equal(away.categories[1].name, 'kickReturns', 'Category names align with the Special Teams filter');
  assert.deepEqual(away.categories[0].labels, ['CAR', 'YDS'], 'All-null columns are dropped');
  assert.deepEqual(away.categories[0].athletes[0].stats, ['18', '88']);
  assert.equal(away.categories[0].athletes[0].shortName, 'S. Barkley');
  assert.deepEqual(home.categories[0].labels, ['C/ATT', 'RTG']);
  const live = apiSportsBoxScore(gameDetails({ status: 'LIVE', clock: '4:12', period: 3 }), espnGame());
  assert.equal(live.isLive, true);
  assert.equal(live.status, 'Q3 · 4:12');
  assert.equal(apiSportsBoxScore(gameDetails({ status: 'UPCOMING' }), game), null, 'Pregame details never render a box');
  assert.equal(apiSportsBoxScore(gameDetails({ home: null }), game), null, 'A missing side falls back to the data feed');
});

test('Game detail reads validate payloads and reject stale live details but trust finals forever', async () => {
  const original = globalThis.fetch;
  let payload;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.apikey, 'public-test-key');
    assert.equal(new URL(url).searchParams.get('provider_game_id'), 'eq.21632');
    return Response.json(payload);
  };
  const config = { url: 'https://gamewire.test', key: 'public-test-key' };
  try {
    payload = [{ status: 'FINAL', fetched_at: '2026-11-02T04:00:00Z', payload: gameDetails() }];
    const finals = await fetchLiveFeedGameDetails('NFL', '21632', undefined, config, Date.parse('2026-11-03T04:00:00Z'));
    assert.equal(finals.status, 'FINAL', 'Day-old finals are still served');
    payload = [{ status: 'LIVE', fetched_at: '2026-11-03T03:50:00Z', payload: gameDetails({ status: 'LIVE' }) }];
    assert.equal(await fetchLiveFeedGameDetails('NFL', '21632', undefined, config, Date.parse('2026-11-03T04:00:00Z')), null, 'Ten-minute-old live stats are stale');
    payload = [];
    assert.equal(await fetchLiveFeedGameDetails('NFL', '21632', undefined, config, Date.parse('2026-11-03T04:00:00Z')), null, 'Missing rows fall back');
    payload = [{ status: 'FINAL', fetched_at: 'garbage', payload: gameDetails() }];
    assert.equal(await fetchLiveFeedGameDetails('NFL', '21632', undefined, config, Date.parse('2026-11-03T04:00:00Z')), null, 'Malformed rows fall back');
    assert.equal(await fetchLiveFeedGameDetails('NFL', '21632', undefined, null), null, 'Unconfigured builds skip the feed');
  } finally {
    globalThis.fetch = original;
  }
});
