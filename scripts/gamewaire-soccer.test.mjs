import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { defaultSettings, markets, readQuotes, readSettings, soccerSports } from '../supabase/functions/_shared/gamewaire.ts';
import { soccerScoreDistribution, soccerTeamSamples, soccerPlayerObservation, evaluateSoccer, resolveSoccerMatchup } from '../supabase/functions/_shared/gamewaireSoccer.ts';
import { scheduleEvents } from '../supabase/functions/_shared/gamewaireSchedule.ts';
const now = Date.parse('2026-11-07T12:00:00Z');
const date = new Date(now - 86400000).toISOString();
const start = new Date(now + 86400000).toISOString();
const settings = { ...defaultSettings, markets: ['h2h', 'totals', 'player_shots'] };
const quote = { key: 'soccer|h2h|Draw', eventId: 'soccer', sport: 'EPL', start, home: 'Home', away: 'Away',
  market: 'h2h', subject: 'Draw', side: 'Draw', line: null, american: 400, book: 'Book', updatedAt: new Date(now).toISOString(), noVig: .25 };
const games = Array.from({ length: 12 }, (_, index) => ({ eventId: `g${index}`, date: new Date(now - (index + 1) * 86400000).toISOString(),
  season: 2026, value: 0, pointsFor: 1, pointsAgainst: 1, total: 2 }));
const evidence = { eligible: true, soccerLeague: 'EPL', quality: .75, fetchedAt: new Date(now).toISOString(), currentSeason: 2026, samples: games, risks: ['Experimental'],
  matchupForm: [{ team: 'Home', season: 2026, recent: games }, { team: 'Away', season: 2026, recent: games }] };
const evaluate = (quotes, data = evidence) => evaluateSoccer(quotes, new Map(quotes.map(row => [row.key, data])), settings, now);
test('three-way odds normalize with draw and incomplete markets are excluded', () => {
  const raw = { id: 'soccer', home_team: 'Home', away_team: 'Away', commence_time: start,
    bookmakers: [{ key: 'book', markets: [{ key: 'h2h', last_update: date,
      outcomes: [{ name: 'Home', price: 150 }, { name: 'Away', price: 150 }, { name: 'Draw', price: 300 }] }] }] };
  const quotes = readQuotes(raw, 'EPL');
  assert.equal(quotes.length, 3);
  assert.ok(Math.abs(quotes.reduce((sum, row) => sum + row.noVig, 0) - 1) < 1e-12);
  raw.bookmakers[0].markets[0].outcomes.pop();
  assert.ok(readQuotes(raw, 'EPL').every(row => row.noVig === null));
});
test('draw is a real outcome, never a push; Poisson mass and outcomes normalize', () => {
  const distribution = soccerScoreDistribution(1, 1);
  assert.ok(Math.abs(distribution.reduce((sum, row) => sum + row.probability, 0) - 1) < 1e-12);
  const quotes = [quote, { ...quote, key: 'home', subject: 'Home', side: 'Home' }, { ...quote, key: 'away', subject: 'Away', side: 'Away' }];
  const leans = quotes.map(row => evaluate([row]).teamLean.pick);
  assert.ok(Math.abs(leans.reduce((sum, row) => sum + row.probability, 0) - 1) < 1e-12);
  assert.ok(leans.every(row => row.pushProbability === 0));
  assert.ok(leans[0].probability > .3);
  assert.equal(evaluate([quote]).picks.length, 0, 'Small sample uncertainty must not force a value bet');
});
test('integer totals model push mass, half-lines do not and quarter-lines are rejected', () => {
  const total = { ...quote, key: 'total', market: 'totals', subject: 'Away @ Home', side: 'Over', line: 2, american: 2000 };
  const integer = evaluate([total]).picks[0];
  assert.ok(integer.pushProbability > 0);
  assert.ok(integer.probability + integer.pushProbability <= 1);
  assert.equal(evaluate([{ ...total, line: 2.5 }]).picks[0].pushProbability, 0);
  assert.match(evaluate([{ ...total, line: 2.25 }]).rejected[0].reason, /quarter/);
});
test('stale, future, wrong-season and missing evidence cannot generate candidates', () => {
  for (const data of [{ ...evidence, eligible: false }, { ...evidence, fetchedAt: 'invalid' },
    { ...evidence, soccerLeague: 'La Liga' }, { ...evidence, samples: [{ ...games[0], date: start }] }, { ...evidence, samples: [{ ...games[0], season: 2025 }] }])
    assert.equal(evaluate([quote], data).status, 'insufficient_data');
  assert.equal(evaluate([{ ...quote, updatedAt: new Date(now - 700000).toISOString() }]).teamLean, undefined);
});
const scheduleEvent = (league = 'eng.1') => ({ id: 'g', date, season: { year: 2026 }, competitions: [{
  status: { period: 2, type: { completed: true, name: 'STATUS_FULL_TIME' } },
  competitors: [{ team: { id: '1' }, homeAway: 'home', score: { value: 1, $ref: `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${league}/events/g/scores/1` } },
    { team: { id: '2' }, homeAway: 'away', score: { value: 1, $ref: `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${league}/events/g/scores/2` } }],
}] });
test('schedule evidence isolates the selected league, season, final regulation time and cutoff', () => {
  const good = scheduleEvent();
  const data = { season: { year: 2026 }, events: [good, good, scheduleEvent('esp.1'), { ...good, id: 'future', date: start }] };
  assert.equal(soccerTeamSamples(data, '1', 'EPL', 2026, now).length, 1);
  good.competitions[0].status.period = 4;
  assert.equal(soccerTeamSamples(data, '1', 'EPL', 2026, now).length, 0);
  assert.throws(() => soccerTeamSamples(data, '1', 'EPL', 2025, now), /season mismatch/);
});
test('player stats require an actual appearance and explicit stat, never bench/missing zero', () => {
  const q = { ...quote, subject: 'Player', market: 'player_shots' };
  const stats = [{ name: 'appearances', value: 1 }, { name: 'totalShots', value: 0 }];
  const summary = { header: { id: 'g', date: games[0].date, competitions: [scheduleEvent().competitions[0]] },
    rosters: [{ team: { id: '1' }, roster: [{ athlete: { id: 'player', displayName: 'Player' }, stats }] }] };
  assert.equal(soccerPlayerObservation(summary, q, { ...games[0], eventId: 'g' }, '1').value, 0);
  stats.pop();
  assert.equal(soccerPlayerObservation(summary, q, { ...games[0], eventId: 'g' }, '1'), undefined);
  stats.push({ name: 'totalShots', value: 0 }); stats[0].value = 0;
  assert.equal(soccerPlayerObservation(summary, q, { ...games[0], eventId: 'g' }, '1'), undefined);
});
test('all four league settings support verified prop markets, not unverified handicaps', () => {
  for (const sport of soccerSports) {
    assert.equal(readSettings({ ...settings, markets: [...markets[sport]] }, sport).markets.length, 5);
    assert.throws(() => readSettings({ ...settings, markets: ['spreads'] }, sport), /supported/);
  }
  const ui = readFileSync(new URL('../src/Gamewaire.tsx', import.meta.url), 'utf8');
  assert.match(ui, /soccerSports/); assert.match(ui, /no scheduling/);
});
test('soccer matchup requires exact league identity and tight kickoff alignment', async () => {
  const event = { id: 'future', date: start, season: { year: 2026 }, competitions: [{ status: { type: { state: 'pre' } },
    competitors: [{ homeAway: 'home', team: { id: '1', displayName: 'Home' } }, { homeAway: 'away', team: { id: '2', displayName: 'Away' } }] }] };
  const fetcher = async url => { assert.match(String(url), /soccer\/eng\.1/); return Response.json({ events: [event] }); };
  assert.equal((await resolveSoccerMatchup(quote, fetcher)).eventId, 'future');
  event.date = new Date(Date.parse(start) + 6 * 60000).toISOString();
  await assert.rejects(resolveSoccerMatchup(quote, fetcher), /five minutes/);
});
test('scheduler never selects soccer fixtures', () => {
  const source = readFileSync(new URL('../supabase/functions/_shared/gamewaireSchedule.ts', import.meta.url), 'utf8');
  assert.match(source, /const sports: Sport\[\] = \['NBA', 'NFL'\]/);
  assert.equal(scheduleEvents([{ id: 'soccer', sport: 'EPL', start }], 'NBA', '2026-11-08', now).length, 0);
});
