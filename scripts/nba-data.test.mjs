import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nbaNumber, parseNBAStatRow, parseNBARoster, parseNBATeams, parseNBAPlays, parseNBASummary,
  parseNBATeamSeason, parseNBAPlayerSeason, parseNBAPlayerGames, fetchNBAPlayerProfile,
  fetchNBALivePlayerStats, fetchNBAFavoritePlays, nbaFavoritePlays, nbaTeamFavorite, nbaPlayerFavorite,
} from '../src/services/nbaData.ts';

const away = { id: '14', name: 'Miami Heat', abbr: 'MIA', score: 2, record: '', color: '98002e' };
const home = { id: '12', name: 'LA Clippers', abbr: 'LAC', score: 0, record: '', color: 'c8102e' };
const game = { id: 'nba-401810019', eventId: '401810019', feedPath: 'basketball/nba', sport: 'Basketball', league: 'NBA', status: 'LIVE', period: 'Q1', clock: '11:43', date: '2025-11-04T03:30:00Z', venue: 'Intuit Dome', seasonYear: 2026, away, home };
const athlete = (id, name, position = 'F') => ({ id, displayName: name, position: { abbreviation: position }, jersey: '22', headshot: { href: 'https://a.espncdn.com/player.png' } });
const summaryFixture = () => ({
  header: { id: game.eventId, competitions: [{ status: { period: 1, displayClock: '11:43', type: { name: 'STATUS_IN_PROGRESS', state: 'in', shortDetail: '11:43 - 1st' } }, competitors: [{ id: '14', homeAway: 'away', score: '2' }, { id: '12', homeAway: 'home', score: '0' }] }] },
  boxscore: {
    teams: [{ team: { id: '14' }, statistics: [{ name: 'fieldGoalsMade-fieldGoalsAttempted', label: 'FG', displayValue: '1-1' }, { name: 'totalRebounds', label: 'Rebounds', displayValue: '0' }] }],
    players: [{ team: { id: '14' }, statistics: [{
      names: ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'],
      athletes: [
        { athlete: athlete('4066261', 'Bam Adebayo', 'C'), active: true, starter: true, didNotPlay: false, reason: "COACH'S DECISION", stats: ['0:17', '2', '1-1', '0-0', '0-0', '0', '0', '0', '0', '0', '0', '0', '0', '+2'] },
        { athlete: athlete('2595516', 'Norman Powell', 'G'), didNotPlay: false, stats: ['0:17', '0', '0-0', '0-0', '0-0', '0', '1', '—', '', 'N/A'] },
        { athlete: athlete('inactive', 'Bench Player'), didNotPlay: true, reason: 'Injury', stats: ['0', '0', '0-0'] },
      ],
    }] }],
  },
  plays: [
    { id: 'p7', sequenceNumber: '7', text: 'Bam Adebayo makes 3-foot layup (Norman Powell assists)', period: { number: 1, displayValue: '1st Quarter' }, clock: { displayValue: '11:43' }, awayScore: 2, homeScore: 0, scoringPlay: true, scoreValue: 2, team: { id: '14' }, participants: [{ athlete: { id: '4066261' } }, { athlete: { id: '2595516' } }], wallclock: '2025-11-04T03:41:15Z' },
    { id: 'p4', sequenceNumber: '4', text: 'Bam Adebayo vs. Ivica Zubac (Norman Powell gains possession)', period: { number: 1, displayValue: '1st Quarter' }, clock: { displayValue: '12:00' }, awayScore: 0, homeScore: 0, scoringPlay: false, scoreValue: 0, team: { id: '14' }, participants: [{ athlete: { id: '4066261' } }], wallclock: '2025-11-04T03:41:01Z' },
  ],
});
const seasonFixture = () => ({
  categories: [
    { name: 'averages', names: ['gamesPlayed', 'avgMinutes', 'avgPoints', 'avgRebounds', 'avgAssists', 'fieldGoalPct'], totals: ['999', '37.0', '26.8'], statistics: [
      { season: { year: 2025 }, teamId: '13', stats: ['70', '35', '24', '7', '8', '50'] },
      { season: { year: 2026 }, teamId: '13', stats: ['2', '32.5', '15.5', '9.5', '6', '37'] },
      { season: { year: 2027 }, teamId: '20', stats: ['2', '34', '30', '8', '7', '45'] },
    ] },
    { name: 'totals', names: ['fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalPct', 'totalRebounds', 'assists', 'blocks', 'steals', 'turnovers', 'points'], totals: ['15971-31529', '50.7', '12114', '12028', '1187', '2421', '5656', '43471'], statistics: [
      { season: { year: 2026 }, teamId: '13', stats: ['10-27', '37.0', '19', '12', '2', '4', '6', '31'] },
      { season: { year: 2027 }, teamId: '20', stats: ['20-40', '50', '16', '14', '4', '1', '3', '60'] },
    ] },
  ],
});
const logsFixture = () => ({
  names: ['minutes', 'fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalPct', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointPct', 'freeThrowsMade-freeThrowsAttempted', 'freeThrowPct', 'totalRebounds', 'assists', 'blocks', 'steals', 'fouls', 'turnovers', 'points'],
  events: {
    first: { id: 'first', gameDate: '2026-04-01T00:00:00Z', opponent: { abbreviation: 'HOU' }, gameResult: 'W', score: '119-96' },
    second: { id: 'second', gameDate: '2026-04-04T00:00:00Z', opponent: { abbreviation: 'DAL' }, gameResult: 'L', score: '90-99' },
  },
  seasonTypes: [{ displayName: '2025-26 Regular Season', categories: [
    { type: 'event', events: [{ eventId: 'first', stats: ['17', '6-15', '40.0', '0-3', '0.0', '6-7', '85.7', '4', '6', '0', '3', '0', '4', '18'] }] },
    { type: 'event', events: [{ eventId: 'second', stats: ['30:30', '0-5', '0', '0-2', '0', '0-0', '—', '7', '8', '0', '0', '1', '—', '0'] }, { eventId: 'first', stats: [] }, { eventId: 'missing', stats: ['99'] }] },
  ] }],
});

test('Numeric parsing preserves actual zero and rejects missing/malformed values', () => {
  for (const value of [null, undefined, '', ' ', '—', '--', 'DNP', 'N/A', '3oops', false, {}, NaN, Infinity]) assert.equal(nbaNumber(value), undefined);
  assert.equal(nbaNumber('0'), 0);
  assert.equal(nbaNumber('0.0%'), 0);
  assert.equal(nbaNumber('+12'), 12);
  assert.equal(nbaNumber('-3'), -3);
  assert.deepEqual(parseNBAStatRow(['PTS', 'REB', 'AST', 'MIN', 'FG', '3PT', '+/-'], ['0', '—', '', '12:30', '0-4', '1-3', '-5']),
    { points: 0, minutes: 12.5, fieldGoalsMade: 0, fieldGoalsAttempted: 4, threePointersMade: 1, threePointersAttempted: 3, plusMinus: -5 });
  assert.deepEqual(parseNBAStatRow(['MIN', 'FG'], ['2:75', '—']), {});
});
test('Real ESPN-shaped box scores retain DNP, missing cells, actual zeros, team stats and live clock', () => {
  const parsed = parseNBASummary(summaryFixture(), game.eventId);
  assert.equal(parsed.period, 'Q1');
  assert.equal(parsed.clock, '11:43');
  assert.equal(parsed.homeScore, 0);
  assert.equal(parsed.awayScore, 2);
  const [bam, norman, dnp] = parsed.teams[0].players;
  assert.equal(bam.stats.points, 2);
  assert.equal(bam.stats.rebounds, 0);
  assert.equal(bam.didNotPlay, false);
  assert.equal(bam.reason, "COACH'S DECISION");
  assert.equal(norman.stats.points, 0);
  assert.equal(norman.stats.turnovers, undefined);
  assert.equal(norman.stats.steals, undefined);
  assert.equal(dnp.didNotPlay, true);
  assert.equal(dnp.reason, 'Injury');
  assert.deepEqual(dnp.stats, {});
  assert.equal(parsed.teams[0].stats[1].display, '0');
  assert.deepEqual(parsed.plays.map((play) => play.id), ['p4', 'p7']);
  assert.throws(() => parseNBASummary({ error: 'bad event' }, 'bad'), /unavailable or malformed/);
  assert.deepEqual(parseNBASummary({ header: { competitions: [] } }, 'future').teams, []);
});
test('All roster positions and active-team injured players are available; empty offseason roster is valid', () => {
  const roster = parseNBARoster({ athletes: [athlete('1', 'Point Guard', 'PG'), athlete('2', 'Center', 'C'), athlete('3', 'Forward', 'PF'), athlete('1', 'Point Guard', 'PG'), { invalid: true }] }, '14');
  assert.deepEqual(roster.map((player) => player.position), ['PG', 'C', 'PF']);
  assert.ok(roster.every((player) => player.teamId === '14'));
  assert.deepEqual(parseNBARoster({ athletes: [] }, '14'), []);
  assert.throws(() => parseNBARoster({}, '14'), /malformed/);
  assert.equal(parseNBARoster({ athletes: [{ items: [athlete('1', 'Grouped Guard', 'G')] }] }, '14').length, 1);
});
test('Team list and season statistics use ESPN values, never invented averages', () => {
  assert.equal(parseNBATeams({ sports: [{ leagues: [{ teams: [{ team: { id: '14', displayName: 'Miami Heat', abbreviation: 'MIA', logos: [{ href: 'https://logo' }] } }] }] }] })[0].logo, 'https://logo');
  assert.throws(() => parseNBATeams({}), /malformed/);
  const stats = parseNBATeamSeason({ results: { stats: { categories: [{ name: 'offensive', stats: [
    { name: 'avgPoints', value: 0, displayValue: '0.0', displayName: 'Points Per Game' },
    { name: 'avgAssists', value: null, displayValue: '18.0', displayName: 'Assists Per Game' },
    { name: 'points', value: 100, displayValue: '100' },
  ] }] } } });
  assert.equal(stats[0].display, '0.0');
  assert.equal(stats[1].display, '—');
  assert.equal(stats.length, 2);
  assert.deepEqual(parseNBATeamSeason({ results: { stats: { categories: [] } } }), []);
});
test('Season totals are selected by year, never career totals; averages are not totals', () => {
  const parsed = parseNBAPlayerSeason(seasonFixture(), 2026);
  assert.equal(parsed.gamesPlayed, 2);
  assert.equal(parsed.totals.points, 31);
  assert.equal(parsed.averages.points, 15.5);
  assert.equal(parsed.averages.rebounds, 9.5);
  assert.equal(parsed.averages.fieldGoalPct, 37);
  assert.equal(parsed.averages.minutes, 32.5);
  assert.deepEqual(parseNBAPlayerSeason(seasonFixture(), 2099), { season: 2099, gamesPlayed: undefined, totals: {}, averages: {} });
  assert.throws(() => parseNBAPlayerSeason({}, 2026), /malformed/);
});
test('Traded-player totals combine stints once and weight per-game data, never average percentages', () => {
  const fixture = { categories: [
    { name: 'averages', names: ['gamesPlayed', 'avgMinutes', 'avgPoints', 'fieldGoalPct'], statistics: [
      { teamId: '1', season: { year: 2026 }, stats: ['2', '30', '10', '50'] },
      { teamId: '2', season: { year: 2026 }, stats: ['1', '15', '30', '25'] },
    ] },
    { name: 'totals', names: ['points', 'fieldGoalsMade-fieldGoalsAttempted'], statistics: [
      { teamId: '1', season: { year: 2026 }, stats: ['20', '4-8'] },
      { teamId: '2', season: { year: 2026 }, stats: ['30', '1-4'] },
    ] },
  ] };
  let parsed = parseNBAPlayerSeason(fixture, 2026);
  assert.equal(parsed.gamesPlayed, 3);
  assert.equal(parsed.totals.points, 50);
  assert.equal(parsed.averages.points, 50 / 3);
  assert.equal(parsed.averages.minutes, 25);
  assert.equal(parsed.totals.fieldGoalPct, 5 / 12 * 100);
  fixture.categories[0].statistics.push({ teamId: '0', season: { year: 2026 }, stats: ['3', '25', '16.7', '41.7'] });
  fixture.categories[1].statistics.push({ teamId: '0', season: { year: 2026 }, stats: ['50', '5-12'] });
  parsed = parseNBAPlayerSeason(fixture, 2026);
  assert.equal(parsed.gamesPlayed, 3);
  assert.equal(parsed.totals.points, 50);
});
test('Recent games join event metadata, retain actual zero/missing, sort newest first and remove duplicates', () => {
  const parsed = parseNBAPlayerGames(logsFixture());
  assert.deepEqual(parsed.map((row) => row.id), ['second', 'first']);
  assert.equal(parsed[0].stats.points, 0);
  assert.equal(parsed[0].stats.turnovers, undefined);
  assert.equal(parsed[0].stats.minutes, 30.5);
  assert.equal(parsed[1].opponent, 'HOU');
  assert.equal(parsed[1].seasonType, '2025-26 Regular Season');
  assert.deepEqual(parseNBAPlayerGames({ names: [], events: {}, seasonTypes: [] }), []);
  assert.throws(() => parseNBAPlayerGames({}), /malformed/);
});
test('Play chronology uses period and descending remaining clock before sequence, never invented plays', () => {
  const fixture = summaryFixture();
  fixture.plays.push({ ...fixture.plays[0] }, { text: 'No identity' });
  assert.deepEqual(parseNBAPlays(fixture).map((play) => play.id), ['p4', 'p7']);
  const plays = [
    { id: 'ot', text: 'Overtime play', period: { number: 5 }, clock: { displayValue: '4:00' } },
    { id: 'late', text: 'Late quarter', period: { number: 1 }, clock: { displayValue: '1:00' } },
    { id: 'early', text: 'Early quarter', period: { number: 1 }, clock: { displayValue: '11:00' } },
  ];
  assert.deepEqual(parseNBAPlays({ plays }).map((play) => play.id), ['early', 'late', 'ot']);
  assert.deepEqual(parseNBAPlays({ plays: [] }), []);
});
test('Late-appended earlier-clock corrections precede end of game with stable same-clock ordering', () => {
  const play = (id, sequenceNumber, period, clock) => ({
    id, sequenceNumber, text: id, period: { number: period }, clock: { displayValue: clock },
  });
  const fixture = summaryFixture();
  fixture.plays = [
    play('end-of-game', '900', 4, '0.0'),
    play('last-shot', '899', 4, '0.8'),
    play('flagrant-foul', '901', 4, '3:56'),
    play('flagrant-free-throw-one', '902', 4, '3:56'),
    play('flagrant-free-throw-two', '903', 4, '3:56'),
    play('q3-end', '950', 3, '0:00'),
    play('same-clock-no-sequence-one', undefined, 4, '2:00'),
    play('same-clock-no-sequence-two', undefined, 4, '2:00'),
  ];
  assert.deepEqual(parseNBASummary(fixture, '401909848').plays.map((entry) => entry.id), [
    'q3-end', 'flagrant-foul', 'flagrant-free-throw-one', 'flagrant-free-throw-two',
    'same-clock-no-sequence-one', 'same-clock-no-sequence-two', 'last-shot', 'end-of-game',
  ]);
  assert.deepEqual(parseNBAPlays({ plays: [play('second', '2', 1, ''), play('first', '1', 1, '')] }).map((entry) => entry.id), ['first', 'second']);
  assert.deepEqual(parseNBAPlays({ plays: [play('second', '2', 1, '5:00'), play('first', '1', 1, '5:00')] }).map((entry) => entry.id), ['first', 'second']);
});
test('NBA favorite play mapping uses participant IDs, scoring only, correct keys and no NFL labels', () => {
  const teamFavorite = nbaTeamFavorite(away);
  const bamFavorite = nbaPlayerFavorite({ id: '4066261', name: 'Bam Adebayo', position: 'C', teamId: '14', jersey: '13' }, away);
  assert.equal(teamFavorite.key, 'team:basketball/nba:14');
  assert.equal(bamFavorite.key, 'player:basketball/nba:4066261');
  const plays = nbaFavoritePlays(game, parseNBASummary(summaryFixture(), game.eventId), [teamFavorite, bamFavorite, { ...bamFavorite, id: 'not-playing', key: 'player:basketball/nba:not-playing' }, { ...teamFavorite, feedPath: 'football/nfl' }]);
  assert.equal(plays.length, 2);
  for (const play of plays) {
    assert.equal(play.playLabel, summaryFixture().plays[0].text);
    assert.equal(play.timestamp, '2025-11-04T03:41:15Z');
    assert.equal(play.yards, 0);
    assert.equal(play.isTouchdown, false);
    assert.equal(play.isDefensive, false);
    assert.equal(play.opponentAbbr, 'LAC');
  }
});
test('Public fetch adapters supply signal and requested season; Locker Room live stats never fill DNP with zeros', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  const calls = [];
  globalThis.fetch = async (address, options) => {
    assert.equal(options.signal, controller.signal);
    calls.push(String(address));
    if (String(address).includes('/summary?')) return Response.json(summaryFixture());
    if (String(address).includes('/gamelog?')) return Response.json(logsFixture());
    return Response.json(seasonFixture());
  };
  try {
    const stats = await fetchNBALivePlayerStats(game.eventId, [{ teamId: '14', id: '4066261' }, { teamId: '14', id: 'inactive' }, { teamId: '12', id: '4066261' }], controller.signal);
    assert.deepEqual(Object.keys(stats), ['4066261']);
    assert.equal(stats['4066261'].points, 2);
    const profile = await fetchNBAPlayerProfile('1966', 2026, controller.signal);
    assert.equal(profile.totals.points, 31);
    assert.equal(profile.games.length, 2);
    assert.ok(calls.filter((call) => call.includes('/athletes/')).every((call) => new URL(call).searchParams.get('season') === '2026'));
    assert.equal((await fetchNBAFavoritePlays([game, { ...game, id: 'other', feedPath: 'football/nfl' }], [nbaTeamFavorite(away)], controller.signal)).length, 1);
    assert.deepEqual(await fetchNBAFavoritePlays([{ ...game, status: 'UPCOMING' }], [nbaTeamFavorite(away)], controller.signal), []);
  } finally { globalThis.fetch = original; }
});
test('HTTP, malformed JSON and abort failures propagate instead of silent guessed data', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(fetchNBALivePlayerStats('bad', []), /HTTP 503/);
    globalThis.fetch = async () => Response.json({ error: 'no box score' });
    await assert.rejects(fetchNBALivePlayerStats('bad', []), /malformed/);
    globalThis.fetch = async () => Response.json(null);
    await assert.rejects(fetchNBALivePlayerStats('bad', []), /malformed response/);
    globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
    await assert.rejects(fetchNBALivePlayerStats('bad', []), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});
