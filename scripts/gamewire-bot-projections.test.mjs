import assert from 'node:assert/strict';
import test from 'node:test';
import { collectBotProjections, collectReceivingDefenses, readBotDepth, positionGameYards, projectionSchedule, matchupEstimate as yardageEstimate } from '../supabase/functions/_shared/gamewireBotProjections.ts';

const now = Date.parse('2026-10-29T18:00:00Z');
const player = { id: '123', name: 'Test Runner', position: 'RB', teamId: '23', team: 'Pittsburgh Steelers', teamAbbr: 'PIT' };
const matchup = { eventId: '999', start: '2026-11-01T18:00:00Z', opponentId: '5', opponent: 'Cleveland Browns', home: true, state: 'pre' };
const date = (index) => new Date(Date.UTC(2026, 9, 25 - index * 7)).toISOString();
function fixture({ allowed = 150, receiving = 20, receivingAllowed = 40, catches = 4, catchesAllowed = 10, omitCatches = false, history = false, contenders = false, badPositions = false, fewerDefenseGames = false, ownCount = 8, depthRank = 1, fail = false } = {}) {
  const positions = { '123': 'RB', '124': 'RB', '200': 'RB', '201': 'RB' }, calls = [];
  const game = (id, index, teamId, opponentId) => ({ id: String(id), date: date(index), competitions: [{
    status: { type: { completed: true } }, competitors: [
      { team: { id: teamId }, score: { value: 30 } }, { team: { id: opponentId }, score: { value: 10 } },
    ],
  }] });
  const ownEvents = Array.from({ length: ownCount }, (_, index) => game(101 + index, index, '23', String(10 + index)));
  const otherEvents = Array.from({ length: fewerDefenseGames ? 2 : 5 }, (_, index) => game(201 + index, index, '5', String(20 + index)));
  const schedule = (id, events, standing = '3rd in AFC North') => ({ team: { id, standingSummary: standing }, season: { year: 2026, type: 2 }, events });
  const logs = { names: ['rushingYards', 'receivingYards', ...omitCatches ? [] : ['receptions']], events: Object.fromEntries(ownEvents.slice(0, 3).map((event) => [event.id, { gameDate: event.date, opponent: { id: '44' } }])),
    seasonTypes: [{ displayName: '2026 Regular Season', categories: [{ events: ownEvents.slice(0, 3).map((event) => ({ eventId: event.id, stats: ['65', String(receiving), ...omitCatches ? [] : [String(catches)]] })) }] }] };
  const box = (id, offenseId, own) => ({ header: { id, season: { year: 2026, type: 2 }, competitions: [{ status: { type: { completed: true } } }] },
    boxscore: { players: [{ team: { id: offenseId }, statistics: [
      { name: 'rushing', keys: ['rushingYards'], athletes: own
        ? [{ athlete: { id: '123' }, stats: ['65'] }, { athlete: { id: '124' }, stats: ['35'] }]
        : [{ athlete: { id: '200' }, stats: [String(allowed * .7)] }, { athlete: { id: badPositions ? 'unknown' : '201' }, stats: [String(allowed * .3)] }] },
      { name: 'receiving', keys: ['receivingYards', ...omitCatches ? [] : ['receptions']], athletes: own
        ? [{ athlete: { id: '123' }, stats: [String(receiving), String(catches)] }, { athlete: { id: '124' }, stats: ['20', '2'] }]
        : [{ athlete: { id: '200' }, stats: [String(receivingAllowed * .7), String(Math.ceil(catchesAllowed / 2))] }, { athlete: { id: '201' }, stats: [String(receivingAllowed * .3), String(Math.floor(catchesAllowed / 2))] }] },
    ] }] } });
  const get = async (url) => {
    calls.push(url); assert.ok(new URL(url).hostname.endsWith('.espn.com'));
    if (fail) throw new Error('ESPN HTTP 403');
    if (url.includes('/depthcharts')) return { depthchart: [{ positions: { rb: { athletes: depthRank === 1 ? [{ id: '123', displayName: player.name }, { id: '124', displayName: 'Backup' }]
      : [{ id: '124', displayName: 'Other' }, { id: '123', displayName: player.name }] } } }] };
    if (url.includes('/gamelog')) {
      if (!history || url.includes('season=2024')) return { names: [], events: {}, seasonTypes: [] };
      return { names: logs.names, events: { '800': { gameDate: '2025-11-01', opponent: { id: '5' } }, '801': { gameDate: '2025-12-01', opponent: { id: '5' } } },
        seasonTypes: [{ displayName: '2025 Regular Season', categories: [{ events: [{ eventId: '800', stats: ['100', '40', '6'] }, { eventId: '801', stats: ['100', '40', '6'] }] }] }] };
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
      season: 2026, week: 8, seasonType: 2, checkedAt: new Date(now).toISOString(), warnings: [] }, get, options.now ?? now, options.defenses ?? []);
  return { run, box, calls, positions, logs, schedule, ownEvents };
}
test('Opponent position allowance moves independent yardage estimates above weak-defense lines and below tough-defense baselines', async () => {
  const weak = (await fixture().run())[0], strong = (await fixture({ allowed: 40 }).run())[0];
  assert.equal(weak.baseline, 65); assert.equal(weak.share, 65);
  assert.equal(weak.defenseAverage, 150); assert.equal(weak.defenseGames, 5);
  assert.equal(weak.yards, 75); assert.ok(weak.yards > 68.5);
  assert.equal(strong.yards, 53); assert.ok(strong.yards < strong.baseline);
  assert.match(weak.explanation, /matchup against Cleveland Browns lifts the outlook/);
  assert.ok(weak.explanation.split(/\s+/).length <= 35);
  assert.equal(weak.estimate, weak.yards); assert.equal(weak.unit, 'yards');
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
  assert.match(strong.explanation, /WR yardage matchup against Cleveland Browns tempers/);
  assert.doesNotMatch(strong.explanation, /scoring defense/);
});
test('Direct opponent history adds a small measured component, not a single-game narrative boost', async () => {
  const base = (await fixture().run())[0], history = (await fixture({ history: true }).run())[0];
  assert.equal(history.historyGames, 2); assert.equal(history.historyAverage, 100);
  assert.equal(history.yards, 77); assert.ok(history.yards > base.yards);
  assert.match(history.explanation, /Past meetings also factor in/);
  assert.doesNotMatch(history.explanation, /sample|split|share|adjustment|verified meetings/);
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
  assert.equal(sparse.defenseGames, 2); assert.equal(sparse.yards, 70); assert.equal(sparse.limitedData, true);
  const blocked = await fixture({ fail: true }).run();
  assert.ok(blocked.every((row) => row.yards === null));
  assert.match(blocked[0].warnings.join(' '), /403/);
  assert.equal((await fixture().run({ logs: null }))[0].yards, 75, 'Completed boxes recover missing player logs');
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
test('RB, WR and TE reception estimates use measured catches and positional allowance with one decimal, not receiving yards', async () => {
  for (const position of ['RB', 'WR', 'TE']) {
    const weakApi = fixture();
    const weakRows = await weakApi.run({ player: { ...player, position } });
    const weak = weakRows.find((row) => row.market === 'player_receptions');
    const strong = (await fixture({ catchesAllowed: 2 }).run({ player: { ...player, position } })).find((row) => row.market === 'player_receptions');
    assert.equal(weak.unit, 'receptions'); assert.equal(weak.yards, null);
    assert.equal(weak.baseline, 4); assert.equal(weak.share, 66.7);
    assert.equal(weak.estimate, 4.8); assert.equal(strong.estimate, 3.2);
    assert.equal(weak.defenseAverage, 10); assert.equal(weak.defenseGames, 5);
    assert.equal(weakApi.calls.filter((url) => url.includes('/summary?')).length, 10, 'Reuse yardage boxes; no extra providers needed');
    assert.match(weak.explanation, /reception matchup/);
  }
  const historical = (await fixture({ history: true }).run()).find((row) => row.market === 'player_receptions');
  assert.equal(historical.estimate, 4.9); assert.equal(historical.historyAverage, 6);
});
test('Reception samples never fabricate missing or invalid catches; existing yardage estimates remain intact', async () => {
  for (const options of [{ omitCatches: true }, { catches: -1 }, { catches: 1.5 }]) {
    const rows = await fixture(options).run();
    assert.equal(rows.find((row) => row.market === 'player_receptions').estimate, null);
    if (!options.fewerDefenseGames) assert.equal(rows[0].estimate, 75);
  }
  const qb = await fixture().run({ player: { ...player, position: 'QB' } });
  assert.ok(!qb.some((row) => row.unit === 'receptions'));
  const api = fixture();
  const box = api.box('101', '23', true);
  box.boxscore.players[0].statistics[1].athletes[0].stats[1] = '3.5';
  assert.throws(() => positionGameYards(box, '101', '23', 2026, 'RB', 'receiving', 'receptions', api.positions), /invalid receptions/);
  assert.equal((await fixture({ catches: 0 }).run()).find((row) => row.market === 'player_receptions').estimate, 0, 'Recorded zero catches are data, not a missing value');
});
test('One completed game and missing/malformed player logs still produce labeled bounded estimates from box scores', async () => {
  const one = (await fixture({ ownCount: 1, fewerDefenseGames: true }).run({ logs: null }))[0];
  assert.equal(one.playerGames, 1); assert.equal(one.limitedData, true); assert.equal(one.yards, 70);
  assert.ok(one.yards <= one.baseline * 1.15 + .5);
  const malformed = (await fixture({ ownCount: 2 }).run({ logs: { names: [] } }))[0];
  assert.equal(malformed.playerGames, 2); assert.ok(malformed.estimate > 0);
  assert.equal((await fixture({ ownCount: 0 }).run({ logs: null }))[0].estimate, null);
});
test('Verified backup depth lowers opportunity while missing depth uses explicit usage ranking', async () => {
  const primary = (await fixture().run())[0], backup = (await fixture({ depthRank: 2 }).run())[0];
  assert.deepEqual(primary.role, { rank: 1, source: 'depth-chart' });
  assert.equal(backup.role.rank, 2); assert.ok(backup.estimate < primary.estimate);
  const wr = { ...player, position: 'WR', name: 'Test Receiver' };
  const usage = (await fixture().run({ player: wr }))[0];
  assert.deepEqual(usage.role, { rank: 1, source: 'recent-usage' });
  const depth = { depthchart: [{ positions: { wr1: { athletes: [{ id: wr.id, displayName: wr.name }] }, wr2: { athletes: [{ id: '999', displayName: 'Another' }] } } }] };
  assert.equal(readBotDepth(depth, wr).rank, 1, 'Multiple starting WR slots are not backups');
  assert.equal(readBotDepth({ depthchart: [{ positions: { rb: { athletes: [{ id: player.id, displayName: 'Wrong name' }] } } }] }, player), null);
});
test('Only verified bottom-four WR/TE positional rankings add extra upside; Cowboys name alone does not', async () => {
  for (const position of ['WR', 'TE']) {
    const receiver = { ...player, position, name: 'Test Receiver' };
    const base = (await fixture({ receiving: 100, receivingAllowed: 200 }).run({ player: receiver }))[0];
    const weak = (await fixture({ receiving: 100, receivingAllowed: 200 }).run({ player: receiver,
      defenses: [{ teamId: '5', position, rank: 29, games: 5, average: 200 }] }))[0];
    assert.ok(weak.estimate > base.estimate); assert.ok(weak.estimate <= 135);
    assert.match(weak.explanation, /Bottom-four/);
    const noBoost = (await fixture({ receiving: 100, receivingAllowed: 200 }).run({ player: receiver,
      defenses: [{ teamId: '5', position, rank: 28, games: 5, average: 200 }] }))[0];
    assert.equal(noBoost.estimate, base.estimate);
    const named = (await fixture({ receiving: 100, receivingAllowed: 200 }).run({ player: receiver, matchup: { ...matchup, opponent: 'Dallas Cowboys' } }))[0];
    assert.equal(named.estimate, base.estimate);
  }
});
test('League positional ranks require all 32 teams and completed position-specific samples, with ties not forced into bottom four', async () => {
  const players = Array.from({ length: 32 }, (_, i) => ({ ...player, id: String(1000 + i), teamId: String(i + 1), position: 'WR' }));
  const directory = { players, positions: {} };
  const get = async (url) => {
    const teamId = new URL(url).pathname.match(/teams\/(\d+)/)?.[1];
    if (teamId) return { team: { id: teamId }, season: { year: 2026, type: 2 }, events: [0, 1, 2].map((i) => ({
      id: `${teamId}0${i}`, date: date(i), competitions: [{ status: { type: { completed: true } }, competitors: [
        { team: { id: teamId }, score: { value: 10 } }, { team: { id: '50' }, score: { value: 20 } },
      ] }],
    })) };
    const id = new URL(url).searchParams.get('event');
    const defenseId = Number(id.slice(0, -2));
    return { header: { id, season: { year: 2026, type: 2 }, competitions: [{ status: { type: { completed: true } } }] },
      boxscore: { players: [{ team: { id: '50' }, statistics: [{ name: 'receiving', keys: ['receivingYards'], athletes: [
        { athlete: { id: '800', position: { abbreviation: 'WR' } }, stats: [String(defenseId * 10)] },
        { athlete: { id: '801', position: { abbreviation: 'TE' } }, stats: [String((33 - defenseId) * 5)] },
      ] }] }] } };
  };
  await assert.rejects(collectReceivingDefenses({ players: players.slice(1) }, 2026, get, now), /All 32/);
  const result = await collectReceivingDefenses(directory, 2026, get, now);
  assert.equal(result.length, 64);
  assert.equal(result.find((row) => row.teamId === '32' && row.position === 'WR').rank, 32);
  assert.equal(result.find((row) => row.teamId === '32' && row.position === 'TE').rank, 1);
  assert.equal(result.filter((row) => row.position === 'WR' && row.rank >= 29).length, 4);
});
