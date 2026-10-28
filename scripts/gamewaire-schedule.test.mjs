import assert from 'node:assert/strict';
import test from 'node:test';
import { easternClock, scheduleWindow, scheduleEvents, planScheduledAnalyses } from '../supabase/functions/_shared/gamewaireSchedule.ts';

const now = Date.parse('2026-10-29T05:00:00Z');
const game = (id, home, away, start = '2026-10-29T23:00:00Z', sport = 'NBA') => ({ id, home, away, start, sport });
test('Schedules use Eastern 1 AM across DST, including the repeated fall-back hour', () => {
  for (const date of ['2026-07-01T05:00:00Z', '2026-12-01T06:00:00Z', '2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z']) {
    assert.equal(easternClock(Date.parse(date)).hour, 1);
  }
  assert.equal(easternClock(Date.parse('2026-12-01T05:00:00Z')).hour, 0);
  assert.equal(easternClock(now).weekday, 'Thu');
  assert.deepEqual(scheduleWindow('NFL', '2026-10-29'), { first: '2026-10-29', last: '2026-10-29' });
});
test('Both NBA and NFL use only upcoming games on that Eastern date', () => {
  const events = [
    game('thu', 'H', 'A', '2026-10-30T00:00:00Z', 'NFL'),
    game('mon', 'H', 'A', '2026-11-03T01:00:00Z', 'NFL'),
    game('tue', 'H', 'A', '2026-11-04T01:00:00Z', 'NFL'),
    game('old', 'H', 'A', '2026-10-29T04:30:00Z', 'NFL'),
    game('nba', 'H', 'A'),
  ];
  assert.deepEqual(scheduleEvents(events, 'NFL', '2026-10-29', now).map((event) => event.id), ['thu']);
  assert.deepEqual(scheduleEvents(events, 'NBA', '2026-10-29', now).map((event) => event.id), ['nba']);
});
const standings = (season, stats) => ({ season: { year: season }, children: [{ standings: {
  entries: Object.entries(stats).map(([name, [wins, losses]]) => ({ team: { displayName: name }, stats: [{ name: 'wins', value: wins }, { name: 'losses', value: losses }] })),
} }] });
function planner() {
  const batches = new Map(), calls = [];
  return { batches, calls, db: {
    from() {
      const filter = {};
      return { select() { return this; }, eq(key, value) { filter[key] = value; return this; },
        async maybeSingle() { return { data: batches.has(`${filter.sport}:${filter.game_date}`) ? { id: 'existing' } : null, error: null }; } };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      batches.set(`${args.target_sport}:${args.target_date}`, args);
      return { data: 'batch', error: null };
    },
  } };
}
test('Every day plans all NBA and NFL games once without standings requests', async () => {
  const fixture = planner(), fetches = [], listed = [];
  const list = async (sport) => { listed.push(sport); return Array.from({ length: sport === 'NBA' ? 15 : 1 }, (_, index) =>
    game(`event-${index}`, 'A', 'B', '2026-10-29T23:00:00Z', sport)); };
  const fetcher = async (url) => {
    fetches.push(String(url));
    return Response.json(standings(Number(new URL(url).searchParams.get('season')), { A: [2, 1], B: [2, 1] }));
  };
  await planScheduledAnalyses(fixture.db, list, fetcher, now);
  assert.deepEqual(listed, ['NBA', 'NFL']);
  assert.equal(fetches.length, 0, 'No standings dependency can omit a daily NBA game');
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[0].args.games.length, 15, 'All NBA games, not a three-game shortlist');
  assert.equal(fixture.calls[1].args.games.length, 1);
  assert.ok(fixture.calls.every(({ args }) => args.problem === null));
  assert.ok(fixture.calls.every(({ args }) => /Moneyline\/spread only; private/.test(args.plan_note)));
  await planScheduledAnalyses(fixture.db, list, fetcher, now + 60_000);
  assert.equal(listed.length, 2);
  assert.equal(fixture.calls.length, 2, 'Repeated/DST double-hour ticks cannot create another batch');
  await planScheduledAnalyses(fixture.db, list, fetcher, Date.parse('2026-10-30T05:00:00Z'));
  assert.equal(listed.at(-1), 'NFL');
  assert.equal(listed.length, 4, 'Both sports plan on Friday too');
  await planScheduledAnalyses(fixture.db, list, fetcher, Date.parse('2026-10-30T06:00:00Z'));
  assert.equal(listed.length, 4, 'Outside Eastern 1 AM no new batches are planned');
});
test('Planning failures are saved explicitly with no arbitrary fallback; empty days cost no odds analysis', async () => {
  const fixture = planner();
  await planScheduledAnalyses(fixture.db, async (sport) => {
    if (sport === 'NBA') throw new Error('Event list unavailable');
    return [];
  }, async () => { throw new Error('No standings requests expected'); }, now);
  assert.match(fixture.calls[0].args.problem, /Event list unavailable/);
  assert.deepEqual(fixture.calls[0].args.games, []);
  assert.deepEqual(fixture.calls[1].args.games, []);
  assert.equal(fixture.calls[1].args.problem, null);
});
