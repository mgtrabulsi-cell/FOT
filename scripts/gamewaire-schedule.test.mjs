import assert from 'node:assert/strict';
import test from 'node:test';
import { easternClock, scheduledNFLDate, scheduleWindow, scheduleEvents, planScheduledAnalyses, scheduledSports, scheduledMarkets } from '../supabase/functions/_shared/gamewaireSchedule.ts';
import { isSoccer, modelVersion, soccerModelVersion } from '../supabase/functions/_shared/gamewaire.ts';

const now = Date.parse('2026-10-29T05:00:00Z');
const game = (id, home, away, start = '2026-10-29T23:00:00Z', sport = 'NBA') => ({ id, home, away, start, sport });
test('Schedules use Eastern 1 AM across DST, including the repeated fall-back hour', () => {
  for (const date of ['2026-07-01T05:00:00Z', '2026-12-01T06:00:00Z', '2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z']) {
    assert.equal(easternClock(Date.parse(date)).hour, 1);
  }
  assert.equal(easternClock(Date.parse('2026-12-01T05:00:00Z')).hour, 0);
  assert.equal(easternClock(now).weekday, 'Thu');
  assert.deepEqual(scheduleWindow('NFL', '2026-10-29'), { first: '2026-10-29', last: '2026-11-04' });
});
test('NFL includes the full Thursday-Wednesday slate while NBA stays daily', () => {
  const events = [
    game('thu', 'H', 'A', '2026-10-30T00:00:00Z', 'NFL'),
    game('mon', 'H', 'A', '2026-11-03T01:00:00Z', 'NFL'),
    game('tue', 'H', 'A', '2026-11-04T01:00:00Z', 'NFL'),
    game('next-thu', 'H', 'A', '2026-11-05T23:00:00Z', 'NFL'),
    game('old', 'H', 'A', '2026-10-29T04:30:00Z', 'NFL'),
    game('nba', 'H', 'A'),
  ];
  assert.deepEqual(scheduleEvents(events, 'NFL', '2026-10-29', now).map((event) => event.id), ['thu', 'mon', 'tue']);
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
        async maybeSingle() { const saved = batches.get(`${filter.sport}:${filter.game_date}`); return { data: saved ? { id: 'existing', model_version: saved.target_model } : null, error: null }; } };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      batches.set(`${args.target_sport}:${args.target_date}`, args);
      return { data: 'batch', error: null };
    },
  } };
}
test('NBA plans daily and NFL plans weekly, once per model without standings requests', async () => {
  const fixture = planner(), fetches = [], listed = [];
  const list = async (sport) => { listed.push(sport); return Array.from({ length: sport === 'NBA' ? 15 : 1 }, (_, index) =>
    game(`event-${index}`, 'A', 'B', '2026-10-29T23:00:00Z', sport)); };
  const fetcher = async (url) => {
    fetches.push(String(url));
    return Response.json(standings(Number(new URL(url).searchParams.get('season')), { A: [2, 1], B: [2, 1] }));
  };
  await planScheduledAnalyses(fixture.db, list, fetcher, now);
  assert.deepEqual(listed, scheduledSports);
  assert.equal(fetches.length, 0, 'No standings dependency can omit a daily NBA game');
  assert.equal(fixture.calls.length, 6);
  assert.equal(fixture.calls[0].args.games.length, 15, 'All NBA games, not a three-game shortlist');
  assert.equal(fixture.calls[1].args.games.length, 1);
  assert.ok(fixture.calls.every(({ args }) => args.problem === null));
  assert.ok(fixture.calls.every(({ args }) => /Saved leans stay private/.test(args.plan_note)));
  assert.ok(fixture.calls.every(({ args }) => args.target_model === (isSoccer(args.target_sport) ? soccerModelVersion : modelVersion)));
  await planScheduledAnalyses(fixture.db, list, fetcher, now + 60_000);
  assert.equal(listed.length, 6);
  assert.equal(fixture.calls.length, 6, 'Repeated/DST double-hour ticks cannot create another batch');
  await planScheduledAnalyses(fixture.db, list, fetcher, Date.parse('2026-10-30T05:00:00Z'));
  assert.equal(listed.at(-1), 'Bundesliga');
  assert.equal(listed.length, 11, 'Daily soccer and NBA advance; the same NFL week is not planned twice');
  await planScheduledAnalyses(fixture.db, list, fetcher, Date.parse('2026-10-30T06:00:00Z'));
  assert.equal(listed.length, 11, 'Catch-up ticks do not duplicate current-model batches');
});
test('NFL plans the visible next week on Tuesday noon, including Wednesday evenings and DST changes', () => {
  for (const [time, date] of [
    ['2026-11-03T16:59:00Z', '2026-10-29'], ['2026-11-03T17:00:00Z', '2026-11-05'],
    ['2026-11-05T00:55:00Z', '2026-11-05'], ['2026-11-09T23:00:00Z', '2026-11-05'],
    ['2026-07-07T15:59:00Z', '2026-07-02'], ['2026-07-07T16:00:00Z', '2026-07-09'],
  ]) assert.equal(scheduledNFLDate(easternClock(Date.parse(time))), date, time);
});
test('An upgrade catches up both sports after hours without revisiting started games or requeueing the same model', async () => {
  const fixture = planner(), time = Date.parse('2026-11-05T00:55:00Z');
  fixture.batches.set('NBA:2026-11-04', { target_model: 'empirical-baseline-v8' });
  const events = [
    game('started', 'A', 'B', '2026-11-05T00:00:00Z'),
    game('nba', 'A', 'B', '2026-11-05T03:00:00Z'),
    game('nfl', 'A', 'B', '2026-11-06T01:15:00Z', 'NFL'),
  ];
  await planScheduledAnalyses(fixture.db, async () => events, fetch, time);
  assert.deepEqual(fixture.calls.filter(call => !isSoccer(call.args.target_sport)).map(call => [call.args.target_sport, call.args.target_date, call.args.games.map(game => game.event_id)]),
    [['NBA', '2026-11-04', ['nba']], ['NFL', '2026-11-05', ['nfl']]]);
  await planScheduledAnalyses(fixture.db, async () => { throw new Error('Already planned'); }, fetch, time + 60000);
  assert.equal(fixture.calls.length, 6);
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
test('A legacy daily Thursday batch extends once without hiding the rest of the NFL week', async () => {
  const fixture = planner();
  fixture.batches.set('NFL:2026-10-29', { plan_note: 'Old daily plan' });
  const events = [game('thu', 'H', 'A', '2026-10-30T00:00:00Z', 'NFL'), game('sun', 'H', 'A', '2026-11-01T18:00:00Z', 'NFL')];
  await planScheduledAnalyses(fixture.db, async (sport) => sport === 'NFL' ? events : [], fetch, now);
  assert.equal(fixture.calls.find((call) => call.args.target_sport === 'NFL').args.games.length, 2);
  await planScheduledAnalyses(fixture.db, async () => { throw new Error('Already planned'); }, fetch, now + 60000);
  assert.equal(fixture.calls.length, 6);
  assert.deepEqual(scheduleWindow('NFL', '2026-12-31'), { first: '2026-12-31', last: '2027-01-06' });
});
test('All four soccer leagues use daily Eastern windows, two team markets and no paid planning fetches', async () => {
  const fixture = planner();
  await planScheduledAnalyses(fixture.db, async sport => [
    game('today', 'H', 'A', '2026-10-30T03:00:00Z', sport),
    game('tomorrow', 'H', 'A', '2026-10-30T05:00:00Z', sport),
    game('started', 'H', 'A', '2026-10-29T04:00:00Z', sport),
  ], async () => { throw new Error('Planning must not request paid data'); }, now);
  for (const { args } of fixture.calls.filter(call => isSoccer(call.args.target_sport))) {
    assert.deepEqual(args.games.map(game => game.event_id), ['today']);
    assert.equal(args.target_model, soccerModelVersion);
    assert.deepEqual(scheduledMarkets(args.target_sport), ['h2h', 'totals']);
    assert.match(args.plan_note, /40 attempts \/ 80 credits/);
  }
  assert.deepEqual(scheduledMarkets('NBA'), ['h2h', 'spreads']);
  const before = planner();
  await planScheduledAnalyses(before.db, async () => { throw new Error('Before 1 AM'); }, fetch, now - 60000);
  assert.equal(before.calls.length, 0);
});
test('Oversized soccer slates save an explicit batch error instead of omitting games', async () => {
  const fixture = planner();
  await planScheduledAnalyses(fixture.db, async sport => sport === 'EPL'
    ? Array.from({ length: 101 }, (_, index) => game(`soccer-${index}`, 'H', 'A', '2026-10-29T23:00:00Z', sport)) : [],
  fetch, now);
  const batch = fixture.calls.find(call => call.args.target_sport === 'EPL').args;
  assert.match(batch.problem, /No games silently omitted/);
  assert.deepEqual(batch.games, []);
  assert.ok(fixture.calls.filter(call => call.args.target_sport !== 'EPL').every(call => call.args.problem === null));
});
