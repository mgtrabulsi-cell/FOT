import assert from 'node:assert/strict';
import test from 'node:test';
import { collectBotProjections, positionGameYards, projectionSchedule, yardageEstimate } from '../supabase/functions/_shared/gamewireBotProjections.ts';

const now = Date.parse('2026-10-29T18:00:00Z');
const player = { id: '123', name: 'Test Runner', position: 'RB', teamId: '23', team: 'Pittsburgh Steelers', teamAbbr: 'PIT' };
const matchup = { eventId: '999', start: '2026-11-01T18:00:00Z', opponentId: '5', opponent: 'Cleveland Browns', home: true, state: 'pre' };
const date = (index) => new Date(Date.UTC(2026, 9, 25 - index * 7)).toISOString();
function fixture({ allowed = 150, receiving = 20, receivingAllowed = 40, history = false, contenders = false, badPositions = false, fewerDefenseGames = false, fail = false } = {}) {
  const positions = { '123': 'RB', '124': 'RB', '200': 'RB', '201': 'RB' }, calls = [];
  const game = (id, index, teamId, opponentId) => ({ id: String(id), date: date(index), competitions: [{
    status: { type: { completed: true } }, competitors: [
      { team: { id: teamId }, score: { value: 30 } }, { team: { id: opponentId }, score: { value: 10 } },
    ],
  }] });
  const ownEvents = Array.from({ length: 8 }, (_, index) => game(101 + index, index, '23', String(10 + index)));
  const otherEvents = Array.from({ length: fewerDefenseGames ? 2 : 5 }, (_, index) => game(201 + index, index, '5', String(20 + index)));
  const schedule = (id, events, standing = '3rd in AFC North') => ({ team: { id, standingSummary: standing }, season: { year: 2026, type: 2 }, events });
  const logs = { names: ['rushingYards', 'receivingYards'], events: Object.fromEntries(ownEvents.slice(0, 3).map((event) => [event.id, { gameDate: event.date, opponent: { id: '44' } }])),
    seasonTypes: [{ displayName: '2026 Regular Season', categories: [{ events: ownEvents.slice(0, 3).map((event) => ({ eventId: event.id, stats: ['65', String(receiving)] })) }] }] };
  const box = (id, offenseId, own) => ({ header: { id, season: { year: 2026, type: 2 }, competitions: [{ status: { type: { completed: true } } }] },
    boxscore: { players: [{ team: { id: offenseId }, statistics: [
      { name: 'rushing', keys: ['rushingYards'], athletes: own
        ? [{ athlete: { id: '123' }, stats: ['65'] }, { athlete: { id: '124' }, stats: ['35'] }]
        : [{ athlete: { id: '200' }, stats: [String(allowed * .7)] }, { athlete: { id: badPositions ? 'unknown' : '201' }, stats: [String(allowed * .3)] }] },
      { name: 'receiving', keys: ['receivingYards'], athletes: own
        ? [{ athlete: { id: '123' }, stats: [String(receiving)] }, { athlete: { id: '124' }, stats: ['20'] }]
        : [{ athlete: { id: '200' }, stats: [String(receivingAllowed * .7)] }, { athlete: { id: '201' }, stats: [String(receivingAllowed * .3)] }] },
    ] }] } });
  const get = async (url) => {
    calls.push(url); assert.ok(new URL(url).hostname.endsWith('.espn.com'));
    if (fail) throw new Error('ESPN HTTP 403');
    if (url.includes('/gamelog')) {
      if (!history || url.includes('season=2024')) return { names: [], events: {}, seasonTypes: [] };
      return { names: logs.names, events: { '800': { gameDate: '2025-11-01', opponent: { id: '5' } }, '801': { gameDate: '2025-12-01', opponent: { id: '5' } } },
        seasonTypes: [{ displayName: '2025 Regular Season', categories: [{ events: [{ eventId: '800', stats: ['100', '40'] }, { eventId: '801', stats: ['100', '40'] }] }] }] };
    }
    if (url.includes('/summary?')) {
      const id = new URL(url).searchParams.get('event');
      const own = ownEvents.find((event) => event.id === id);
      if (own) return box(id, '23', true);
      const other = otherEvents.find((event) => event.id === id);
      assert.ok(other); return box(id, other.competitions[0].competitors[1].team.id, false);
    }
    const id = new URL(url).pathname.match(/teams\/(\d+)\/schedule/)[1];
    if (id === '23') return schedule(id, ownEvents, contenders ? '1st in AFC North' : undefined);
    if (id === '5') return schedule(id, otherEvents, contenders ? '2nd in AFC North' : undefined);
    return schedule(id, Array.from({ length: 8 }, (_, index) => game(600 + index, index + 4, id, '33')));
  };
  const run = (options = {}) => collectBotProjections(options.player ?? player, options.matchup === undefined ? matchup : options.matchup, 2026,
    options.logs === undefined ? logs : options.logs, { players: [player], positions: options.player ? Object.fromEntries(Object.keys(positions).map((id) => [id, options.player.position])) : positions,
      season: 2026, week: 8, seasonType: 2, checkedAt: new Date(now).toISOString(), warnings: [] }, get, options.now ?? now);
  return { run, box, calls, positions, logs, schedule, ownEvents };
}
test('Opponent position allowance moves independent yardage estimates above weak-defense lines and below tough-defense baselines', async () => {
  const weak = (await fixture().run())[0], strong = (await fixture({ allowed: 40 }).run())[0];
  assert.equal(weak.baseline, 65); assert.equal(weak.share, 65);
  assert.equal(weak.defenseAverage, 150); assert.equal(weak.defenseGames, 5);
  assert.equal(weak.yards, 75); assert.ok(weak.yards > 68.5);
  assert.equal(strong.yards, 53); assert.ok(strong.yards < strong.baseline);
  assert.match(weak.explanation, /position-group total per team-game, not yards expected for one player/);
  assert.equal(weak.historyAverage, null); assert.equal(weak.contenderAverage, null);
  assert.equal(weak.sourceGames.length, 10);
  assert.equal(weak.sourceGames.filter((game) => game.role === 'opponent').length, 5);
});
test('A receiver’s great recent production is reduced by a tough WR yardage matchup rather than unrelated scoring-defense ranks', async () => {
  const receiver = { ...player, name: 'Test Receiver', position: 'WR' };
  const strong = (await fixture({ receiving: 100, receivingAllowed: 40 }).run({ player: receiver }))[0];
  const weak = (await fixture({ receiving: 100, receivingAllowed: 200 }).run({ player: receiver }))[0];
  assert.equal(strong.market, 'player_reception_yds'); assert.equal(strong.baseline, 100);
  assert.equal(strong.yards, 80); assert.equal(weak.yards, 120);
  assert.match(strong.explanation, /WR yardage allowance/);
  assert.doesNotMatch(strong.explanation, /scoring defense/);
});
test('Direct opponent history adds a small measured component, not a single-game narrative boost', async () => {
  const base = (await fixture().run())[0], history = (await fixture({ history: true }).run())[0];
  assert.equal(history.historyGames, 2); assert.equal(history.historyAverage, 100);
  assert.equal(history.yards, 77); assert.ok(history.yards > base.yards);
  assert.match(history.explanation, /2 verified meetings/);
  assert.equal(yardageEstimate(100, 100, 1, 200), 110);
});
test('Big-matchup component requires verified pregame winning records and sufficient individual samples', async () => {
  const result = (await fixture({ contenders: true }).run())[0];
  assert.match(result.context, /Both teams are currently top-two/);
  assert.match(result.context, /Stakes alone do not create an automatic yardage boost/);
  assert.equal(result.contenderGames, 3); assert.equal(result.contenderAverage, 65);
  assert.equal(result.yards, 74);
  const regular = (await fixture().run())[0];
  assert.equal(regular.contenderGames, 0); assert.equal(regular.yards, 75);
});
test('Missing/unclassified position yards, unavailable providers and undersized samples produce no invented estimate', async () => {
  const unknown = (await fixture({ badPositions: true }).run())[0];
  assert.equal(unknown.yards, null);
  assert.match(unknown.warnings.join(' '), /position could not be verified/);
  const sparse = (await fixture({ fewerDefenseGames: true }).run())[0];
  assert.equal(sparse.defenseGames, 2); assert.equal(sparse.yards, null);
  const blocked = await fixture({ fail: true }).run();
  assert.ok(blocked.every((row) => row.yards === null));
  assert.match(blocked[0].warnings.join(' '), /403/);
  assert.ok((await fixture().run({ logs: null })).every((row) => row.yards === null));
});
test('Projection adjustments cap before rounding and ignore price/line anchoring', () => {
  assert.equal(yardageEstimate(100, 1000, 1, 1000, 1000), 125);
  assert.equal(yardageEstimate(100, 0, 1, 0, 0), 75);
  assert.equal(yardageEstimate(100, 200, .5), 100);
  assert.equal(yardageEstimate(100, 100, 1), 100);
  for (const bad of [[NaN, 100, .5], [100, -1, .5], [100, 100, 1.5], [0, 100, .5]])
    assert.throws(() => yardageEstimate(...bad), /valid position share/);
  assert.throws(() => yardageEstimate(100, 100, 1, Infinity), /must be finite/);
});
test('Final game/season/identity and exact stat keys are required; position groups are not team-total or WR/TE mixtures', () => {
  const api = fixture();
  const data = api.box('101', '23', true);
  data.boxscore.players[0].statistics[0].athletes.push({ athlete: { id: 'wr', position: { abbreviation: 'WR' } }, stats: ['90'] });
  assert.deepEqual(positionGameYards(data, '101', '23', 2026, 'RB', 'rushing', 'rushingYards', api.positions, '123'), { total: 100, player: 65 });
  assert.throws(() => positionGameYards(data, 'wrong-id', '23', 2026, 'RB', 'rushing', 'rushingYards', api.positions), /requested completed/);
  assert.throws(() => positionGameYards(data, '101', '23', 2025, 'RB', 'rushing', 'rushingYards', api.positions), /requested completed/);
  data.header.competitions[0].status.type.completed = false;
  assert.throws(() => positionGameYards(data, '101', '23', 2026, 'RB', 'rushing', 'rushingYards', api.positions), /requested completed/);
});
test('Schedules and player logs cannot use future games or old/incorrect seasons; locked games make no projection calls', async () => {
  const api = fixture();
  assert.throws(() => projectionSchedule(api.schedule('5', []), '23', 2026, now), /requested team/);
  assert.throws(() => projectionSchedule(api.schedule('23', []), '23', 2025, now), /requested team/);
  const schedule = api.schedule('23', api.ownEvents);
  schedule.events.push({ ...api.ownEvents[0], id: '999', date: '2026-11-03T18:00:00Z' });
  assert.equal(projectionSchedule(schedule, '23', 2026, now).games.length, 8);
  assert.deepEqual(await api.run({ matchup: null }), []);
  assert.deepEqual(await api.run({ matchup: { ...matchup, state: 'post' } }), []);
  assert.deepEqual(await api.run({ now: Date.parse(matchup.start) }), []);
  assert.equal(api.calls.length, 0);
});
