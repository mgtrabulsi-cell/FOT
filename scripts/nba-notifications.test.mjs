import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNBAAlerts, nbaDate, nbaNotificationHash, parseNBAPushGame } from '../supabase/functions/_shared/nbaAlerts.ts';
import { nbaNotificationFromHash, viewFromHash, hashForView } from '../src/services/medianNavigation.ts';

function fixture({ points = 34, rebounds = '8', assists = '7', status = 'in', period = 2, clock = '1:20', name = 'STATUS_IN_PROGRESS', plays = [], playerId = 'p1' } = {}) {
  const competitor = (id, homeAway, score) => ({ homeAway, team: { id, abbreviation: id === '1' ? 'ATL' : 'BOS' }, score: String(score),
    linescores: [25, 25, 25, 25, 10].map((value, i) => ({ value, period: i + 1 })) });
  const event = { id: '401', date: '2026-10-24T01:00:00Z', competitions: [{ competitors: [competitor('1', 'away', 100), competitor('2', 'home', 99)],
    status: { period, displayClock: clock, type: { state: status, name } } }] };
  const summary = { header: { competitions: [{ status: { type: { state: status, name } } }] }, boxscore: { players: ['1', '2'].map((id) => ({
    team: { id }, statistics: [{ names: ['MIN', 'PTS', 'REB', 'AST'], athletes: [{ athlete: { id: id === '1' ? playerId : 'p2', displayName: id === '1' ? 'Test Scorer' : 'Other Player' },
      stats: ['30', id === '1' ? String(points) : '12', rebounds, assists] }] }],
  })) }, plays };
  return { event, summary, game: parseNBAPushGame(event, summary) };
}
const shot = (changes = {}) => ({ id: 'shot', sequenceNumber: '200', scoringPlay: true, shootingPlay: true, scoreValue: 3,
  team: { id: '1' }, participants: [{ athlete: { id: 'p1' } }], period: { number: 2 }, clock: { displayValue: '0.0' },
  awayScore: 51, homeScore: 50, ...changes });

test('35/40/50/60 thresholds are inclusive, league-wide and each fires once', () => {
  let state = buildNBAAlerts(fixture().game, null).state;
  for (const points of [35, 40, 50, 60]) {
    const next = buildNBAAlerts(fixture({ points }).game, state);
    assert.equal(next.alerts.length, 1);
    assert.equal(next.alerts[0].key, `points:p1:${points}`);
    assert.deepEqual(next.alerts[0].teamIds, []);
    assert.match(next.alerts[0].body, new RegExp(`hits ${points} points`));
    state = next.state;
    assert.equal(buildNBAAlerts(fixture({ points }).game, state).alerts.length, 0);
  }
  assert.equal(buildNBAAlerts(fixture({ points: 61 }).game, state).alerts.length, 0);
});

test('skipped thresholds all trigger, corrections cannot retrigger, and different players are independent', () => {
  const baseline = buildNBAAlerts(fixture().game, null).state;
  const next = buildNBAAlerts(fixture({ points: 51 }).game, baseline);
  assert.deepEqual(next.alerts.map((alert) => alert.key), ['points:p1:35', 'points:p1:40', 'points:p1:50']);
  const correction = buildNBAAlerts(fixture({ points: 39 }).game, next.state);
  assert.equal(buildNBAAlerts(fixture({ points: 50 }).game, correction.state).alerts.length, 0);
  const other = buildNBAAlerts(fixture({ points: 35, playerId: 'p3' }).game, next.state);
  assert.equal(other.alerts[0].key, 'points:p3:35');
});

test('first observations never broadcast historic scores; already-finished baselines remain suppressed', () => {
  assert.equal(buildNBAAlerts(fixture({ points: 60 }).game, null).alerts.length, 0);
  const oldFinal = buildNBAAlerts(fixture({ status: 'post', period: 4, points: 60, rebounds: '-' }).game, null);
  assert.equal(oldFinal.alerts.length, 0);
  assert.equal(buildNBAAlerts(fixture({ status: 'post', period: 4, points: 60 }).game, oldFinal.state).alerts.length, 0);
});

test('final stat line qualifies at exactly 35, waits for real rebounds/assists, and fires only once', () => {
  const baseline = buildNBAAlerts(fixture({ points: 35 }).game, null).state;
  const missing = buildNBAAlerts(fixture({ status: 'post', period: 4, points: 35, rebounds: '-' }).game, baseline);
  assert.ok(!missing.alerts.some((alert) => alert.kind === 'final-player'));
  const next = buildNBAAlerts(fixture({ status: 'post', period: 4, points: 35 }).game, missing.state);
  assert.equal(next.alerts.filter((alert) => alert.kind === 'final-player').length, 1);
  assert.match(next.alerts.find((alert) => alert.kind === 'final-player').body, /35 PTS \/ 8 REB \/ 7 AST/);
  assert.equal(buildNBAAlerts(fixture({ status: 'post', period: 4, points: 35 }).game, next.state).alerts.length, 0);
  assert.ok(!buildNBAAlerts(fixture({ status: 'post', period: 4, points: 34 }).game, baseline).alerts.some((alert) => alert.kind === 'final-player'));
});

test('favorite-team updates are only completed quarters, halftime, OT and final, with reported cumulative scores', () => {
  let state = buildNBAAlerts(fixture({ period: 1 }).game, null).state;
  assert.equal(buildNBAAlerts(fixture({ period: 1, clock: '0:00' }).game, state).alerts.length, 0, 'Zero clock alone is not a confirmed end');
  for (const [period, name, label] of [[1, 'STATUS_END_PERIOD', 'End Q1'], [2, 'STATUS_HALFTIME', 'Halftime'], [4, 'STATUS_IN_PROGRESS', 'End Q3'], [5, 'STATUS_IN_PROGRESS', 'End Q4']]) {
    const next = buildNBAAlerts(fixture({ period, name }).game, state);
    const quarter = next.alerts.find((alert) => alert.kind === 'quarter');
    assert.ok(quarter.body.startsWith(label));
    assert.deepEqual(quarter.teamIds, ['1', '2']);
    state = next.state;
  }
  const final = buildNBAAlerts(fixture({ status: 'post', period: 5 }).game, state);
  assert.equal(final.alerts.find((alert) => alert.kind === 'quarter').body, 'Final: ATL 100 - BOS 99');
});

test('missing quarter scores never fabricate zeros and retry when linescores arrive', () => {
  const state = buildNBAAlerts(fixture({ period: 1 }).game, null).state;
  const missing = fixture({ period: 2 });
  missing.game.home.lines = [];
  const next = buildNBAAlerts(missing.game, state);
  assert.equal(next.alerts.length, 0);
  assert.equal(next.state.completedPeriod, 0);
  assert.equal(buildNBAAlerts(fixture({ period: 2 }).game, next.state).alerts[0].body, 'End Q1: ATL 25 - BOS 25');
});

test('halftime alerts require a made field goal at exactly zero and confirmed halftime', () => {
  const state = buildNBAAlerts(fixture().game, null).state;
  const halftime = fixture({ name: 'STATUS_HALFTIME', clock: '0:00', plays: [shot()] }).game;
  const next = buildNBAAlerts(halftime, state);
  assert.match(next.alerts.find((alert) => alert.kind === 'buzzer').body, /Test Scorer: halftime buzzer-beater/);
  assert.equal(buildNBAAlerts(halftime, next.state).alerts.length, 0);
  for (const change of [{ scoringPlay: false }, { scoreValue: 1 }, { clock: { displayValue: '0.1' } }, { period: { number: 1 } }, { shootingPlay: false }]) {
    assert.ok(!buildNBAAlerts(fixture({ name: 'STATUS_HALFTIME', plays: [shot(change)] }).game, state).alerts.some((alert) => alert.kind === 'buzzer'));
  }
  assert.ok(!buildNBAAlerts(fixture({ plays: [shot()] }).game, state).alerts.some((alert) => alert.kind === 'buzzer'));
});

test('end-game buzzer alerts require a confirmed final and a shot that changes tie/deficit into the final win, including OT', () => {
  const state = buildNBAAlerts(fixture({ period: 4 }).game, null).state;
  for (const period of [4, 5, 6]) {
    const next = buildNBAAlerts(fixture({ status: 'post', period, plays: [shot({ period: { number: period }, awayScore: 100, homeScore: 99 })] }).game, state);
    assert.match(next.alerts.find((alert) => alert.kind === 'buzzer').body, /game-winning buzzer-beater/);
  }
  for (const change of [{ awayScore: 103, homeScore: 99 }, { awayScore: 99, homeScore: 99 }, { clock: { displayValue: '0.1' } }, { scoreValue: 1 }]) {
    const game = fixture({ status: 'post', period: 4, plays: [shot({ period: { number: 4 }, awayScore: 100, homeScore: 99, ...change })] }).game;
    assert.ok(!buildNBAAlerts(game, state).alerts.some((alert) => alert.kind === 'buzzer'));
  }
  assert.ok(!buildNBAAlerts(fixture({ period: 4, plays: [shot({ period: { number: 4 }, awayScore: 100, homeScore: 99 })] }).game, state).alerts.some((alert) => alert.kind === 'buzzer'));
});

test('the summary final score takes precedence over a scoreboard that is a poll behind', () => {
  const baseline = buildNBAAlerts(fixture({ period: 4 }).game, null).state;
  const data = fixture({ status: 'post', period: 4, plays: [shot({ period: { number: 4 }, awayScore: 100, homeScore: 99 })] });
  data.summary.header.competitions[0].competitors = structuredClone(data.event.competitions[0].competitors);
  data.event.competitions[0].competitors[0].score = '97';
  const game = parseNBAPushGame(data.event, data.summary);
  assert.equal(game.away.score, 100);
  assert.ok(buildNBAAlerts(game, baseline).alerts.some((alert) => alert.kind === 'buzzer'));
});

test('NBA alert deep links retain sport, event and Eastern date, without being mistaken for NFL', () => {
  const hash = nbaNotificationHash('401', '2026-10-23');
  assert.deepEqual(nbaNotificationFromHash(hash), { date: '2026-10-23', eventId: '401' });
  assert.equal(viewFromHash(hash), 'Wire');
  assert.equal(hashForView('Wire', hash), hash);
  assert.equal(nbaNotificationFromHash('#wire/nba/2026-02-30/401'), null);
  assert.equal(nbaDate(new Date('2026-10-24T02:00:00Z')), '2026-10-23');
  assert.equal(viewFromHash('#wire/game/401'), 'Wire');
});
