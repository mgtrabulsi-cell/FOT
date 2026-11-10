import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gradePublishedPick, settlePublishedPicks } from '../supabase/functions/_shared/gamewaireSettlement.ts';

const start = '2026-11-02T01:20:00Z';
function pick(market = 'h2h', side = 'Home', line = null, sport = 'NBA') {
  const data = { sport, eventId: 'odds-event', start, home: 'Home', away: 'Away',
    market, side, line, subject: market.startsWith('player_') ? 'Player' : side,
    identifiers: { espnEventId: '401', teamId: '1', playerId: '23' } };
  return { id: 'pick', sport, event_id: data.eventId, event_start: start, market, side, line, subject: data.subject, data, revision: 3 };
}
function summary(homeScore = 105, awayScore = 100) {
  return { header: { id: '401', date: start, competitions: [{ status: { period: 4, type: {
    name: 'STATUS_FINAL', state: 'post', completed: true,
  } }, competitors: [
    { homeAway: 'home', team: { id: '1', displayName: 'Home' }, score: String(homeScore) },
    { homeAway: 'away', team: { id: '2', displayName: 'Away' }, score: String(awayScore) },
  ] }] }, boxscore: { players: [{ team: { id: '1' }, statistics: [{ names: ['PTS', 'REB', 'AST', '3PT'],
    athletes: [{ athlete: { id: '23', displayName: 'Player' }, didNotPlay: false, stats: ['20', '0', '8', '3-10'] }] }] }] } };
}
const grade = (data, selection) => gradePublishedPick(data, selection)?.result;

test('moneylines, signed spreads, totals and exact-line pushes use the original published line', () => {
  const final = summary();
  for (const [market, side, line, expected] of [
    ['h2h', 'Home', null, 'win'], ['h2h', 'Away', null, 'loss'],
    ['spreads', 'Home', -5, 'push'], ['spreads', 'Home', -5.5, 'loss'],
    ['spreads', 'Away', 5.5, 'win'], ['spreads', 'Away', 4.5, 'loss'],
    ['totals', 'Over', 204.5, 'win'], ['totals', 'Under', 205.5, 'win'],
    ['totals', 'Under', 205, 'push'], ['totals', 'Over', 205.5, 'loss'],
  ]) assert.equal(grade(final, pick(market, side, line)), expected);
  assert.equal(grade(summary(20, 20), pick('h2h', 'Home', null, 'NFL')), 'push');
  assert.throws(() => grade(summary(20, 20), pick()), /final scores/);
  assert.throws(() => grade(final, pick('spreads', 'Home', null)), /spread/);
  assert.throws(() => grade(final, pick('totals', 'Away', 205)), /direction/);
  assert.match(gradePublishedPick(final, pick()).note, /including overtime/);
});

test('NBA player props grade actual points/rebounds/assists/made threes and retain explicitly reported zero', () => {
  for (const [market, line, expected] of [
    ['player_points', 19.5, 'win'], ['player_points', 20, 'push'], ['player_points', 20.5, 'loss'],
    ['player_rebounds', .5, 'loss'], ['player_assists', 7.5, 'win'],
    ['player_threes', 3.5, 'loss'], ['player_threes', 2.5, 'win'],
  ]) assert.equal(grade(summary(), pick(market, 'Over', line)), expected);
  assert.equal(grade(summary(), pick('player_points', 'Under', 20.5)), 'win');
  for (const stat of ['', '--', 'DNP', null]) {
    const data = summary();
    data.boxscore.players[0].statistics[0].athletes[0].stats[0] = stat;
    assert.throws(() => grade(data, pick('player_points', 'Under', 20.5)), /missing or invalid/);
  }
  const dnp = summary();
  dnp.boxscore.players[0].statistics[0].athletes[0].didNotPlay = true;
  assert.throws(() => grade(dnp, pick('player_points', 'Under', 20.5)), /participation/);
  const absent = summary();
  absent.boxscore.players[0].statistics[0].athletes = [];
  assert.throws(() => grade(absent, pick('player_points', 'Under', 20.5)), /missing or ambiguous/);
});

test('NFL props use the correct category and named stat, including negative rushing yards', () => {
  for (const [market, category, key, actual, line, expected] of [
    ['player_pass_yds', 'passing', 'passingYards', '251', 250.5, 'win'],
    ['player_rush_yds', 'rushing', 'rushingYards', '-2', .5, 'loss'],
    ['player_reception_yds', 'receiving', 'receivingYards', '75', 75, 'push'],
    ['player_receptions', 'receiving', 'receptions', '0', .5, 'loss'],
  ]) {
    const data = summary(21, 17);
    data.boxscore.players[0].statistics = [{ name: category, keys: ['other', key],
      athletes: [{ athlete: { id: '23' }, stats: ['999', actual] }] }];
    assert.equal(grade(data, pick(market, 'Over', line, 'NFL')), expected);
    data.boxscore.players[0].statistics[0].name = 'wrong-category';
    assert.throws(() => grade(data, pick(market, 'Over', line, 'NFL')), /missing or ambiguous/);
  }
});

test('soccer grades three-way draws and verified regulation appearances without extra-time leakage', () => {
  const data = summary(1, 1);
  const status = data.header.competitions[0].status;
  status.type.name = 'STATUS_FULL_TIME'; status.period = 2;
  assert.equal(grade(data, pick('h2h', 'Draw', null, 'EPL')), 'win');
  assert.equal(grade(data, pick('h2h', 'Home', null, 'EPL')), 'loss');
  assert.equal(grade(data, pick('h2h', 'Away', null, 'EPL')), 'loss');
  data.rosters = [{ team: { id: '1' }, roster: [{ athlete: { id: '23' },
    stats: [{ name: 'appearances', value: 1 }, { name: 'totalShots', value: 3 },
      { name: 'shotsOnTarget', value: 1 }, { name: 'goalAssists', value: 0 }] }] }];
  for (const [market, line, expected] of [['player_shots', 2.5, 'win'], ['player_shots_on_target', 1, 'push'],
    ['player_assists', .5, 'loss']]) assert.equal(grade(data, pick(market, 'Over', line, 'EPL')), expected);
  status.period = 4;
  assert.throws(() => grade(data, pick('h2h', 'Home', null, 'EPL')), /normal completed game/);
  delete status.period;
  assert.equal(grade(data, pick('h2h', 'Draw', null, 'EPL')), 'win');
  status.type.name = 'STATUS_END_OF_EXTRATIME';
  assert.throws(() => grade(data, pick('h2h', 'Draw', null, 'EPL')), /normal completed game/);
});

test('unverified finals, identities and missing scores never become wins or losses', () => {
  const live = summary();
  live.header.competitions[0].status.type.completed = false;
  assert.equal(grade(live, pick()), undefined);
  for (const mutate of [
    data => { data.header.id = '402'; },
    data => { data.header.date = '2026-11-03T01:20:00Z'; },
    data => { data.header.competitions[0].competitors[0].team.displayName = 'Other'; },
    data => { data.header.competitions[0].competitors[0].score = ''; },
    data => { data.header.competitions[0].status.type.name = 'STATUS_CANCELED'; },
    data => { data.header.competitions.push(data.header.competitions[0]); },
  ]) {
    const data = summary(); mutate(data);
    assert.throws(() => grade(data, pick()));
  }
  const altered = pick('spreads', 'Home', -5.5); altered.line = -4.5;
  assert.throws(() => grade(summary(), altered), /saved analysis/);
  const wrongPlayer = pick('player_points', 'Over', 19.5); wrongPlayer.data.identifiers.playerId = '24';
  assert.throws(() => grade(summary(), wrongPlayer), /missing or ambiguous/);
  const wrongTeam = pick('player_points', 'Over', 19.5); wrongTeam.data.identifiers.teamId = '9';
  assert.throws(() => grade(summary(), wrongTeam), /not part/);
});

function database(rows, { conflict = false, writeError = false, readError = false } = {}) {
  const reads = [], writes = [];
  return { reads, writes, from(table) {
    assert.equal(table, 'gamewaire_picks');
    let update, offset = 0, end = 499;
    const filters = [];
    const builder = {
      select() { return builder; }, update(value) { update = value; return builder; },
      eq(...args) { filters.push(['eq', ...args]); return builder; },
      is(...args) { filters.push(['is', ...args]); return builder; },
      or(...args) { filters.push(['or', ...args]); return builder; },
      lte(...args) { filters.push(['lte', ...args]); return builder; },
      order() { return builder; },
      range(first, last) { offset = first; end = last; return builder; },
      then(resolve) { reads.push(filters); return Promise.resolve({ data: rows.slice(offset, end + 1), error: readError ? {} : null }).then(resolve); },
      async maybeSingle() { writes.push({ update, filters }); return { data: conflict ? null : { id: 'pick' }, error: writeError ? {} : null }; },
    };
    return builder;
  } };
}

test('worker reuses one box per game, persists audited results with revision guards and leaves live games pending', async () => {
  const rows = [pick(), { ...pick('player_points', 'Over', 19.5), id: 'prop' }];
  const db = database(rows);
  let requests = 0;
  const result = await settlePublishedPicks(db, async url => {
    requests++;
    assert.match(url, /basketball\/nba\/summary\?event=401$/);
    return Response.json(summary());
  });
  assert.deepEqual(result, { checked: 2, settled: 2, pending: 0, conflicts: 0, issues: [] });
  assert.equal(requests, 1);
  for (const { update, filters } of db.writes) {
    assert.equal(update.result, 'win'); assert.equal(update.revision, 4);
    assert.ok(Number.isFinite(Date.parse(update.settled_at)));
    assert.match(update.settlement_note, /Source event 401/);
    for (const guard of [['eq', 'revision', 3], ['eq', 'result', 'pending'], ['eq', 'withdrawn', false], ['is', 'settled_at', null]]) {
      assert.ok(filters.some(filter => JSON.stringify(filter) === JSON.stringify(guard)));
    }
    assert.equal('closing_american' in update, false);
  }
  assert.ok(db.reads[0].some(filter => filter[0] === 'or' && filter[1] === 'is_top_pick.eq.true,is_game_lean.eq.true'));
  const live = summary(); live.header.competitions[0].status.type.completed = false;
  const liveDB = database(rows);
  assert.equal((await settlePublishedPicks(liveDB, async () => Response.json(live))).pending, 2);
  assert.equal(liveDB.writes.length, 0);
  const concurrent = await settlePublishedPicks(database(rows, { conflict: true }), async () => Response.json(summary()));
  assert.equal(concurrent.conflicts, 2); assert.equal(concurrent.settled, 0);
});

test('read/provider/save failures are explicit and cannot produce success-shaped results', async () => {
  await assert.rejects(settlePublishedPicks(database([], { readError: true })), /Could not read/);
  const original = console.error;
  const errors = []; console.error = (...args) => errors.push(args);
  try {
    const unavailable = await settlePublishedPicks(database([pick()]), async () => new Response('', { status: 503 }));
    assert.equal(unavailable.settled, 0); assert.equal(unavailable.issues.length, 1); assert.equal(unavailable.pending, 1);
    const failed = await settlePublishedPicks(database([pick()], { writeError: true }), async () => Response.json(summary()));
    assert.equal(failed.settled, 0); assert.equal(failed.issues.length, 1);
    assert.equal(errors.length, 2);
  } finally { console.error = original; }
});

test('five-minute result cron uses existing secret headers and cannot invoke paid analysis', () => {
  const sql = readFileSync(new URL('../supabase/gamewaire-auto-results.sql', import.meta.url), 'utf8');
  assert.match(sql, /'gamewire-gamewaire-results','\*\/5 \* \* \* \*'/);
  assert.match(sql, /x-gamewire-cron-secret/);
  assert.match(sql, /"action":"settlePublished"/);
  assert.doesNotMatch(sql, /ODDS_API_KEY|service_role|action":"analyze/);
});
