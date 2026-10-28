import assert from 'node:assert/strict';
import test from 'node:test';
import { easternClock, scheduleWindow, scheduleEvents, readStandings, rankNBAMatchups, planScheduledAnalyses } from '../supabase/functions/_shared/gamewaireSchedule.ts';
import { normalize } from '../supabase/functions/_shared/gamewaire.ts';

const now = Date.parse('2026-10-29T05:00:00Z');
const game = (id, home, away, start = '2026-10-29T23:00:00Z', sport = 'NBA') => ({ id, home, away, start, sport });
const rows = (values) => new Map(Object.entries(values).map(([name, [wins, losses]]) => [normalize(name), { wins, losses }]));
test('Schedules use Eastern 1 AM across DST, including the repeated fall-back hour', () => {
  for (const date of ['2026-07-01T05:00:00Z', '2026-12-01T06:00:00Z', '2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z']) {
    assert.equal(easternClock(Date.parse(date)).hour, 1);
  }
  assert.equal(easternClock(Date.parse('2026-12-01T05:00:00Z')).hour, 0);
  assert.equal(easternClock(now).weekday, 'Thu');
  assert.deepEqual(scheduleWindow('NFL', '2026-10-29'), { first: '2026-10-29', last: '2026-11-02' });
});
test('NBA only uses that Eastern date; NFL includes Thursday through Monday, not Tuesday', () => {
  const events = [
    game('thu', 'H', 'A', '2026-10-30T00:00:00Z', 'NFL'),
    game('mon', 'H', 'A', '2026-11-03T01:00:00Z', 'NFL'),
    game('tue', 'H', 'A', '2026-11-04T01:00:00Z', 'NFL'),
    game('old', 'H', 'A', '2026-10-29T04:30:00Z', 'NFL'),
    game('nba', 'H', 'A'),
  ];
  assert.deepEqual(scheduleEvents(events, 'NFL', '2026-10-29', now).map((event) => event.id), ['thu', 'mon']);
  assert.deepEqual(scheduleEvents(events, 'NBA', '2026-10-29', now).map((event) => event.id), ['nba']);
});
test('NBA favors two strong teams, then close matchups, caps at three and never fabricates missing standings', () => {
  const current = rows({ A: [3, 0], B: [3, 0], C: [2, 1], D: [2, 1], E: [1, 2], F: [0, 3], G: [2, 1], H: [3, 0] });
  const previous = rows({ A: [60, 22], B: [59, 23], C: [55, 27], D: [55, 27], E: [20, 62], F: [10, 72], G: [55, 27], H: [60, 22] });
  const events = [game('weak', 'E', 'F'), game('uneven', 'A', 'F'), game('good', 'A', 'B'), game('close', 'C', 'D'),
    game('less-close', 'G', 'H'), game('unknown', 'Unknown', 'A')];
  const result = rankNBAMatchups(events, current, previous);
  assert.deepEqual(result.games.map((row) => row.id), ['good', 'close', 'less-close']);
  assert.equal(result.omitted, 1);
  assert.match(result.games[0].selection_note, /50\/50/);
  assert.match(result.games[0].selection_note, /Not a betting-value ranking/);
});
test('Season blend ends at 12 games per team; zero games uses last season, not an invented current rate', () => {
  const current = rows({ Early: [1, 0], Steady: [8, 4], Zero: [0, 0], Other: [12, 0] });
  const previous = rows({ Early: [0, 82], Steady: [0, 82], Zero: [60, 22], Other: [82, 0] });
  const games = rankNBAMatchups([game('early', 'Early', 'Other'), game('steady', 'Steady', 'Other'), game('zero', 'Zero', 'Other')], current, previous).games;
  assert.deepEqual(games.map((row) => row.id), ['zero', 'steady', 'early']);
  assert.equal(games[0].strength, 60 / 82);
  assert.equal(games[1].strength, 8 / 12);
  assert.equal(games[2].strength, 0.5);
  assert.match(games[1].selection_note, /12\+ games per team/);
  assert.equal(rankNBAMatchups([game('missing', 'Early', 'Other')], current, new Map()).games.length, 0);
});
const standings = (season, stats) => ({ season: { year: season }, children: [{ standings: {
  entries: Object.entries(stats).map(([name, [wins, losses]]) => ({ team: { displayName: name }, stats: [{ name: 'wins', value: wins }, { name: 'losses', value: losses }] })),
} }] });
test('Standings parsing rejects empty data and reads nested conferences', () => {
  const result = readStandings(standings(2027, { A: [2, 1] }));
  assert.deepEqual(result.get('a'), { wins: 2, losses: 1 });
  assert.throws(() => readStandings({}), /standings are unavailable/);
  const la = readStandings(standings(2027, { 'LA Clippers': [12, 0], 'Los Angeles Lakers': [12, 0] }));
  assert.equal(rankNBAMatchups([game('la', 'Los Angeles Clippers', 'LA Lakers')], la, new Map()).games.length, 1);
});
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
test('Thursday plans both sports once, duplicates do not refetch, and preparation uses only free data', async () => {
  const fixture = planner(), fetches = [], listed = [];
  const list = async (sport) => { listed.push(sport); return [game('event', 'A', 'B', '2026-10-29T23:00:00Z', sport)]; };
  const fetcher = async (url) => {
    fetches.push(String(url));
    return Response.json(standings(Number(new URL(url).searchParams.get('season')), { A: [2, 1], B: [2, 1] }));
  };
  await planScheduledAnalyses(fixture.db, list, fetcher, now);
  assert.deepEqual(listed, ['NBA', 'NFL']);
  assert.equal(fetches.length, 2);
  assert.ok(fetches.every((url) => url.startsWith('https://site.web.api.espn.com/')));
  assert.equal(fixture.calls.length, 2);
  assert.ok(fixture.calls.every(({ args }) => args.games.length === 1 && args.problem === null));
  await planScheduledAnalyses(fixture.db, list, fetcher, now + 60_000);
  assert.equal(listed.length, 2);
  assert.equal(fixture.calls.length, 2, 'Repeated/DST double-hour ticks cannot create another batch');
  await planScheduledAnalyses(fixture.db, list, fetcher, Date.parse('2026-10-30T05:00:00Z'));
  assert.equal(listed.at(-1), 'NBA');
  assert.equal(listed.length, 3, 'NFL only plans on Thursdays');
  await planScheduledAnalyses(fixture.db, list, fetcher, Date.parse('2026-10-30T06:00:00Z'));
  assert.equal(listed.length, 3, 'Outside Eastern 1 AM no new batches are planned');
});
test('Planning failures are saved explicitly with no arbitrary fallback; empty days cost no odds analysis', async () => {
  const fixture = planner();
  await planScheduledAnalyses(fixture.db, async (sport) => sport === 'NBA' ? [game('event', 'A', 'B')] : [],
    async () => new Response('', { status: 503 }), now);
  assert.match(fixture.calls[0].args.problem, /HTTP 503/);
  assert.deepEqual(fixture.calls[0].args.games, []);
  assert.deepEqual(fixture.calls[1].args.games, []);
  assert.equal(fixture.calls[1].args.problem, null);
});
