import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { defaultSettings, markets, readQuotes, readSettings, soccerSports } from '../supabase/functions/_shared/gamewaire.ts';
import { collectSoccerEvidence, soccerScoreDistribution, soccerTeamSamples, soccerPlayerObservation, evaluateSoccer, resolveSoccerMatchup } from '../supabase/functions/_shared/gamewaireSoccer.ts';
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
test('Full soccer analysis reserves exactly four distinct players plus one game lean; totals cannot crowd them out', () => {
  const props = Array.from({ length: 6 }, (_, index) => ({ ...quote, key: `prop-${index}`, market: 'player_shots', subject: `Player ${index}`, side: 'Over', line: .5 }));
  const total = { ...quote, key: 'total', market: 'totals', side: 'Over', line: 1.5 };
  const quotes = [quote, total, ...props, { ...props[0], key: 'duplicate', american: 500 }];
  const data = new Map(quotes.map(row => [row.key, { ...evidence, samples: games.map(game => ({ ...game, value: 3 })) }]));
  const full = evaluateSoccer(quotes, data, settings, now, 4);
  assert.equal(full.picks.length, 5);
  assert.equal(full.picks.filter(pick => pick.market === 'h2h').length, 1);
  assert.equal(full.picks.filter(pick => pick.market === 'totals').length, 0);
  assert.equal(new Set(full.picks.filter(pick => pick.market.startsWith('player_')).map(pick => pick.subject)).size, 4);
  const sparse = evaluateSoccer([quote, ...props.slice(0, 2)], data, settings, now, 4);
  assert.equal(sparse.picks.length, 3, 'Only real aligned props and the lean are returned, not invented fills');
});
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
  assert.equal(evaluate([quote]).picks.length, 1, 'Supported three-way outcomes do not need positive EV or a 50% probability');
  assert.equal(evaluate(quotes).picks.length, 1, 'Mutually exclusive outcomes never fill multiple game slots');
});
test('integer totals model push mass, half-lines do not and quarter-lines are rejected', () => {
  const total = { ...quote, key: 'total', market: 'totals', subject: 'Away @ Home', side: 'Over', line: 1, american: 2000 };
  const integer = evaluate([total]).picks[0];
  assert.ok(integer.pushProbability > 0);
  assert.ok(integer.probability + integer.pushProbability <= 1);
  assert.equal(evaluate([{ ...total, line: 1.5 }]).picks[0].pushProbability, 0);
  assert.equal(evaluate([{ ...total, line: 2.5 }]).picks.length, 0, 'A high payout cannot override an unsupported Over projection');
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
test('Champions League combines prior seasons and explicitly labels its four-game fallback', async () => {
  const q = { ...quote, sport: 'Champions League' }, requested = [];
  const fetcher = async url => {
    const season = Number(new URL(url).searchParams.get('season'));
    requested.push(season);
    const events = Array.from({ length: season === 2024 ? 0 : 4 }, (_, index) => {
      const row = scheduleEvent('uefa.champions');
      row.id = `${season}-${index}`; row.season.year = season;
      row.date = season === 2026 ? new Date(now - (index + 1) * 86400000).toISOString() : new Date(Date.UTC(season, 10, index + 1)).toISOString();
      return row;
    });
    return new Response(JSON.stringify({ season: { year: 2026 }, requestedSeason: { year: season }, events }));
  };
  const report = await collectSoccerEvidence([q], { season: 2026, home: { id: '1', name: 'Home' }, away: { id: '2', name: 'Away' } }, now, fetcher);
  assert.deepEqual(requested.sort(), [2024, 2024, 2025, 2025, 2026, 2026]);
  assert.deepEqual(report.coverage.seasons, [2026, 2025, 2024]);
  assert.ok(report.coverage.teamGames.every(team => team.games === 8 && team.currentSeasonGames === 4));
  assert.equal(report.evidence.get(q.key).eligible, true);
  assert.equal(evaluateSoccer([q], report.evidence, settings, now).picks.length, 1);
  const sparseFetcher = async url => {
    const season = Number(new URL(url).searchParams.get('season'));
    if (season !== 2026) return new Response('Unavailable', { status: 503 });
    return fetcher(url);
  };
  const sparse = await collectSoccerEvidence([q], { season: 2026, home: { id: '1', name: 'Home' }, away: { id: '2', name: 'Away' } }, now, sparseFetcher);
  assert.equal(sparse.evidence.get(q.key).eligible, true);
  assert.equal(sparse.coverage.minimumGames, 4);
  assert.ok(sparse.evidence.get(q.key).risks.some(risk => risk.startsWith('Limited evidence:')));
  assert.ok(sparse.warnings.some(warning => warning.includes('season 2025 unavailable')));
});
test('Four verified Champions League games support four aligned props and one lean with limited-evidence facts', () => {
  const current = games.slice(0, 4);
  const data = { ...evidence, soccerLeague: 'Champions League', samples: current.map(row => ({ ...row, value: 3 })),
    matchupForm: evidence.matchupForm.map(row => ({ ...row, recent: current })) };
  const lean = { ...quote, sport: 'Champions League' };
  const props = Array.from({ length: 4 }, (_, index) => ({ ...lean, key: `limited-${index}`, market: 'player_shots',
    subject: `Player ${index}`, side: 'Over', line: .5 }));
  const quotes = [lean, ...props];
  const result = evaluateSoccer(quotes, new Map(quotes.map(row => [row.key, data])), settings, now, 4);
  assert.equal(result.picks.length, 5);
  assert.ok(result.picks.every(pick => pick.effectiveSample === 4 && pick.facts.some(fact => fact.startsWith('Limited evidence:'))));
  const sparse = { ...data, samples: data.samples.slice(0, 3) };
  assert.equal(evaluateSoccer(props, new Map(props.map(row => [row.key, sparse])), settings, now, 4).picks.length, 0);
  const otherLeague = { ...data, soccerLeague: 'EPL' };
  assert.equal(evaluateSoccer(props.map(row => ({ ...row, sport: 'EPL' })), new Map(props.map(row => [row.key, otherLeague])), settings, now, 4).picks.length, 0);
});
test('Three-season scope is Champions-League-only; old/future seasons cannot masquerade as supported evidence', () => {
  const q = { ...quote, sport: 'Champions League', market: 'player_shots', side: 'Over', subject: 'Player', line: 1.5 };
  const samples = games.slice(0, 8).map((row, index) => ({ ...row, season: index < 4 ? 2026 : 2025, value: index < 4 ? 3 : 1 }));
  const data = { ...evidence, soccerLeague: 'Champions League', soccerSeasons: [2026, 2025, 2024], samples };
  const result = evaluate([q], data);
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].projection, 2);
  assert.equal(result.picks[0].seasonAverage, 3);
  assert.match(result.picks[0].baseline, /2026, 2025, 2024/);
  assert.equal(evaluate([{ ...q, sport: 'EPL' }], { ...data, soccerLeague: 'EPL' }).picks.length, 0);
  assert.equal(evaluate([q], { ...data, soccerSeasons: [2026, 2025, 2023] }).picks.length, 0);
  assert.equal(evaluate([q], { ...data, samples: samples.map(row => ({ ...row, season: 2023 })) }).picks.length, 0);
});
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
test('single-sided soccer props retain actual odds and verified estimates without inventing paired markets', () => {
  const raw = { id: 'soccer', home_team: 'Home', away_team: 'Away', commence_time: start,
    bookmakers: [{ key: 'book', markets: [{ key: 'player_shots', last_update: new Date(now).toISOString(),
      outcomes: [{ name: 'Over', description: 'Player', point: 1.5, price: 150 }] }] }] };
  const [prop] = readQuotes(raw, 'EPL');
  assert.equal(prop.noVig, null);
  assert.equal(prop.priceCoverage, 'single-sided');
  const data = { ...evidence, samples: games.map(game => ({ ...game, value: 3 })) };
  const report = evaluate([prop], data);
  assert.equal(report.picks.length, 1);
  assert.equal(report.picks[0].side, 'Over');
  assert.equal(report.picks[0].noVigEdge, null);
  assert.match(report.picks[0].risks.join(' '), /Single-sided sportsbook/);
  const paired = evaluate([{ ...prop, priceCoverage: undefined, noVig: .5 }], data).picks[0];
  assert.equal(report.picks[0].probability, paired.probability);
  assert.equal(report.picks[0].conservativeEV, paired.conservativeEV, 'One-sided support does not loosen value checks');
  assert.equal(evaluate([prop], { ...data, eligible: false }).picks.length, 0);
  assert.equal(evaluate([prop], { ...data, samples: data.samples.slice(0, 7) }).picks.length, 0);
  const totals = { ...prop, market: 'totals', subject: 'Away @ Home' };
  assert.equal(evaluate([totals], data).picks.length, 0, 'Totals still require both prices');
  raw.bookmakers[0].markets[0].outcomes.push({ ...raw.bookmakers[0].markets[0].outcomes[0] });
  const malformed = readQuotes(raw, 'EPL');
  assert.ok(malformed.every(row => row.priceCoverage === undefined));
  assert.equal(evaluate(malformed, data).picks.length, 0, 'Duplicate or ambiguous prices do not become single-sided support');
});
test('all supported soccer league settings include verified prop markets, not unverified handicaps', () => {
  for (const sport of soccerSports) {
    assert.equal(readSettings({ ...settings, markets: [...markets[sport]] }, sport).markets.length, 5);
    assert.throws(() => readSettings({ ...settings, markets: ['spreads'] }, sport), /supported/);
  }
  const ui = readFileSync(new URL('../src/Gamewaire.tsx', import.meta.url), 'utf8');
  assert.match(ui, /soccerSports/); assert.match(ui, /soccer leagues: daily at 1 AM Eastern/);
});
test('soccer matchup requires exact league identity and tight kickoff alignment', async () => {
  const event = { id: 'future', date: start, season: { year: 2026 }, competitions: [{ status: { type: { state: 'pre' } },
    competitors: [{ homeAway: 'home', team: { id: '1', displayName: 'Home' } }, { homeAway: 'away', team: { id: '2', displayName: 'Away' } }] }] };
  const fetcher = async url => { assert.match(String(url), /soccer\/eng\.1/); return Response.json({ events: [event] }); };
  assert.equal((await resolveSoccerMatchup(quote, fetcher)).eventId, 'future');
  event.date = new Date(Date.parse(start) + 6 * 60000).toISOString();
  await assert.rejects(resolveSoccerMatchup(quote, fetcher), /five minutes/);
});
test('Verified Champions League provider aliases match without weakening kickoff or ambiguity guards', async () => {
  const fixtures = [
    ['Bodø/Glimt', 'LASK', 'Bodo/Glimt', 'LASK Linz'],
    ['Feyenoord', 'Porto', 'Feyenoord Rotterdam', 'FC Porto'],
    ['RB Leipzig', 'RC Lens', 'RB Leipzig', 'Lens'],
    ['ŠK Slovan Bratislava', 'Real Betis', 'Slovan Bratislava', 'Real Betis'],
    ['Slavia Praha', 'Villarreal', 'Slavia Prague', 'Villarreal'],
    ['Sporting Lisbon', 'Manchester United', 'Sporting CP', 'Manchester United'],
  ];
  for (const [home, away, espnHome, espnAway] of fixtures) {
    const event = { id: 'verified', date: start, season: { year: 2026 }, competitions: [{
      status: { type: { state: 'pre' } }, competitors: [
        { homeAway: 'home', team: { id: '1', displayName: espnHome } },
        { homeAway: 'away', team: { id: '2', displayName: espnAway } },
      ],
    }] };
    const candidate = { ...quote, sport: 'Champions League', home, away };
    const fetcher = async url => { assert.match(String(url), /soccer\/uefa.champions/); return Response.json({ events: [event] }); };
    assert.equal((await resolveSoccerMatchup(candidate, fetcher)).eventId, 'verified');
    await assert.rejects(resolveSoccerMatchup(candidate, async () => Response.json({ events: [event, event] })), /unambiguously/);
    event.date = new Date(Date.parse(start) + 6 * 60000).toISOString();
    await assert.rejects(resolveSoccerMatchup(candidate, fetcher), /five minutes/);
  }
});
test('scheduler includes Champions League and domestic soccer without mixing NBA fixtures', () => {
  const source = readFileSync(new URL('../supabase/functions/_shared/gamewaireSchedule.ts', import.meta.url), 'utf8');
  assert.match(source, /scheduledSports: Sport\[\] = \['NBA', 'NFL', 'EPL', 'Serie A', 'La Liga', 'Bundesliga', 'Champions League'\]/);
  assert.equal(scheduleEvents([{ id: 'soccer', sport: 'EPL', start }], 'NBA', '2026-11-08', now).length, 0);
});
