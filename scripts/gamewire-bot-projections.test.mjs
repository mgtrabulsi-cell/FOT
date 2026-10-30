import assert from 'node:assert/strict';
import test from 'node:test';
import { collectBotProjections, collectReceivingDefenses, completedPlayerMetric, readBotDepth, positionGameYards, projectionSchedule, matchupEstimate as yardageEstimate } from '../supabase/functions/_shared/gamewireBotProjections.ts';
import { projectionIntelligence, quantile, observedLineComparison } from '../supabase/functions/_shared/gamewireBotIntelligence.ts';

const now = Date.parse('2026-10-29T18:00:00Z');
const player = { id: '123', name: 'Test Runner', position: 'RB', teamId: '23', team: 'Pittsburgh Steelers', teamAbbr: 'PIT' };
const matchup = { eventId: '999', start: '2026-11-01T18:00:00Z', opponentId: '5', opponent: 'Cleveland Browns', home: true, state: 'pre' };
const date = (index) => new Date(Date.UTC(2026, 9, 25 - index * 7)).toISOString();
function fixture({ allowed = 150, receiving = 20, receivingAllowed = 40, catches = 4, catchesAllowed = 10, omitCatches = false, history = false, contenders = false, badPositions = false, fewerDefenseGames = false, ownCount = 8, depthRank = 1, fail = false,
  failDefense = false, failOwn = false, badOwnGroup = false, recentPlayerAbsent = false } = {}) {
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
        ? [{ athlete: { id: recentPlayerAbsent && Number(id) < 106 ? '122' : '123' }, stats: ['65'] }, { athlete: { id: badOwnGroup ? 'unknown' : '124' }, stats: ['35'] }]
        : [{ athlete: { id: '200' }, stats: [String(allowed * .7)] }, { athlete: { id: badPositions ? 'unknown' : '201' }, stats: [String(allowed * .3)] }] },
      { name: 'receiving', keys: ['receivingYards', ...omitCatches ? [] : ['receptions']], athletes: own
        ? [{ athlete: { id: recentPlayerAbsent && Number(id) < 106 ? '122' : '123' }, stats: [String(receiving), String(catches)] }, { athlete: { id: badOwnGroup ? 'unknown' : '124' }, stats: ['20', '2'] }]
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
      if (other) return box(id, other.competitions[0].competitors[1].team.id, false);
      assert.ok(Number(id) >= 600 && Number(id) < 608); return box(id, '33', false);
    }
    const id = new URL(url).pathname.match(/teams\/(\d+)\/schedule/)[1];
    if (failDefense && id === '5' || failOwn && id === '23') throw new Error('Schedule provider failed');
    if (id === '23') return schedule(id, ownEvents, contenders ? '1st in AFC North' : undefined);
    if (id === '5') return schedule(id, otherEvents, contenders ? '2nd in AFC North' : undefined);
    return schedule(id, Array.from({ length: 8 }, (_, index) => game(600 + index, index + 4, id, '33')));
  };
  const run = (options = {}) => collectBotProjections(options.player ?? player, options.matchup === undefined ? matchup : options.matchup, 2026,
    options.logs === undefined ? logs : options.logs, { players: [player], positions: options.player ? Object.fromEntries(Object.keys(positions).map((id) => [id, options.player.position])) : positions,
      season: 2026, week: 8, seasonType: 2, checkedAt: new Date(now).toISOString(), warnings: [] }, options.get ?? get, options.now ?? now, options.defenses ?? []);
  return { run, box, calls, positions, logs, schedule, ownEvents, get };
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
  assert.equal(weak.sourceGames.length, 18);
  assert.equal(weak.sourceGames.filter((game) => game.role === 'opponent').length, 10);
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
test('Only current-season opponent meetings affect estimates; prior-season stats are never requested', async () => {
  const base = (await fixture().run())[0], history = (await fixture({ history: true }).run())[0];
  assert.equal(history.historyGames, 0); assert.equal(history.historyAverage, null);
  assert.equal(history.yards, base.yards);
  const api = fixture();
  for (const event of Object.values(api.logs.events)) event.opponent.id = '5';
  const currentHistory = (await api.run())[0];
  assert.equal(currentHistory.historyGames, 3); assert.equal(currentHistory.historyAverage, 65);
  assert.equal(currentHistory.yards, 74);
  assert.match(currentHistory.explanation, /Past meetings also factor in/);
  assert.ok(api.calls.every((url) => !url.includes('season=2025') && !url.includes('season=2024')));
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
test('Missing positional coverage uses labeled player-production fallback while small matchup samples remain bounded', async () => {
  const unknown = (await fixture({ badPositions: true }).run())[0];
  assert.equal(unknown.yards, 65); assert.equal(unknown.basis, 'current-season');
  assert.match(unknown.warnings.join(' '), /position could not be verified/);
  const sparse = (await fixture({ fewerDefenseGames: true }).run())[0];
  assert.equal(sparse.defenseGames, 2); assert.equal(sparse.yards, 70); assert.equal(sparse.limitedData, true);
  const blocked = await fixture({ fail: true }).run();
  assert.equal(blocked[0].estimate, 65); assert.equal(blocked[1].estimate, 20); assert.equal(blocked[2].estimate, 4);
  assert.ok(blocked.every((row) => row.basis === 'current-season'));
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
    const summaries = weakApi.calls.filter((url) => url.includes('/summary?'));
    assert.equal(summaries.length, 18, 'Reuse boxes across yardage, receptions and historical defense profiles');
    assert.equal(new Set(summaries).size, summaries.length, 'Never fetch a completed box twice');
    assert.match(weak.explanation, /reception matchup/);
  }
  const historical = (await fixture({ history: true }).run()).find((row) => row.market === 'player_receptions');
  assert.equal(historical.estimate, 4.8); assert.equal(historical.historyAverage, null);
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
test('Missing own/opponent schedules or group classification cannot suppress a verified current-season player average', async () => {
  for (const options of [{ failDefense: true }, { failOwn: true }, { badOwnGroup: true }]) {
    const result = await fixture(options).run();
    assert.deepEqual(result.map((row) => row.estimate), [65, 20, 4], JSON.stringify(options));
    assert.ok(result.every((row) => row.basis === 'current-season'));
    assert.ok(result.every((row) => row.explanation.includes('fallback estimate')));
  }
  const independent = await fixture({ badOwnGroup: true }).run({ logs: null });
  assert.deepEqual(independent.map((row) => row.estimate), [65, 20, 4], 'Target stats survive unrelated unclassified teammates');
  const noProduction = await fixture({ fail: true }).run({ logs: null });
  assert.ok(noProduction.every((row) => row.estimate === null));
  assert.match(noProduction[0].explanation, /No verified current-season/);
});
test('Fallbacks recover earlier completed games in the same season without inventing absent-player zeroes or using prior seasons', async () => {
  const api = fixture({ recentPlayerAbsent: true });
  const rows = await api.run({ logs: null });
  assert.deepEqual(rows.map((row) => row.estimate), [65, 20, 4]);
  assert.ok(rows.every((row) => row.playerGames === 3 && row.basis === 'current-season'));
  assert.ok(api.calls.some((url) => url.includes('event=106')));
  assert.ok(api.calls.every((url) => !url.includes('/gamelog')));
  const absent = await fixture({ recentPlayerAbsent: true, ownCount: 5 }).run({ logs: null });
  assert.ok(absent.every((row) => row.estimate === null));
  const box = fixture().box('101', '23', true);
  assert.equal(completedPlayerMetric(box, '101', '23', 2026, 'rushing', 'rushingYards', '123'), 65);
  assert.equal(completedPlayerMetric(box, '101', '23', 2026, 'rushing', 'rushingYards', 'absent'), null);
  assert.throws(() => completedPlayerMetric(box, '101', '23', 2025, 'rushing', 'rushingYards', '123'), /requested completed/);
  box.header.competitions[0].status.type.completed = false;
  assert.throws(() => completedPlayerMetric(box, '101', '23', 2026, 'rushing', 'rushingYards', '123'), /requested completed/);
});
test('Fallbacks apply available backup roles and measured zero production remains a real estimate', async () => {
  const first = (await fixture({ failDefense: true }).run())[0];
  const second = (await fixture({ failDefense: true, depthRank: 2 }).run())[0];
  assert.equal(first.estimate, 65); assert.equal(second.estimate, 40);
  const withoutShare = (await fixture({ badOwnGroup: true, depthRank: 2 }).run())[0];
  assert.equal(withoutShare.estimate, 42); assert.equal(withoutShare.role.rank, 2);
  const zero = (await fixture({ failDefense: true, catches: 0 }).run()).find((row) => row.market === 'player_receptions');
  assert.equal(zero.estimate, 0); assert.equal(zero.basis, 'current-season');
});
test('Older current-season production remains usable but explicitly discloses stale workload', async () => {
  const rows = await fixture().run({ now: Date.parse('2026-11-23T18:00:00Z'), matchup: { ...matchup, start: '2026-11-25T18:00:00Z' } });
  assert.deepEqual(rows.map((row) => row.estimate), [65, 20, 4]);
  assert.ok(rows.every((row) => row.basis === 'current-season' && row.limitedData));
  assert.match(rows[0].explanation, /over 21 days old/);
  assert.match(rows[0].warnings.join(' '), /does not confirm a current workload/);
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
test('Bottom-four yardage ranks widen upside caps only with sustained verified volume, without multiplying the same weakness twice', async () => {
  for (const position of ['WR', 'TE']) {
    const receiver = { ...player, position, name: 'Test Receiver' };
    const api = fixture({ receiving: 100, receivingAllowed: 400 });
    const get = async (url) => {
      const data = await api.get(url);
      if (url.includes('/summary?') && new URL(url).searchParams.get('event').startsWith('1')) {
        const stats = data.boxscore.players[0].statistics[1];
        stats.keys.push('receivingTargets'); stats.athletes[0].stats.push('10'); stats.athletes[1].stats.push('4');
      }
      return data;
    };
    const base = (await api.run({ player: receiver, get }))[0];
    const weak = (await api.run({ player: receiver, get,
      defenses: [{ teamId: '5', position, rank: 29, games: 5, average: 400 }] }))[0];
    assert.ok(weak.estimate > base.estimate); assert.ok(weak.estimate <= 135);
    assert.match(weak.explanation, /Bottom-four/);
    const noBoost = (await api.run({ player: receiver, get,
      defenses: [{ teamId: '5', position, rank: 28, games: 5, average: 400 }] }))[0];
    assert.equal(noBoost.estimate, base.estimate);
    const named = (await api.run({ player: receiver, get, matchup: { ...matchup, opponent: 'Dallas Cowboys' } }))[0];
    assert.equal(named.estimate, base.estimate);
    const unsupportedVolume = (await fixture({ receiving: 100, receivingAllowed: 400 }).run({ player: receiver,
      defenses: [{ teamId: '5', position, rank: 29, games: 5, average: 400 }] }))[0];
    assert.equal(unsupportedVolume.estimate, 125);
    const moderate = (await fixture({ receiving: 100, receivingAllowed: 200 }).run({ player: receiver,
      defenses: [{ teamId: '5', position, rank: 29, games: 5, average: 200 }] }))[0];
    assert.equal(moderate.estimate, 120, 'A ranking never creates an extra multiplier on an already-measured allowance');
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
const evidenceInput = (options = {}) => ({
  foundation: 75, baseline: 65, share: .65, matchupReady: true, limited: false, opportunityLabel: 'Carries',
  observations: Array.from({ length: 8 }, (_, index) => ({ eventId: String(100 + index), date: date(index), value: 65, opportunity: 15 })),
  recentAllowance: 150, seasonAllowance: 150, defenseGames: 8, comparable: [], ...options,
});
test('Evidence layer preserves the existing foundation, treats opportunity separately and never forces an illustrative target', () => {
  const normal = projectionIntelligence(evidenceInput());
  assert.equal(normal.estimate, 75); assert.equal(normal.evidence.foundation, 75);
  assert.equal(normal.evidence.matchup, 'Favorable');
  assert.equal(normal.evidence.usage.trend, 'Stable'); assert.equal(normal.evidence.usage.efficiency, 4.33);
  assert.equal(normal.evidence.confidence, 'Uncalibrated');
  const strong = projectionIntelligence(evidenceInput({ foundation: 53, recentAllowance: 40, seasonAllowance: 40 }));
  assert.equal(strong.estimate, 53); assert.equal(strong.evidence.matchup, 'Unfavorable');
  assert.equal(normal.evidence.comparable.adjustment, 0);
  assert.match(normal.evidence.risks.join(' '), /No calibrated forecast/);
  assert.match(normal.evidence.risks.join(' '), /weather/);
});
test('Season/recent positional blend replaces the existing allowance term instead of adding it twice', () => {
  const result = projectionIntelligence(evidenceInput({ seasonAllowance: 100 }));
  assert.equal(result.estimate, 69.15, '75 + .3*.65*(.4*150+.6*100 - 150)');
  const absent = projectionIntelligence(evidenceInput({ foundation: 65, matchupReady: false, limited: true, recentAllowance: null, seasonAllowance: null }));
  assert.equal(absent.estimate, 65); assert.equal(absent.evidence.matchup, 'Unverified');
  assert.match(absent.evidence.edge, /no verified matchup edge/i);
  const limited = projectionIntelligence(evidenceInput({ foundation: 70, limited: true, seasonAllowance: 100 }));
  assert.equal(limited.estimate, 67.075);
  assert.equal(projectionIntelligence(evidenceInput({ seasonAllowance: 100, allowanceWeight: .27 })).estimate, 69.735, 'Retain the original opponent weight after direct-history blending');
});
test('Comparable-defense residuals require three similar pregame allowance and volume samples; shrinkage and outlier caps apply', () => {
  const comparable = Array.from({ length: 3 }, (_, index) => ({ eventId: String(100 + index), date: date(index), value: 90, opportunity: 15, allowance: 150, defenseGames: 3 }));
  const result = projectionIntelligence(evidenceInput({ comparable }));
  assert.ok(result.estimate > 75 && result.estimate < 77);
  assert.equal(result.evidence.comparable.games, 3); assert.equal(result.evidence.comparable.mean, 90);
  assert.ok(result.evidence.comparable.adjustment > 0 && result.evidence.comparable.adjustment <= 5);
  for (const samples of [comparable.slice(0, 2), comparable.map((row) => ({ ...row, defenseGames: 2 })),
    comparable.map((row) => ({ ...row, opportunity: 4 })), comparable.map((row) => ({ ...row, allowance: 50 }))]) {
    assert.equal(projectionIntelligence(evidenceInput({ comparable: samples })).estimate, 75);
  }
  const outlier = projectionIntelligence(evidenceInput({ comparable: comparable.map((row, i) => ({ ...row, value: i ? 65 : 1000 })) }));
  assert.ok(Math.abs(outlier.evidence.comparable.adjustment) <= 5);
  assert.equal(projectionIntelligence(evidenceInput({ comparable: Array(3).fill(comparable[0]) })).evidence.comparable.adjustment, 0, 'One duplicated appearance cannot become three samples');
  assert.equal(projectionIntelligence(evidenceInput({ comparable, limited: true })).evidence.comparable.adjustment, 0);
});
test('Usage trends and empirical middle-50% ranges are descriptive, not a second opportunity multiplier or calibrated interval', () => {
  const observations = Array.from({ length: 6 }, (_, index) => ({ eventId: String(index), date: date(index), value: 10 + index * 10, opportunity: index < 3 ? 20 : 10 }));
  const rising = projectionIntelligence(evidenceInput({ observations }));
  assert.equal(rising.estimate, 75);
  assert.equal(rising.evidence.usage.trend, 'Rising');
  assert.deepEqual(rising.evidence.observed, { games: 6, mean: 35, median: 35, low: 22.5, high: 47.5 });
  assert.match(rising.evidence.risks.join(' '), /not multiplied/);
  assert.equal(projectionIntelligence(evidenceInput({ observations: observations.slice(0, 2) })).evidence.observed, null);
  assert.equal(projectionIntelligence(evidenceInput({ observations: observations.map((row) => ({ ...row, opportunity: null })) })).evidence.usage, null);
  assert.throws(() => quantile([], .5), /finite samples/);
  assert.throws(() => quantile([1, 2], NaN), /valid fraction/);
  assert.throws(() => projectionIntelligence(evidenceInput({ observations: [{ ...observations[0], opportunity: 1.5 }] })), /invalid player observation/);
});
test('Saved sportsbook lines are independent comparisons with observed counts, pushes and no invented probabilities', () => {
  const observations = [60, 70, 80, 90].map((value, i) => ({ eventId: String(i), date: date(i), value, opportunity: 15 }));
  const above = observedLineComparison(84, 70, observations);
  assert.deepEqual(above, { line: 70, difference: 14, assessment: 'Above saved line', games: 4, over: 2, under: 1, pushes: 1, observedOverRate: 50, observedUnderRate: 25 });
  assert.equal(observedLineComparison(84, 90, observations).assessment, 'Below saved line');
  assert.equal(observedLineComparison(84, 84, observations).difference, 0);
  assert.equal(observedLineComparison(84, 70, []).observedOverRate, null);
  assert.throws(() => observedLineComparison(84, -1, observations), /valid projection/);
  assert.throws(() => observedLineComparison(Infinity, 70, observations), /valid projection/);
});
test('Collector recovers volume evidence, uses only pre-kickoff comparable profiles and excludes duplicate history factors', async () => {
  const api = fixture();
  const get = async (url) => {
    const data = await api.get(url);
    if (url.includes('/summary?') && new URL(url).searchParams.get('event').startsWith('1')) {
      const stats = data.boxscore.players[0].statistics[0];
      stats.keys.push('rushingAttempts'); stats.athletes[0].stats.push('15'); stats.athletes[1].stats.push('10');
    }
    return data;
  };
  const rows = await api.run({ get });
  assert.equal(rows[0].evidence.usage.games, 8);
  assert.equal(rows[0].evidence.comparable.games, 3);
  assert.ok(rows[0].evidence.comparable.adjustment < 0);
  assert.ok(rows[0].estimate < rows[0].evidence.foundation);
  assert.equal(rows[0].evidence.observed.games, 8);
  assert.ok(api.calls.every((url) => !url.includes('season=2025')));
  for (const event of Object.values(api.logs.events)) event.opponent.id = '5';
  const history = (await api.run({ get }))[0];
  assert.equal(history.historyGames, 3); assert.equal(history.evidence.comparable.games, 0);
  const before = date(3);
  assert.ok(api.calls.filter((url) => url.includes('/summary?event=6')).every((url) => {
    const id = Number(new URL(url).searchParams.get('event'));
    return Date.parse(date(id - 600 + 4)) < Date.parse(before);
  }));
});
test('Receiving-yardage rank cannot inflate receptions, even against a bottom-four yardage defense', async () => {
  const receiver = { ...player, position: 'TE' };
  const normal = (await fixture().run({ player: receiver })).find((row) => row.unit === 'receptions');
  const ranked = (await fixture().run({ player: receiver, defenses: [{ teamId: '5', position: 'TE', rank: 32, games: 5, average: 200 }] })).find((row) => row.unit === 'receptions');
  assert.equal(normal.estimate, ranked.estimate);
  assert.doesNotMatch(ranked.explanation, /Bottom-four/);
});
test('Collector combines full-season and recent positional allowances and exposes matching efficiency samples', async () => {
  const api = fixture();
  const get = async (url) => {
    if (/summary\?event=20[678]/.test(url)) {
      const box = api.box(new URL(url).searchParams.get('event'), '33', false);
      box.boxscore.players[0].statistics[0].athletes[0].stats[0] = '28';
      box.boxscore.players[0].statistics[0].athletes[1].stats[0] = '12';
      return box;
    }
    const data = await api.get(url);
    if (url.includes('/teams/5/schedule')) {
      data.events.push(...[6, 7, 8].map((id) => ({ id: String(200 + id), date: date(id - 1),
        competitions: [{ status: { type: { completed: true } }, competitors: [{ team: { id: '5' }, score: { value: 20 } }, { team: { id: '33' }, score: { value: 10 } }] }] })));
    }
    if (url.includes('/summary?event=20')) {
      const stats = data.boxscore.players[0].statistics[0];
      stats.keys.push('rushingAttempts'); stats.athletes[0].stats.push('20'); stats.athletes[1].stats.push('10');
    }
    return data;
  };
  const row = (await api.run({ get }))[0];
  assert.equal(row.evidence.foundation, 75);
  assert.deepEqual(row.evidence.defense, { recent: 150, season: 108.75, games: 8, opportunityAverage: 30, opportunityGames: 5, efficiency: 5 });
  assert.equal(row.estimate, 70);
  assert.ok(row.sourceGames.some((game) => game.id === '208'));
});
test('Optional evidence collection stops starting requests after its budget and retains the verified foundation', async () => {
  const api = fixture(), realNow = Date.now;
  let clock = realNow(), summaries = 0;
  Date.now = () => clock;
  try {
    const get = async (url) => {
      const data = await api.get(url);
      if (url.includes('/summary?') && ++summaries === 10) clock += 41_000;
      return data;
    };
    const row = (await api.run({ get }))[0];
    assert.equal(summaries, 10);
    assert.equal(row.estimate, 75);
    assert.match(row.warnings.join(' '), /time budget reached/);
  } finally { Date.now = realNow; }
});
