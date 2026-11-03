import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideLiveFeedPoll, decideNFLDetailTargets, liveFeedQueryDates, nflSeasonYear, normalizeNBAGames,
  normalizeNFLGameDetails, normalizeNFLGames, normalizeNFLTeamGame, readAPISportsResponse, readNFLSeasonFinals, utcDay,
} from '../supabase/functions/_shared/apiSportsFeed.ts';
import {
  apiSportsBoxScore, applyLiveFeed, completedPeriodScores, fetchLiveFeed, fetchLiveFeedGameDetails,
  fetchNFLSeasonAveragesFeed, readLiveFeedRows,
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

const seasonGame = (id, stage = 'Regular Season', status = 'FT', overrides = {}) => ({
  game: { id, stage, date: { date: '2026-10-26' }, status: { short: status, long: '' } },
  teams: { home: { id: 18, name: 'Washington Commanders' }, away: { id: 12, name: 'Philadelphia Eagles' } },
  scores: { home: { total: 27 }, away: { total: 10 } },
  ...overrides,
});

test('Season finals keep only finished regular-season games', () => {
  const finals = readNFLSeasonFinals({ response: [
    seasonGame(1), seasonGame(2, 'Pre Season'), seasonGame(3, 'Regular Season', 'NS'), seasonGame(4, 'Post Season'),
    seasonGame(5, 'Regular Season', 'AOT'),
  ] });
  assert.deepEqual(finals.map((final) => final.provider_game_id), ['1', '5']);
  assert.deepEqual(finals[0].home, { id: '18', name: 'Washington Commanders', points: 27 });
  assert.equal(finals[0].game_date, '2026-10-26');
});

test('Team game rows pair each side with its opponent and never cross-assign yardage', () => {
  const [final] = readNFLSeasonFinals({ response: [seasonGame(21632)] });
  const rows = normalizeNFLTeamGame(2026, final, detailTeamsPayload, (apiId) => (apiId === '18' ? '28' : apiId === '12' ? '21' : null));
  assert.equal(rows.length, 2);
  const home = rows.find((row) => row.api_team_id === '18');
  const away = rows.find((row) => row.api_team_id === '12');
  assert.equal(home.espn_team_id, '28');
  assert.equal(home.points_for, 27);
  assert.equal(home.points_against, 10);
  assert.equal(home.yards, 339);
  assert.equal(home.yards_against, 288, 'Opponent yardage lands in the against column');
  assert.equal(away.yards, 288);
  assert.equal(away.yards_against, 339);
  assert.equal(away.pass_yards_against, 204);
  const incomplete = normalizeNFLTeamGame(2026, final, { response: [detailTeamsPayload.response[0]] }, () => null);
  assert.deepEqual(incomplete, [], 'A final missing one side of stats is skipped, not half-recorded');
});

test('Season averages only serve complete syncs and keep metrics unavailable when any game lacks them', async () => {
  const original = globalThis.fetch;
  const config = { url: 'https://gamewire.test', key: 'public-test-key' };
  const row = (team, extra = {}) => ({
    espn_team_id: team, points_for: 24, points_against: 17, yards: 350, pass_yards: 250, rush_yards: 100,
    yards_against: 300, pass_yards_against: 200, rush_yards_against: 100, ...extra,
  });
  let state, rows;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.apikey, 'public-test-key');
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('live_feed_season_state')) return Response.json(state);
    assert.equal(parsed.searchParams.get('espn_team_id'), 'not.is.null');
    return Response.json(rows);
  };
  try {
    state = [{ finals_total: 120, finals_synced: 100 }];
    assert.equal(await fetchNFLSeasonAveragesFeed(2031, undefined, config), null, 'Partial syncs are never averaged');
    state = [{ finals_total: 0, finals_synced: 0 }];
    assert.equal(await fetchNFLSeasonAveragesFeed(2032, undefined, config), null, 'An empty season has no averages');
    state = [{ finals_total: 2, finals_synced: 2 }];
    rows = [row('28'), row('28', { points_for: 30, yards: 450 }), row('21', { yards: null })];
    const feed = await fetchNFLSeasonAveragesFeed(2033, undefined, config);
    const washington = feed.get('28');
    assert.equal(washington.pointsPerGame, 27, 'Averages are computed over synced games');
    assert.equal(washington.totalYardsPerGame, 400);
    assert.equal(washington.source, 'api-sports');
    const philadelphia = feed.get('21');
    assert.equal(philadelphia.totalYardsPerGame, null, 'A missing yardage value keeps the metric unavailable');
    assert.equal(philadelphia.pointsPerGame, 24);
    assert.equal(await fetchNFLSeasonAveragesFeed(2033, undefined, null), null, 'Unconfigured builds skip the feed');
  } finally {
    globalThis.fetch = original;
  }
});

test('Player names normalize for bridging without losing distinct identities', async () => {
  const { normalizePlayerName, matchNFLRoster } = await import('../supabase/functions/_shared/nflRosterSync.ts');
  assert.equal(normalizePlayerName('Odell Beckham Jr.'), 'odell beckham');
  assert.equal(normalizePlayerName('Kenneth Walker III'), 'kenneth walker');
  assert.equal(normalizePlayerName("Ja'Marr Chase"), 'ja marr chase');
  assert.equal(normalizePlayerName('AJ Dillon'), 'aj dillon');

  const espnRoster = { athletes: [{ items: [
    { id: 101, displayName: 'Jayden Daniels', jersey: '5', position: { abbreviation: 'qb' }, status: { type: 'active' } },
    { id: 102, displayName: 'Austin Ekeler', jersey: '30', position: { abbreviation: 'RB' }, status: { type: 'active' },
      injuries: [{ status: 'Out', type: { description: 'Out for week 9' } }] },
    { id: 103, displayName: 'Luke McCaffrey', jersey: '7', position: { abbreviation: 'WR' }, status: { type: 'practice-squad' } },
    { id: 104, displayName: 'John Smith', jersey: '80', position: { abbreviation: 'WR' }, status: { type: 'active' } },
    { id: 105, displayName: 'John Smith', jersey: '81', position: { abbreviation: 'TE' }, status: { type: 'active' } },
  ] }] };
  const apiPlayers = { response: [
    { id: 25745, name: 'Jayden Daniels' },
    { id: 400, name: 'Austin Ekeler' },
    { id: 500, name: 'John Smith' },
  ] };
  const rows = matchNFLRoster(2026, '28', '18', espnRoster, apiPlayers);
  assert.equal(rows.length, 5, 'Every ESPN athlete is bridged');
  const daniels = rows.find((row) => row.espn_player_id === '101');
  assert.equal(daniels.api_player_id, '25745');
  assert.equal(daniels.position, 'QB');
  assert.equal(daniels.active, true);
  assert.equal(rows.find((row) => row.espn_player_id === '102').active, false, 'Ruled-out players are inactive');
  assert.equal(rows.find((row) => row.espn_player_id === '103').active, false, 'Practice squad players are inactive');
  assert.equal(rows.find((row) => row.espn_player_id === '104').api_player_id, null, 'Duplicate names are never bridged');
  assert.equal(rows.find((row) => row.espn_player_id === '105').api_player_id, null, 'Duplicate names are never bridged');
  assert.throws(() => matchNFLRoster(2026, '28', '18', { athletes: [] }, apiPlayers), /empty/);
});

test('The roster feed serves fresh active players and falls back on stale or missing data', async () => {
  const { fetchNFLRosterFeed } = await import('../src/services/liveFeed.ts');
  const original = globalThis.fetch;
  const config = { url: 'https://gamewire.test', key: 'public-test-key' };
  let rows;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.apikey, 'public-test-key');
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('active'), 'is.true');
    assert.equal(parsed.searchParams.get('espn_team_id'), 'eq.28');
    return Response.json(rows);
  };
  try {
    const fresh = new Date().toISOString();
    rows = [
      { espn_player_id: '101', name: 'Jayden Daniels', position: 'QB', jersey: '5', updated_at: fresh },
      { espn_player_id: '106', name: 'Terry McLaurin', position: 'WR', jersey: '17', updated_at: fresh },
    ];
    const roster = await fetchNFLRosterFeed(2026, '28', undefined, config);
    assert.equal(roster.length, 2);
    assert.deepEqual(roster[0], { id: '101', name: 'Jayden Daniels', position: 'QB', jersey: '5' });
    rows = [{ espn_player_id: '101', name: 'Jayden Daniels', position: 'QB', jersey: '5', updated_at: '2026-10-01T00:00:00Z' }];
    assert.equal(await fetchNFLRosterFeed(2026, '28', undefined, config), null, 'Stale rosters fall back to ESPN');
    rows = [];
    assert.equal(await fetchNFLRosterFeed(2026, '28', undefined, config), null, 'Unsynced teams fall back to ESPN');
    rows = [{ espn_player_id: 7, name: 'Bad Row', updated_at: fresh }];
    assert.equal(await fetchNFLRosterFeed(2026, '28', undefined, config), null, 'Malformed rows invalidate the response');
    assert.equal(await fetchNFLRosterFeed(2026, '28', undefined, null), null, 'Unconfigured builds skip the feed');
  } finally {
    globalThis.fetch = original;
  }
});

test('Player game rows mirror the ESPN stat extraction, merge groups and mark synced games', async () => {
  const { normalizeNFLPlayerGames, playerGamesSyncMarker, readNFLSeasonFinals } = await import('../supabase/functions/_shared/apiSportsFeed.ts');
  const [final] = readNFLSeasonFinals({ response: [seasonGame(21632)] });
  const payload = { response: [
    { team: { id: 18, name: 'Washington Commanders' }, groups: [
      { name: 'Passing', players: [{ player: { id: 25745, name: 'Jayden Daniels' }, statistics: [
        { name: 'comp att', value: '16/29' }, { name: 'yards', value: '217' }, { name: 'passing touch downs', value: '1' },
        { name: 'interceptions', value: '0' }, { name: 'rating', value: '58.9' },
      ] }] },
      { name: 'Rushing', players: [{ player: { id: 25745, name: 'Jayden Daniels' }, statistics: [
        { name: 'total rushes', value: '6' }, { name: 'yards', value: '42' }, { name: 'rushing touch downs', value: null },
      ] }] },
      { name: 'Receiving', players: [{ player: { id: 777, name: 'Terry McLaurin' }, statistics: [
        { name: 'targets', value: '9' }, { name: 'total receptions', value: '6' }, { name: 'yards', value: '81' },
        { name: 'receiving touch downs', value: '1' },
      ] }] },
      { name: 'Defensive', players: [{ player: { id: 888, name: 'Defense Only' }, statistics: [{ name: 'tackles', value: '7' }] }] },
    ] },
  ] };
  const rows = normalizeNFLPlayerGames(2026, final, payload);
  const daniels = rows.find((row) => row.api_player_id === '25745');
  assert.deepEqual(daniels.stats, {
    completions: 16, attempts: 29, passingYards: 217, passingTouchdowns: 1, interceptions: 0,
    carries: 6, rushingYards: 42, totalYards: 259,
  }, 'Passing and rushing groups merge; null stats are omitted, never zeroed');
  const mclaurin = rows.find((row) => row.api_player_id === '777');
  assert.deepEqual(mclaurin.stats, { targets: 9, receptions: 6, receivingYards: 81, receivingTouchdowns: 1, totalYards: 81 });
  assert.equal(rows.find((row) => row.api_player_id === '888'), undefined, 'Defense-only players are not stored');
  const marker = rows.find((row) => row.api_player_id === playerGamesSyncMarker);
  assert.ok(marker, 'Every synced game carries a marker row');
  assert.equal(marker.game_date, '2026-10-26');
});

test('The player log feed gates on full-season sync, bridges IDs and maps games by date', async () => {
  const { fetchNFLPlayerGameLogFeed } = await import('../src/services/liveFeed.ts');
  const original = globalThis.fetch;
  const config = { url: 'https://gamewire.test', key: 'public-test-key' };
  let state, bridge, logs;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.apikey, 'public-test-key');
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('live_feed_season_state')) return Response.json(state);
    if (parsed.pathname.endsWith('live_feed_rosters')) return Response.json(bridge);
    assert.equal(parsed.searchParams.get('api_player_id'), 'eq.25745');
    return Response.json(logs);
  };
  const recent = [
    { gameId: '401', date: '2026-11-02T01:20:00Z' },
    { gameId: '402', date: '2026-10-26T17:00:00Z' },
  ];
  try {
    state = [{ finals_total: 120, players_synced: 90 }];
    assert.equal(await fetchNFLPlayerGameLogFeed(2041, '101', recent, undefined, config), null, 'Partial player syncs fall back to ESPN');
    state = [{ finals_total: 120, players_synced: 120 }];
    bridge = [];
    assert.equal(await fetchNFLPlayerGameLogFeed(2042, '101', recent, undefined, config), null, 'Unbridged players fall back to ESPN');
    bridge = [{ api_player_id: '25745' }];
    logs = [
      { provider_game_id: '21632', game_date: '2026-11-02', stats: { passingYards: 217, carries: 6, rating: 58.9, bogus: 'x' } },
    ];
    const feed = await fetchNFLPlayerGameLogFeed(2043, '101', recent, undefined, config);
    assert.deepEqual(feed.get('401'), { passingYards: 217, carries: 6 }, 'Unknown stat keys and non-numbers are dropped');
    assert.deepEqual(feed.get('402'), {}, 'A synced game without a row reads as no recorded stats');
    assert.equal(await fetchNFLPlayerGameLogFeed(2043, '101', recent, undefined, null), null, 'Unconfigured builds skip the feed');
  } finally {
    globalThis.fetch = original;
  }
});

test('ESPN event linking matches mapped teams within the kickoff window', async () => {
  const { matchESPNEventIds } = await import('../supabase/functions/_shared/apiSportsFeed.ts');
  const scoreboard = { events: [
    { id: '401', date: '2026-11-02T01:20:00Z', competitions: [{ competitors: [
      { homeAway: 'away', team: { id: '21' } }, { homeAway: 'home', team: { id: '28' } },
    ] }] },
    { id: '402', date: '2026-11-09T01:20:00Z', competitions: [{ competitors: [
      { homeAway: 'away', team: { id: '21' } }, { homeAway: 'home', team: { id: '28' } },
    ] }] },
  ] };
  const lookup = (name) => name === 'Philadelphia Eagles' ? '21' : name === 'Washington Commanders' ? '28' : null;
  const rows = [
    { provider_game_id: '21632', start_time: '2026-11-02T01:20:00Z', away_name: 'Philadelphia Eagles', home_name: 'Washington Commanders' },
    { provider_game_id: '999', start_time: '2026-11-02T01:20:00Z', away_name: 'Unknown Team', home_name: 'Washington Commanders' },
  ];
  assert.deepEqual(matchESPNEventIds(rows, scoreboard, lookup), [{ provider_game_id: '21632', espn_event_id: '401' }],
    'The same matchup a week later is a different event; unmapped teams are skipped');
});

test('The push poller feed source falls back whenever a live game is unlinked or stale', async () => {
  const { pushGamesFromFeed } = await import('../supabase/functions/_shared/apiSportsFeed.ts');
  const now = new Date('2026-11-03T01:30:00Z');
  const teamFor = (name) => name === 'Chicago Bears' ? { espnId: '3', espnAbbr: 'CHI' }
    : name === 'Seattle Seahawks' ? { espnId: '26', espnAbbr: 'SEA' } : null;
  const liveRow = {
    status: 'LIVE', away_name: 'Chicago Bears', home_name: 'Seattle Seahawks',
    away_score: 7, home_score: 10, period: 2, clock: '4:12',
    espn_event_id: '555', fetched_at: '2026-11-03T01:29:00Z',
  };
  const games = pushGamesFromFeed([liveRow], teamFor, now);
  assert.deepEqual(games, [{
    id: '555', away: { id: '3', abbreviation: 'CHI', score: 7 }, home: { id: '26', abbreviation: 'SEA', score: 10 },
    state: 'in', period: 2, clock: '4:12', lastPlayText: '',
  }]);
  assert.equal(pushGamesFromFeed([{ ...liveRow, espn_event_id: null }], teamFor, now), null, 'An unlinked live game forces the ESPN fallback');
  assert.equal(pushGamesFromFeed([{ ...liveRow, fetched_at: '2026-11-03T01:20:00Z' }], teamFor, now), null, 'A stale live game forces the ESPN fallback');
  assert.equal(pushGamesFromFeed([], teamFor, now), null, 'No rows forces the ESPN fallback');
  const upcoming = pushGamesFromFeed([liveRow, { ...liveRow, status: 'UPCOMING', espn_event_id: null, away_score: null, home_score: null }], teamFor, now);
  assert.equal(upcoming.length, 1, 'Unlinked pregame rows are skipped without forcing a fallback');
  const finals = pushGamesFromFeed([{ ...liveRow, status: 'FINAL', fetched_at: '2026-11-03T01:29:30Z' }], teamFor, now);
  assert.equal(finals[0].state, 'post');
});

test('Feed-built defensive standings mirror ESPN semantics: per-game averages, ranks, ties and the 32-team gate', async () => {
  const { buildDefensiveStandings } = await import('../supabase/functions/_shared/apiSportsBotInputs.ts');
  const names = ['Arizona Cardinals', 'Atlanta Falcons', 'Baltimore Ravens', 'Buffalo Bills', 'Carolina Panthers', 'Chicago Bears',
    'Cincinnati Bengals', 'Cleveland Browns', 'Dallas Cowboys', 'Denver Broncos', 'Detroit Lions', 'Green Bay Packers',
    'Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars', 'Kansas City Chiefs', 'Las Vegas Raiders', 'Los Angeles Chargers',
    'Los Angeles Rams', 'Miami Dolphins', 'Minnesota Vikings', 'New England Patriots', 'New Orleans Saints', 'New York Giants',
    'New York Jets', 'Philadelphia Eagles', 'Pittsburgh Steelers', 'San Francisco 49ers', 'Seattle Seahawks', 'Tampa Bay Buccaneers',
    'Tennessee Titans', 'Washington Commanders'];
  const rows = names.flatMap((name, index) => [
    { team_name: name, espn_team_id: String(index + 1), points_for: 21, points_against: 10 + index },
    { team_name: name, espn_team_id: String(index + 1), points_for: 27, points_against: 10 + index },
  ]);
  const standings = buildDefensiveStandings(rows, 2026, '2026-11-03T00:00:00Z');
  assert.equal(standings.size, 32);
  const best = [...standings.values()].find((team) => team.team === 'Arizona Cardinals');
  assert.equal(best.rank, 1);
  assert.equal(best.pointsAllowed, 10);
  assert.equal(best.pointsScored, 24);
  assert.equal(best.games, 2);
  assert.equal(best.leagueSize, 32);
  assert.equal(best.tied, false);
  const worst = [...standings.values()].find((team) => team.team === 'Washington Commanders');
  assert.equal(worst.rank, 32);
  const tiedRows = rows.map((row) => ({ ...row, points_against: 20 }));
  const tied = buildDefensiveStandings(tiedRows, 2026, '2026-11-03T00:00:00Z');
  assert.ok([...tied.values()].every((team) => team.rank === 1 && team.tied), 'Equal points allowed tie at rank 1');
  assert.throws(() => buildDefensiveStandings(rows.slice(0, 10), 2026, 'x'), /32 teams/);
  assert.throws(() => buildDefensiveStandings(rows.map((row, index) => index === 0 ? { ...row, points_against: null } : row), 2026, 'x'), /missing final points/);
});
