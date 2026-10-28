import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as engine from '../supabase/functions/_shared/gamewaire.ts';
import * as sources from '../supabase/functions/_shared/gamewaireSources.ts';
import * as schedule from '../supabase/functions/_shared/gamewaireSchedule.ts';

const now = Date.parse('2026-10-27T18:00:00Z');
const quote = { key: 'event|player_points|Player|Over|20.5', eventId: 'event', sport: 'NBA',
  start: new Date(now + 86_400_000).toISOString(), home: 'Boston Celtics', away: 'Atlanta Hawks',
  market: 'player_points', subject: 'Player', side: 'Over', line: 20.5, american: 150,
  book: 'Book A', updatedAt: new Date(now - 60_000).toISOString(), noVig: 0.5 };
const settings = { ...engine.defaultSettings, markets: ['player_points', 'player_rebounds', 'h2h'] };
const evidence = { eligible: true, fetchedAt: new Date(now).toISOString(), quality: 0.8, risks: ['Experimental'],
  samples: Array.from({ length: 30 }, (_, index) => ({ date: new Date(now - (index + 1) * 86_400_000).toISOString(), value: index < 27 ? 30 : 10 })) };
const evaluate = (quotes = [quote], data = evidence, options = settings, time = now) => engine.evaluate(quotes, new Map(quotes.map((q) => [q.key, data])), options, time);

test('American conversion, raw implied, no-vig and exact push-aware EV are deterministic', () => {
  assert.equal(engine.decimalOdds(150), 2.5);
  assert.equal(engine.decimalOdds(-200), 1.5);
  assert.equal(engine.impliedProbability(-200), 2 / 3);
  assert.deepEqual(engine.noVigProbabilities([-110, -110]), [0.5, 0.5]);
  assert.ok(Math.abs(engine.expectedValue(0.5, 0.1, 100) - 0.1) < 1e-10);
  assert.equal(engine.expectedValue(0, 1, -110), 0);
  for (const bad of [0, -99, 99, NaN, Infinity]) assert.throws(() => engine.decimalOdds(bad));
  assert.throws(() => engine.expectedValue(0.9, 0.2, 100));
  assert.throws(() => engine.noVigProbabilities([100]));
});

test('Provider quotes preserve exact lines and prices, match two-way markets and choose the best fresh price', () => {
  const raw = { id: 'event', home_team: quote.home, away_team: quote.away, commence_time: quote.start,
    bookmakers: ['A', 'B'].map((book, i) => ({ key: book, title: book, markets: [{ key: 'player_points', last_update: quote.updatedAt,
      outcomes: [{ name: 'Over', description: 'Player', point: 20.5, price: i ? 160 : 150 }, { name: 'Under', description: 'Player', point: 20.5, price: -180 }] }] })) };
  const quotes = engine.readQuotes(raw, 'NBA');
  assert.equal(quotes.length, 4);
  assert.equal(quotes[0].line, 20.5);
  assert.notEqual(quotes[0].noVig, null);
  const result = evaluate(quotes);
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].american, 160);
  assert.equal(result.picks[0].book, 'B');
  assert.equal(evaluate([quote, { ...quote, american: 200, noVig: null }]).picks[0].american, 150,
    'An incomplete better-priced book cannot hide a valid complete two-way offer');
  raw.bookmakers[0].markets[0].outcomes[1].point = 21.5;
  assert.equal(engine.readQuotes(raw, 'NBA')[0].noVig, null, 'Different exact opposing lines never form a no-vig pair');
});

test('Qualifying estimates retain a complete output shape and a moved line is reevaluated, not reused', () => {
  const result = evaluate();
  assert.equal(result.status, 'completed');
  const pick = result.picks[0];
  for (const key of ['projection', 'probability', 'pushProbability', 'implied', 'edge', 'ev', 'conservativeEV', 'quality', 'dataAt', 'modelVersion', 'facts', 'risks', 'samples']) assert.ok(key in pick);
  assert.equal(pick.sampleSize, 30);
  assert.ok(pick.ev > 0 && pick.conservativeEV > 0);
  assert.equal(evaluate([{ ...quote, line: 35.5 }]).picks.length, 0);
  assert.equal(evaluate([{ ...quote, american: -1000 }]).picks.length, 0);
});

test('The engine abstains for missing, stale, future, incomplete, unverified and early-season data', () => {
  for (const change of [
    { eligible: false }, { quality: 0.4 }, { samples: [] }, { samples: evidence.samples.slice(0, 11) },
    { fetchedAt: new Date(now - 3_600_001).toISOString() }, { fetchedAt: 'invalid' },
    { samples: [{ date: new Date(now + 1).toISOString(), value: 30 }, ...evidence.samples] },
  ]) assert.equal(evaluate([quote], { ...evidence, ...change }).picks.length, 0);
  assert.equal(evaluate([{ ...quote, updatedAt: new Date(now - 600_001).toISOString() }]).status, 'stale_odds');
  assert.equal(evaluate([{ ...quote, start: new Date(now).toISOString() }]).picks.length, 0);
  assert.equal(evaluate([{ ...quote, noVig: null }]).picks.length, 0);
  const allPushes = { ...evidence, samples: evidence.samples.map((row) => ({ ...row, value: 20 })) };
  assert.equal(evaluate([{ ...quote, line: 20 }], allPushes).picks.length, 0, 'Floating-point push mass never exceeds one or claims positive EV');
});

test('Settings affect actual selection, minimum quality, recent weighting and direction', () => {
  assert.equal(evaluate([quote], evidence, { ...settings, direction: 'under' }).picks.length, 0);
  assert.equal(evaluate([quote], evidence, { ...settings, player: 'Another player' }).picks.length, 0);
  assert.equal(evaluate([quote], evidence, { ...settings, minQuality: 0.9 }).picks.length, 0);
  assert.equal(evaluate([{ ...quote, american: 100 }], evidence, { ...settings, minEV: 1 }).picks.length, 0);
  assert.notEqual(evaluate([quote], evidence, { ...settings, recentWeight: 0 }).picks[0].probability,
    evaluate([quote], evidence, { ...settings, recentWeight: 0.6 }).picks[0].probability);
  assert.throws(() => engine.readSettings({ ...settings, markets: ['invented'] }, 'NBA'));
  assert.throws(() => engine.readSettings({ ...settings, markets: ['h2h', 'h2h'] }, 'NBA'));
  assert.throws(() => engine.readSettings({ ...settings, minQuality: 0.1 }, 'NBA'));
});

test('Duplicate player markets and team markets are controlled without forcing four picks', () => {
  const quotes = [quote, { ...quote, key: 'same-player-rebounds', market: 'player_rebounds', line: 3.5 },
    { ...quote, key: 'different-player', subject: 'Another player' }];
  const result = evaluate(quotes);
  assert.equal(result.picks.length, 2);
  assert.equal(new Set(result.picks.map((pick) => pick.subject)).size, 2);
  assert.ok(result.rejected.some((row) => row.reason.includes('correlated')));
  const teamQuotes = ['Boston Celtics', 'Atlanta Hawks'].map((team) => ({ ...quote, key: team, subject: team, side: team, market: 'h2h', line: null }));
  assert.equal(evaluate(teamQuotes).picks.length, 1);
  const many = Array.from({ length: 12 }, (_, i) => ({ ...quote, key: `player-${i}`, subject: `Player ${i}` }));
  const data = new Map(many.map((q) => [q.key, evidence]));
  assert.equal(engine.evaluate(many, data, settings, now, 8).picks.length, 8);
  assert.equal(engine.evaluate(many, data, settings, now).picks.length, 4);
  assert.equal(engine.evaluate(many, new Map(many.map((q) => [q.key, { ...evidence, samples: [] }])), settings, now, 8).picks.length, 0);
});

test('GamewAIre grade is a bounded transparent rubric, not a probability', () => {
  assert.deepEqual(engine.gamewaireGrade({ conservativeEV: 0.15, edge: 0.15, ev: 0.25, quality: 1 }), { score: 100, letter: 'A' });
  assert.deepEqual(engine.gamewaireGrade({ conservativeEV: 0, edge: 0, ev: 0, quality: 0 }), { score: 0, letter: 'D' });
  assert.equal(engine.gamewaireGrade({ conservativeEV: 10, edge: 10, ev: 10, quality: 1 }).score, 100);
  const low = { conservativeEV: 0.01, edge: 0.03, ev: 0.05, quality: 0.8 };
  assert.ok(engine.gamewaireGrade({ ...low, conservativeEV: 0.1 }).score > engine.gamewaireGrade(low).score);
});

test('Probability grades use exact agreed thresholds, independently of value and odds', () => {
  for (const [probability, expected] of [
    [0, 'C'], [0.499999, 'C'], [0.50, 'B-'], [0.549999, 'B-'],
    [0.55, 'B'], [0.649999, 'B'], [0.65, 'B+'], [0.699999, 'B+'],
    [0.70, 'A-'], [0.749999, 'A-'], [0.75, 'A'], [1, 'A'],
  ]) assert.equal(engine.probabilityGrade(probability), expected);
  for (const probability of [NaN, Infinity, -0.01, 1.01]) assert.throws(() => engine.probabilityGrade(probability), /Invalid win probability/);
});

test('Conversational blurbs use only saved player or team evidence without invented matchup context', () => {
  const pick = { ...evaluate().picks[0], subject: 'Cade Cunningham', market: 'player_assists', side: 'Under',
    line: 7.5, projection: 4.2, seasonAverage: 5.1, rotation: { label: 'Core rotation', minutes: 32, involvement: 18 } };
  const blurb = engine.pickBlurb(pick);
  assert.match(blurb, /Cade Cunningham averages 5\.1 assists/);
  assert.match(blurb, /32\.0 minutes/);
  assert.match(blurb, /under 7\.5 assists a statistical case/);
  assert.match(blurb, /under 7\.5 assists/);
  assert.doesNotMatch(blurb, /unbeaten|LeBron|home court|injur|lock to|guaranteed/i);
  const team = engine.pickBlurb({ ...pick, market: 'spreads', side: 'Boston Celtics', subject: 'Boston Celtics', line: 4.5 });
  assert.match(team, /Boston Celtics \+4\.5 a statistical case/);
  assert.doesNotMatch(team, /minutes per game|averaging.*assists/);
});

test('Every analyzed game gets a supported team lean, with failed value screens excluded from Top Picks', () => {
  const team = { ...quote, key: 'team', market: 'h2h', subject: 'Boston Celtics', side: 'Boston Celtics', line: null, american: -10000 };
  const data = new Map([[team.key, evidence]]);
  const failed = engine.evaluate([team], data, settings, now, 8);
  assert.ok(failed.teamLean);
  assert.equal(failed.teamLean.qualifies, false);
  assert.equal(failed.picks.length, 0);
  assert.match(failed.teamLean.reason, /Not a Top Pick/);
  for (const change of [{ eligible: false }, { samples: [] }, { quality: 0.1 }]) {
    assert.equal(engine.evaluate([team], new Map([[team.key, { ...evidence, ...change }]]), settings, now).teamLean, undefined);
  }
  assert.equal(engine.evaluate([{ ...team, updatedAt: new Date(now - 600001).toISOString() }], data, settings, now).teamLean, undefined);
  const qualified = { ...team, american: 150 };
  const players = Array.from({ length: 10 }, (_, i) => ({ ...quote, key: `p-${i}`, subject: `P ${i}`, american: 300 }));
  const all = [...players, qualified];
  const full = engine.evaluate(all, new Map(all.map(q => [q.key, evidence])), settings, now, 8);
  assert.equal(full.teamLean.qualifies, true);
  assert.equal(full.picks.length, 8);
  assert.equal(full.picks.filter(p => p.market === 'h2h').length, 1, 'Reserve a team candidate even when props fill the pool');
  assert.ok(!full.rejected.some(row => row.key === qualified.key), 'A reserved team candidate must not also be described as rejected');
});
test('Conversational team blurbs use recorded form without revealing the formula or mixing seasons', () => {
  const base = { ...evaluate().picks[0], market: 'h2h', subject: 'Los Angeles Lakers', line: null, seasonAverage: 13,
    projection: 5.2, probability: 0.69, baseline: '50/50', samples: [
      { season: 2027, date: '2026-10-26', value: 30, opponent: 'Utah Jazz' },
      { season: 2027, date: '2026-10-24', value: -4, opponent: 'Boston Celtics' },
      { season: 2026, date: '2026-04-10', value: -50, opponent: 'Old opponent' },
    ] };
  const ml = engine.pickBlurb(base);
  assert.match(ml, /Los Angeles Lakers are 1-1 across 2 recorded games this season/);
  assert.match(ml, /outscored opponents by 13\.0 points per game/);
  assert.match(ml, /won by 30 vs\. Utah Jazz; lost by 4 vs\. Boston Celtics/);
  assert.match(ml, /Lakers moneyline a statistical case/);
  assert.doesNotMatch(ml, /Old opponent|scoring margin|weight|50\/50|model|projection|5\.2|69\.0|LowVig|guaranteed win/i);
  const negative = engine.pickBlurb({ ...base, seasonAverage: -3.2, projection: -2 });
  assert.match(negative, /been outscored by 3\.2 points/);
  assert.match(negative, /does not favor this side/);
  for (const line of [4.5, -4, 0]) {
    const spread = engine.pickBlurb({ ...base, market: 'spreads', line });
    assert.ok(spread.includes(`Los Angeles Lakers ${line > 0 ? '+' : ''}${line}`));
    assert.doesNotMatch(spread, /they need to|push \(stake returned\)|model|50\/50/i);
  }
});
test('All prop units and totals use relevant statistics and honest trends rather than betting lessons', () => {
  const base = { ...evaluate().picks[0], side: 'Over', line: 7.5, projection: 6, seasonAverage: 6,
    samples: [9, 7, 2].map((value, i) => ({ value, date: `2026-10-${26 - i}`, season: 2027 })) };
  for (const [market, unit] of Object.entries({ player_points: 'points', player_rebounds: 'rebounds',
    player_assists: 'assists', player_threes: 'made threes', player_pass_yds: 'passing yards',
    player_rush_yds: 'rushing yards', player_reception_yds: 'receiving yards', player_receptions: 'receptions' })) {
    const blurb = engine.pickBlurb({ ...base, market });
    assert.ok(blurb.includes(`over 7.5 ${unit}`));
    assert.ok(blurb.includes(`last 3 outings produced 9, 7, 2 ${unit}`));
    assert.match(blurb, /1 of those 3 outings cleared the 7\.5 line/);
    assert.match(blurb, /season average leans the other way/);
    assert.doesNotMatch(blurb, /needs|push \(stake returned\)|model|weight|Estimated chance/i);
    const under = engine.pickBlurb({ ...base, market, side: 'Under', line: 7 });
    assert.ok(under.includes(`under 7 ${unit}`));
    assert.match(under, /1 of those 3 outings stayed below the 7 line/);
  }
  const total = engine.pickBlurb({ ...base, market: 'totals', line: 220.5, projection: 225 });
  assert.match(total, /over 220\.5 combined points/);
  assert.match(total, /separate past games, not a head-to-head average/);
  assert.doesNotMatch(total, /they went|point win|minutes per game|scoring margin/);
  const equal = engine.pickBlurb({ ...base, market: 'player_points', seasonAverage: 7.5 });
  assert.match(equal, /season average sits on the line/);
  const historical = engine.pickBlurb({ ...base, market: 'player_points', previousSeasonAverage: 12.3, baseline: '50/50' });
  assert.match(historical, /averaged 12\.3 points in the available prior-season games/);
  assert.doesNotMatch(historical, /50\/50|weight|algorithm|model/i);
});
const defenseFixture = (sport = 'NBA', season = 2027) => ({ season: { year: season }, children: [{ standings: {
  entries: Array.from({ length: sport === 'NBA' ? 30 : 32 }, (_, i) => ({
    team: { displayName: i === 0 ? quote.home : i === 1 ? quote.away : `Team ${i}` },
    stats: [{ name: 'wins', value: 2 }, { name: 'losses', value: 1 }, { name: 'ties', value: 0 },
      { name: 'pointsAgainst', value: i < 2 ? 300 : 300 + i * 3 }, { name: 'pointsFor', value: 330 }],
  })),
} }] });
test('Defensive context ranks actual points allowed per game across a complete same-season league', () => {
  for (const sport of ['NBA', 'NFL']) {
    const raw = defenseFixture(sport);
    const result = sources.defensiveStandings(raw, sport, 2027, new Date(now).toISOString());
    const team = result.get(engine.normalize(quote.away));
    assert.equal(team.rank, 1);
    assert.equal(team.tied, true);
    assert.equal(team.pointsAllowed, 100);
    assert.equal(team.pointsScored, 110);
    assert.equal(team.games, 3);
    assert.equal(result.get('team2').rank, 3);
    assert.equal(team.leagueSize, sport === 'NBA' ? 30 : 32);
    raw.children[0].standings.entries.pop();
    assert.throws(() => sources.defensiveStandings(raw, sport, 2027, ''), /requires all/);
    assert.throws(() => sources.defensiveStandings(defenseFixture(sport), sport, 2026, ''), /wrong season/);
  }
  const nfl = defenseFixture('NFL');
  nfl.children[0].standings.entries[0].stats.find((row) => row.name === 'ties').value = 1;
  assert.equal(sources.defensiveStandings(nfl, 'NFL', 2027, '').get(engine.normalize(quote.home)).pointsAllowed, 75);
});
test('Opponent context is persisted without changing the picks, probability, projection or value screens', () => {
  const opponents = [...sources.defensiveStandings(defenseFixture(), 'NBA', 2027, quote.updatedAt).values()].slice(1, 2);
  const original = evaluate();
  const enriched = evaluate([quote], { ...evidence, opponents });
  assert.deepEqual(enriched.picks[0].opponents, opponents);
  for (const field of ['probability', 'projection', 'ev', 'conservativeEV', 'quality', 'edge']) {
    assert.equal(enriched.picks[0][field], original.picks[0][field]);
  }
  const blurb = engine.pickBlurb(enriched.picks[0]);
  assert.match(blurb, /Atlanta Hawks have allowed 100\.0 points per game, tied for No\. 1 of 30/);
  assert.match(blurb, /not a ranking against this position or stat/);
  assert.match(blurb, /early-season ranking can move quickly/);
  assert.doesNotMatch(blurb, /50\/50|weight|efficiency rating|defense boosts|algorithm/i);
  assert.doesNotMatch(engine.pickBlurb(original.picks[0]), /No\. \d|points allowed per game/);
});
test('Matchup history uses verified opponent matches only and never counts prior-season logs as current form', () => {
  const opponent = { team: quote.away, games: 20, pointsAllowed: 110, pointsScored: 115, rank: 12, tied: false, leagueSize: 30, season: 2027, fetchedAt: quote.updatedAt };
  const pick = { ...evaluate().picks[0], opponents: [opponent], samples: [
    { date: '2026-10-25', season: 2027, value: 20, opponent: quote.away },
    { date: '2026-10-24', season: 2027, value: 10, opponent: 'Other Team' },
    { date: '2026-04-01', season: 2026, value: 99, opponent: quote.away },
  ] };
  assert.match(engine.pickBlurb(pick), /1 recorded current-season meeting with Atlanta Hawks, Player averaged 20\.0 points/);
  assert.doesNotMatch(engine.pickBlurb(pick), /99|early-season ranking/);
  assert.doesNotMatch(engine.pickBlurb({ ...pick, samples: pick.samples.slice(1) }), /recorded current-season meeting/);
});

test('Top Picks rank by probability bands before value, moneyline preference and verified player usage', () => {
  const base = evaluate().picks[0];
  const candidate = (key, probability, extra = {}) => ({ ...base, key, probability, ...extra });
  const picks = [
    candidate('famous-lower-band', 0.709, { rotation: { label: 'Core rotation', minutes: 38, involvement: 35 } }),
    candidate('high-usage', 0.731, { rotation: { label: 'Core rotation', minutes: 34, involvement: 24 } }),
    candidate('moneyline', 0.730, { market: 'h2h', line: null }),
    candidate('highest', 0.81, { conservativeEV: 0.001, ev: 0.06 }),
    candidate('lower-usage', 0.739, { rotation: { label: 'Core rotation', minutes: 32, involvement: 14 } }),
  ];
  assert.deepEqual(engine.rankTopPicks(picks).map((pick) => pick.key),
    ['highest', 'moneyline', 'high-usage', 'lower-usage', 'famous-lower-band']);
  assert.equal(picks[0].key, 'famous-lower-band', 'Ranking does not mutate saved reports');
  for (const a of picks) for (const b of picks) {
    const forward = engine.rankTopPicks([a, b]), backward = engine.rankTopPicks([b, a]);
    if (a.key !== b.key) assert.equal(forward[0].key, backward[0].key, 'Tie rules are deterministic');
  }
  const q = [{ ...quote, key: 'high-probability', subject: 'Primary', american: 100 },
    { ...quote, key: 'high-payout', subject: 'Secondary', american: 300 }];
  const data = new Map([
    [q[0].key, evidence],
    [q[1].key, { ...evidence, samples: evidence.samples.map((row, i) => ({ ...row, value: i < 21 ? 30 : 10 })) }],
  ]);
  const result = engine.evaluate(q, data, settings, now, 8);
  assert.equal(result.picks.length, 2);
  assert.equal(result.picks[0].key, 'high-probability', 'Generation selects highest hit probability, not highest payout/EV');
  assert.ok(result.picks[0].conservativeEV < result.picks[1].conservativeEV);
  const ml = { ...quote, key: 'unqualified-ml', market: 'h2h', side: 'Boston Celtics', line: null, american: -10000 };
  assert.equal(engine.evaluate([ml], new Map([[ml.key, evidence]]), { ...settings, markets: ['h2h'] }, now).picks.length, 0,
    'Moneyline focus never bypasses value thresholds');
});

test('NBA rotation pool keeps five high-minute players per team and verified high-usage reserves only', () => {
  const player = (name, minutes, involvement, teamId = 'home') => ({ name, teamId,
    samples: Array.from({ length: 3 }, () => ({ date: quote.updatedAt, value: 10, minutes, offensiveInvolvement: involvement })) });
  const players = [player('A', 36, 20), player('B', 34, 18), player('C', 33, 17), player('D', 30, undefined), player('E', 28, 8),
    player('Bench scorer', 22, 14), player('Limited reserve', 20, 6), player('Small cameo', 17.9, 20),
    player('Unknown bench usage', 19, undefined), player('Away starter', 32, 8, 'away')];
  const pool = sources.nbaRotationPool(players);
  assert.equal(pool.size, 7);
  assert.equal(pool.get('A').label, 'Core rotation');
  assert.equal(pool.get('D').label, 'Core rotation', 'Core-minute players need not invent missing usage data');
  assert.equal(pool.get('Bench scorer').label, 'High-usage rotation');
  assert.equal(pool.get('Away starter').label, 'Core rotation', 'Each team gets its own five-player ranking');
  assert.equal(pool.has('Limited reserve'), false);
  assert.equal(pool.has('Small cameo'), false);
  assert.equal(pool.has('Unknown bench usage'), false);
  assert.equal(sources.nbaRotationPool([player('At threshold', 18, 12)]).get('At threshold').label, 'High-usage rotation');
  assert.equal(sources.nbaRotationPool([player('No minutes', undefined, 20)]).size, 0);
  assert.equal(sources.nbaRotationPool([{ name: 'No history', teamId: 'home', samples: [] }]).size, 0);
});

test('NBA early season uses exactly half of each real cohort and switches off at twelve games', () => {
  const current = evidence.samples.slice(0, 3).map((row) => ({ ...row, value: 40 }));
  const previous = Array.from({ length: 82 }, (_, i) => ({ date: new Date(now - (200 + i) * 86_400_000).toISOString(), value: 20 }));
  const samples = sources.nbaSeasonBlend(current, previous, 2027);
  assert.equal(samples.length, 85);
  const mass = (season) => samples.filter((row) => row.season === season).reduce((sum, row) => sum + row.weight, 0);
  assert.ok(Math.abs(mass(2027) - 0.5) < 1e-10);
  assert.ok(Math.abs(mass(2026) - 0.5) < 1e-10);
  const data = { ...evidence, samples, currentSeason: 2027 };
  const blendedQuote = { ...quote, line: 15.5 };
  const pick = evaluate([blendedQuote], data).picks[0];
  assert.ok(pick);
  assert.ok(Math.abs(pick.projection - 30) < 1e-10, 'Projection equals 50% current mean plus 50% previous full-season mean');
  assert.equal(pick.seasonAverage, 40);
  assert.equal(pick.previousSeasonAverage, 20);
  assert.ok(pick.effectiveSample < 12, 'Three current games do not become 85 equal-weight observations');
  assert.match(pick.baseline, /50\/50/);
  assert.equal(evaluate([blendedQuote], data, { ...settings, recentWeight: 0 }).picks[0].projection, pick.projection);
  const eleven = sources.nbaSeasonBlend(evidence.samples.slice(0, 11), previous, 2027);
  assert.equal(eleven.filter((row) => row.season === 2026).length, 82);
  const twelve = sources.nbaSeasonBlend(evidence.samples.slice(0, 12), previous, 2027);
  assert.equal(twelve.length, 12);
  assert.ok(twelve.every((row) => row.weight === undefined && row.season === 2027));
  assert.deepEqual(sources.nbaSeasonBlend([], previous, 2027), []);
  assert.deepEqual(sources.nbaSeasonBlend(current, previous.slice(0, 11), 2027), []);
  assert.equal(evaluate([{ ...quote, sport: 'NFL' }], data).picks.length, 0, 'NBA cohort weighting cannot apply to NFL');
  assert.equal(evaluate([quote], { ...data, samples: samples.map((row) => ({ ...row, weight: 1 })) }).picks.length, 0);
  assert.equal(evaluate([quote], { ...data, samples: [{ ...samples[0], date: new Date(now + 1).toISOString() }, ...samples.slice(1)] }).picks.length, 0);
});

test('Early-season NBA totals and player minutes use real previous-season evidence with equal cohort weights', async () => {
  const matchup = { eventId: 'espn-event', season: 2027, home: { id: '1', name: quote.home }, away: { id: '2', name: quote.away } };
  const fetcher = async (url) => {
    const parsed = new URL(url), year = Number(parsed.searchParams.get('season')), n = year === 2027 ? 3 : 82;
    if (parsed.pathname.endsWith('/standings')) return Response.json(defenseFixture());
    if (parsed.pathname.endsWith('/schedule')) return Response.json({ events: Array.from({ length: n }, (_, i) => ({
      id: `${year}-${i}`, date: new Date(now - (year === 2027 ? i + 1 : 200 + i) * 86_400_000).toISOString(), seasonType: { type: 2 },
      competitions: [{ status: { type: { completed: true } }, competitors: [
        { team: { id: '1', displayName: quote.home }, score: year === 2027 ? 120 : 100 },
        { team: { id: '2', displayName: quote.away }, score: 90 },
      ] }],
    })) });
    if (parsed.pathname.endsWith('/roster')) return Response.json({ athletes: parsed.pathname.includes('/teams/1/') ? [
      { id: 'player', displayName: 'Player', status: { type: 'active' }, injuries: [] },
    ] : [] });
    if (parsed.pathname.endsWith('/gamelog')) {
      const rows = Array.from({ length: n }, (_, i) => ({ eventId: `${year}-${i}`, stats: [year === 2027 ? '40' : '20', '30'] }));
      return Response.json({ names: ['points', 'minutes'], events: Object.fromEntries(rows.map((row, i) => [row.eventId, {
        gameDate: new Date(now - (year === 2027 ? i + 1 : 200 + i) * 86_400_000).toISOString(),
      }])), seasonTypes: [{ type: 2, categories: [{ events: rows }] }] });
    }
    throw new Error('Unexpected public request');
  };
  const total = { ...quote, key: 'total', market: 'totals', side: 'Over', line: 180.5 };
  const data = await sources.collectEvidence([total, quote], matchup, now, fetcher);
  for (const q of [total, quote]) {
    const item = data.evidence.get(q.key);
    assert.equal(item.samples.length, 85, 'Shared team totals are deduplicated without losing probability mass');
    assert.equal(item.eligible, true);
    assert.ok(Math.abs(item.samples.filter((row) => row.season === 2027).reduce((sum, row) => sum + row.weight, 0) - 0.5) < 1e-10);
    assert.ok(Math.abs(item.samples.filter((row) => row.season === 2026).reduce((sum, row) => sum + row.weight, 0) - 0.5) < 1e-10);
  }
  assert.ok(engine.evaluate([{ ...quote, line: 15.5 }], data.evidence, settings, now).picks[0], 'Three valid current games with minutes can use the prior-season baseline');
  assert.equal(data.evidence.get(quote.key).rotation.label, 'Core rotation');
  assert.equal(data.evidence.get(quote.key).opponents[0].team, quote.away, 'A home player gets the away defense');
  assert.equal(data.evidence.get(total.key).opponents.length, 2, 'Totals get both defenses');
  for (const [minutes, attempts, expected] of [['20', '5', false], ['20', '12', true], ['17', '20', false]]) {
    const calls = [];
    const tested = await sources.collectEvidence([quote], matchup, now, async (url) => {
      calls.push(String(url));
      const response = await fetcher(url);
      if (!String(url).includes('/gamelog')) return response;
      const body = await response.json();
      body.names.push('fieldGoalsMade-fieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted', 'turnovers');
      for (const type of body.seasonTypes) for (const category of type.categories) for (const row of category.events) {
        row.stats[1] = minutes; row.stats.push(`3-${attempts}`, '0-0', '0');
      }
      return Response.json(body);
    });
    const item = tested.evidence.get(quote.key);
    assert.equal(item.eligible, expected);
    if (expected) assert.equal(item.rotation.label, 'High-usage rotation');
    else {
      assert.match(item.reason, /Outside the core/);
      assert.equal(calls.some((url) => url.includes('/gamelog?season=2026')), false, 'Do not download prior logs for ineligible reserves');
    }
  }
});

test('Adjusted team forecasts retain real observed averages and valid point/push outcomes', () => {
  const team = { ...quote, market: 'spreads', side: 'Boston Celtics', line: -28.5 };
  const pick = evaluate([team], { ...evidence, adjustment: -1.5 }, { ...settings, markets: ['spreads'] }).picks[0];
  assert.ok(pick);
  assert.equal(pick.pushProbability, 0, 'Half-point spreads cannot push after a fractional opponent adjustment');
  assert.equal(pick.last5, 30, 'Historical averages remain actual, unadjusted observations');
  assert.equal(pick.seasonAverage, 28);
  const moneyline = { ...team, market: 'h2h', line: null };
  const tied = { ...evidence, samples: evidence.samples.map((row, i) => ({ ...row, value: i < 27 ? 30 : 0 })) };
  assert.equal(evaluate([moneyline], tied).picks[0].pushProbability, 0, 'NBA moneylines do not return a modeled tie as a push');
});

test('Performance includes losses, pushes, withdrawals, real prices, calibration and closing price value', () => {
  const rows = [
    { probability: 0.6, pushProbability: 0, american: 150, result: 'win', closingAmerican: 100 },
    { probability: 0.6, pushProbability: 0, american: -200, result: 'loss', withdrawn: true },
    { probability: 0.5, pushProbability: 0.1, american: -110, result: 'push' },
    { probability: 0.5, pushProbability: 0, american: 100, result: 'pending' },
  ];
  const result = engine.performance(rows);
  assert.equal(result.total, 4); assert.equal(result.settled, 3); assert.equal(result.profit, 0.5);
  assert.equal(result.roi, 0.5 / 3); assert.equal(result.winRate, 0.5); assert.equal(result.withdrawn, 1);
  assert.ok(Math.abs(result.brier - 0.26) < 1e-10); assert.equal(result.closingPriceValue, 0.25);
  assert.equal(engine.performance([]).roi, null);
  const groups = engine.performanceGroups(rows.map((row) => ({ ...row, sport: 'NBA', market: 'player_points', edge: 0.05, createdAt: quote.updatedAt })));
  assert.equal(groups.sport[0].total, 4);
  assert.equal(groups.price.length, 2);
});

test('Historical replay is separate and rejects future odds, observations and post-cutoff data snapshots', () => {
  const item = { quote, evidence, asOf: new Date(now).toISOString(), outcome: 'loss' };
  const result = engine.replayBacktest([item], settings);
  assert.equal(result.total, 1); assert.equal(result.profit, -1); assert.match(result.label, /simulation/);
  assert.equal(result.benchmarks.market.total, 1);
  assert.equal(engine.replayBacktest([item, item], settings).total, 1, 'A repeated archived quote does not create multiple simulated wagers');
  assert.throws(() => engine.replayBacktest([item, { ...item, outcome: 'win' }], settings), /conflicting outcomes/);
  assert.throws(() => engine.replayBacktest([{ ...item, outcome: 'invented' }], settings), /valid settled outcome/);
  for (const change of [
    { quote: { ...quote, updatedAt: new Date(now + 1).toISOString() } },
    { evidence: { ...evidence, fetchedAt: new Date(now + 1).toISOString() } },
    { evidence: { ...evidence, samples: [{ date: new Date(now).toISOString(), value: 30 }] } },
  ]) assert.throws(() => engine.replayBacktest([{ ...item, ...change }], settings), /future information/);
});

test('Sports adapters preserve real zero, made-attempted threes, minutes, completed regular-season games and cutoff', () => {
  const value = { names: ['points', 'minutes', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'], events: {
    one: { gameDate: '2026-10-26T20:00:00Z' }, future: { gameDate: '2026-10-28T20:00:00Z' },
  }, seasonTypes: [{ displayName: '2026-27 Regular Season', categories: [{ events: [
    { eventId: 'one', stats: ['0', '32:30', '2-7'] }, { eventId: 'future', stats: ['90', '48', '10-10'] },
  ] }] }] };
  assert.equal(sources.playerSamples(value, 'player_points', now)[0].value, 0);
  assert.equal(sources.playerSamples(value, 'player_threes', now)[0].value, 2);
  assert.equal(sources.playerSamples(value, 'player_points', now)[0].minutes, 32.5);
  assert.equal(sources.playerSamples(value, 'player_points', now).length, 1);
  assert.throws(() => sources.playerSamples(value, 'player_assists', now), /does not report/);
  const teams = sources.teamSamples({ events: [{ date: '2026-10-26T20:00:00Z', seasonType: { type: 2 }, competitions: [{
    status: { type: { completed: true } }, competitors: [{ team: { id: '1' }, score: { value: 100 } }, { team: { id: '2' }, score: { value: 90 } }],
  }] }] }, '1', now);
  assert.equal(teams[0].margin, 10); assert.equal(teams[0].total, 190);
});

test('Evidence deduplicates shared event IDs, not coincidental same-date scores, and rejects inactive injuries', async () => {
  const matchup = { eventId: 'espn-event', season: 2027, home: { id: '1', name: quote.home }, away: { id: '2', name: quote.away } };
  const fetcher = async (url) => {
    const id = String(url).match(/teams\/(\d+)/)?.[1];
    if (String(url).includes('/schedule')) return Response.json({ events: Array.from({ length: 12 }, (_, i) => ({
      id: i === 0 ? 'shared' : `${id}-${i}`, date: new Date(now - (i + 1) * 86_400_000).toISOString(), seasonType: { type: 2 },
      competitions: [{ status: { type: { completed: true } }, competitors: [
        { team: { id, displayName: id === '1' ? quote.home : quote.away }, score: 100 },
        { team: { id: id === '1' ? '2' : '1', displayName: 'Opponent' }, score: 90 },
      ] }],
    })) });
    if (String(url).includes('/roster')) return Response.json({ athletes: id === '1' ? [
      { id: 'player', displayName: 'Player', status: { type: 'active' }, injuries: [{ status: 'Inactive' }] },
    ] : [] });
    throw new Error('Inactive players must not trigger game-log retrieval');
  };
  const total = { ...quote, key: 'total', market: 'totals', side: 'Over', line: 180.5 };
  const data = await sources.collectEvidence([total, quote], matchup, now, fetcher);
  assert.equal(data.evidence.get(total.key).samples.length, 23);
  assert.equal(data.evidence.get(quote.key).eligible, false);
  assert.ok(data.warnings.some((warning) => warning.includes('injury availability')));
});

test('Matchup resolution uses supported individual scoreboard dates and deduplicates boundary games', async () => {
  const requests = [];
  const matchup = await sources.resolveMatchup(quote, async (url) => {
    requests.push(String(url));
    const dates = new URL(url).searchParams.get('dates');
    assert.match(dates, /^\d{8}$/, 'NBA scoreboard does not support a multi-day range');
    return Response.json({ events: [{ id: 'espn-event', date: quote.start, season: { year: 2027 },
      competitions: [{ status: { type: { state: 'pre' } }, competitors: [
        { homeAway: 'home', team: { id: '2', displayName: quote.home } },
        { homeAway: 'away', team: { id: '17', displayName: quote.away } },
      ] }] }] });
  });
  assert.equal(requests.length, 2);
  assert.equal(matchup.eventId, 'espn-event');
});

test('GamewAIre navigation is ordered correctly and AI styling is bold red without loading the engine at startup', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const nav = source.slice(source.indexOf('<PrimaryNavigation>'), source.indexOf('</PrimaryNavigation>'));
  assert.ok(nav.indexOf("setView('Analyst')") < nav.indexOf("setView('Gamewaire')"));
  assert.doesNotMatch(nav, /setView\('LiveWire'\)/);
  assert.match(nav, /Gamew<strong>AI<\/strong>re/);
  assert.match(source, /lazy\(\(\) => import\('\.\/Gamewaire'\)\)/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.gamewaire-name strong \{ color: #ff5965; font-weight: 900;/);
});

test('GamewAIre renders provider setup, real reports and complete metrics without fabricated empty-state picks', async () => {
  const raw = readFileSync(new URL('../src/Gamewaire.tsx', import.meta.url), 'utf8');
  const component = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/import ['"]\.\/gamewaire\.css['"];/, '')
    .replace(/import \{ useEffect, useState \} from ['"]react['"];/, `let slot = 0, states = []; export const fixture = (values) => { states=values; slot=0; }; const useEffect=()=>{}; const useState=(initial)=>[slot in states?states[slot++]:((slot++),typeof initial==='function'?initial():initial),()=>{}];`)
    .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
    .replace(/import \{[^;]+\} from ['"]\.\/services\/gamewaire['"];/, `import { defaultSettings, markets, modelVersion, performance, performanceGroups, gamewaireGrade, probabilityGrade, rankTopPicks, pickBlurb } from '${new URL('../supabase/functions/_shared/gamewaire.ts', import.meta.url)}'; const engineRequest=()=>{}; const loadEngineHistory=()=>{};`)
    .replace(/import \{ nbaCalendarDate \} from [^;]+;/, `const nbaCalendarDate=(date=new Date())=>date.toISOString().slice(0,10);`)
    .replace(/import \{ subscribeForegroundRefresh \} from [^;]+;/, 'const subscribeForegroundRefresh=()=>()=>{};');
  const { default: Page, fixture } = await import(`data:text/javascript;base64,${Buffer.from(component).toString('base64')}`);
  const status = { canAnalyze: true, oddsReady: false, aiReady: false, model: engine.modelVersion, experimental: true };
  fixture([status, [], [], true]);
  const empty = renderToStaticMarkup(createElement(Page));
  assert.doesNotMatch(empty, /Gamew<strong>AI<\/strong>re/, 'The App heading owns the single GamewAIre title');
  assert.match(empty, /ANALYSIS ENGINE/);
  assert.match(empty, /class="gai-dashboard"/);
  assert.match(empty, /aria-label="Game filters"/);
  assert.match(empty, /aria-label="Top Picks"/);
  assert.match(empty, /aria-label="How picks are ranked"/);
  assert.match(empty, /Sportsbook analysis is unavailable/);
  assert.match(empty, /No model analyses yet/);
  assert.doesNotMatch(empty, /class="gai-pick/);
  assert.match(empty, /disabled=""[^>]*>Load upcoming games/);
  const candidate = { ...evaluate().picks[0], baseline: 'Early-season 50/50 blend', previousSeasonAverage: 20,
    rotation: { label: 'Core rotation', minutes: 32, involvement: 18 } };
  const run = { id: 'run', sport: 'NBA', event_id: 'event', event_start: new Date().toISOString(), matchup: 'Away at Home', settings, created_at: quote.updatedAt, status: 'completed', payload: { picks: [candidate], warnings: [] } };
  const pick = { ...candidate, id: 'pick', event_start: quote.start, created_at: quote.updatedAt, push_probability: candidate.pushProbability,
    result: 'loss', data: candidate, closing_american: null, withdrawn: true, revision: 1 };
  const memberState = [{ ...status, canAnalyze: false, oddsReady: true }, [run], [pick], true];
  memberState[22] = [{ sport: 'NBA', event_id: 'event', event_start: quote.start, matchup: 'Away at Home', picks: [candidate], published_at: quote.updatedAt }];
  memberState[23] = 'event'; memberState[25] = quote.start.slice(0, 10);
  fixture(memberState);
  const report = renderToStaticMarkup(createElement(Page));
  assert.match(report, /class="gai-pick angle-card"/);
  assert.match(report, /Book A/);
  assert.match(report, /loss/);
  assert.match(report, /withdrawn/);
  assert.doesNotMatch(report, /Admin analysis controls/);
  assert.doesNotMatch(report, /Saved analysis reports|Choose up to four member picks/);
  assert.match(report, /Probability grade/);
  assert.doesNotMatch(report, /class="gai-evidence"|Value\/quality score \(not probability\)|class="gai-metrics gai-row-metrics"/, 'Members receive prose, not technical detail boxes');
  assert.match(report, /Brier score/);
  assert.match(report, /gai-grade-positive/);
  assert.match(report, /32\.0 minutes per game/);
  assert.match(report, /Recent playing time has averaged/);
  assert.match(report, /available prior-season games/);
  assert.match(report, /class="gai-pick-summary" aria-label="Why this pick:/);
  assert.ok(report.includes(`${candidate.subject} averages ${candidate.seasonAverage.toFixed(1)} points`));
  assert.match(report, /Small samples and changing roles can change the outlook/);
  assert.match(report, /<details class="gai-history">/);
  fixture([status, [run], [], true]);
  const admin = renderToStaticMarkup(createElement(Page));
  assert.match(admin, /Choose up to four member picks/);
  assert.match(admin, /Run analysis · up to 7 credits/);
  assert.match(admin, /reusing a fresh cached report costs 0 credits/);
  const costState = [status, [run], [], true];
  costState[10] = { ...settings, markets: ['player_points'] };
  fixture(costState);
  const propCost = renderToStaticMarkup(createElement(Page));
  assert.match(propCost, /Run analysis · up to 3 credits/, 'One prop market also requests moneyline and spread');
  costState[10] = { ...settings, markets: ['h2h', 'spreads'] };
  fixture(costState);
  assert.match(renderToStaticMarkup(createElement(Page)), /Run analysis · up to 2 credits/, 'Required team markets are not counted twice');
  assert.match(admin, /Publish 0\/4 picks/);
  assert.match(admin, /ODDS_API_KEY/);
  assert.match(admin, /<section class="gai-workspace">/);
  assert.doesNotMatch(admin, /class="feed-warning"[^>]*>This baseline/);
  assert.match(admin, /<summary>Data notes &amp; excluded markets/);
  assert.match(admin, /class="gai-evidence"><summary>Admin stats &amp; source observations/);
  const css = readFileSync(new URL('../src/gamewaire.css', import.meta.url), 'utf8');
  assert.match(css, /\.gai-grade-positive \{ color: #8bf0b3;/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.gai-dashboard \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /\.gai-hero-features b \{ display: none; \}/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 94px/);
  const pickSummary = admin.slice(admin.indexOf('<summary class="gai-pick-summary"'), admin.indexOf('</summary>', admin.indexOf('<summary class="gai-pick-summary"')));
  assert.doesNotMatch(pickSummary, /<input|<button/, 'The expandable pick is separate from the admin publication checkbox');
  assert.match(pickSummary, /gai-pick-identity gai-history-pick/, 'Top Picks share the results row identity styling');
  assert.match(pickSummary, /class="gai-history-price"><b>\+150<\/b><small>Book A<\/small>/);
  assert.match(pickSummary, /Probability grade/);
  assert.match(pickSummary, /aria-label="Rank 1"/);
  assert.match(pickSummary, /Atlanta Hawks @ Boston Celtics/);
  assert.doesNotMatch(pickSummary, /gai-rank|gai-metrics|Unvalidated estimate/, 'Closed rows stay compact; expanded content keeps the context and metrics');
  assert.match(admin, /class="gai-pick-context"/);
  assert.match(admin, /Moneyline \(game winner\)/);
  assert.match(admin, /Player props/);
  assert.match(admin, /Admin candidates · unpublished/);
  assert.equal((admin.match(/class="gai-pick angle-card"/g) ?? []).length, 1, 'Selection and evidence share one card, not duplicated rows');
  const scheduledRun = { ...run, event_start: new Date(Date.now() + 60_000).toISOString(),
    payload: { ...run.payload, scheduled: { jobId: 'job', selectionNote: 'Standings-ranked matchup.' },
      providerUsage: { requestCost: 7, creditsUsed: 21, creditsRemaining: 479, checkedAt: quote.updatedAt } } };
  const scheduledState = [status, [scheduledRun], [], true];
  scheduledState[7] = scheduledRun.event_start.slice(0, 10);
  scheduledState[28] = [{ id: 'batch', sport: 'NBA', game_date: scheduledRun.event_start.slice(0, 10), status: 'ready', note: 'Top three.', error: null }];
  scheduledState[29] = [{ id: 'job', batch_id: 'batch', matchup: 'Away at Home', event_start: scheduledRun.event_start, status: 'completed', run_id: 'run' }];
  fixture(scheduledState);
  const scheduledView = renderToStaticMarkup(createElement(Page));
  assert.match(scheduledView, /Scheduled shortlists/);
  assert.match(scheduledView, /Review saved report/);
  assert.match(scheduledView, /<section class="gai-scheduled" aria-label="Saved analyses">/);
  assert.match(scheduledView, /Open saved picks · 0 credits/);
  assert.match(scheduledView, /0 credits to view picks and explanations/);
  assert.match(scheduledView, /Overnight shortlist · Standings-ranked matchup/);
  assert.match(scheduledView, /Odds API: 7 credits for this saved request · 479 remaining/);
  assert.match(scheduledView, /Refresh prices &amp; review picks · up to 4 credits/);
  assert.match(scheduledView, /No NBA lean or Top Pick publishes automatically/);
  assert.match(scheduledView, /Publish game lean · 0 credits/);
  assert.match(scheduledView, /Refresh game lean only · up to 2 credits/);
  assert.match(scheduledView, /Analyze players &amp; full game · up to 7 credits/);
  const more = { ...candidate, key: 'top-probability', subject: 'Higher hit estimate', probability: 0.99 };
  const adminState = [status, [{ ...run, payload: { picks: [candidate, more] } }], [], true];
  fixture(adminState);
  const rankedAdmin = renderToStaticMarkup(createElement(Page));
  assert.ok(rankedAdmin.indexOf('Higher hit estimate') < rankedAdmin.indexOf('Player · Over'));
  const nflFilter = [...adminState]; nflFilter[6] = 'NFL';
  fixture(nflFilter);
  const wrongLeague = renderToStaticMarkup(createElement(Page));
  assert.doesNotMatch(wrongLeague, /class="gai-pick angle-card"/, 'Changing league never displays an unrelated saved NBA report');
  const archived = [...adminState]; archived[7] = '2025-01-01';
  fixture(archived);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Page)), /class="gai-pick angle-card"/, 'Report date follows the Eastern game date filter');
  fixture([status, [{ ...run, payload: { picks: [
    { ...candidate, key: 'spread', market: 'spreads', subject: 'Boston Celtics', side: 'Boston Celtics', line: 4.5 },
    { ...candidate, key: 'ml', market: 'h2h', subject: 'Denver Nuggets', side: 'Denver Nuggets', line: null },
  ] } }], [], true]);
  const teamMarkets = renderToStaticMarkup(createElement(Page));
  assert.match(teamMarkets, /<h3>Boston Celtics \+4\.5<\/h3>/);
  assert.match(teamMarkets, /aria-label="Select Boston Celtics \+4\.5"/);
  assert.match(teamMarkets, /<h3>Denver Nuggets ML<\/h3>/);
  assert.match(teamMarkets, /outscored opponents by/);
  assert.doesNotMatch(teamMarkets, /Unvalidated estimates, not betting value\. Probability-first; close ties/);
  for (const [market, label] of Object.entries({
    player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: 'Made threes',
    player_pass_yds: 'Passing yards', player_rush_yds: 'Rushing yards', player_reception_yds: 'Receiving yards', player_receptions: 'Receptions',
  })) {
    fixture([status, [{ ...run, payload: { picks: [{ ...candidate, market, subject: 'Cade Cunningham', line: 7.5, side: 'Over', probability: 0.65 }] } }], [], true]);
    const namedStat = renderToStaticMarkup(createElement(Page));
    assert.ok(namedStat.includes(`<h3>Cade Cunningham · Over 7.5 ${label}</h3>`));
    assert.match(namedStat, /gai-grade-positive">Probability grade B\+/);
  }
  fixture([status, [{ ...run, payload: { picks: [{ ...candidate, probability: 0.49 }] } }], [], true]);
  assert.match(renderToStaticMarkup(createElement(Page)), /gai-grade-neutral">Probability grade C/);
  fixture([status, [{ ...run, payload: { picks: [{
    ...candidate, side: 'Under', market: 'player_assists', line: 7.5, baseline: undefined, rotation: undefined,
    previousSeasonAverage: undefined, risks: [], projection: 4.2, last5: 4, last10: 4.5, seasonAverage: 5.1,
  }] } }], [], true]);
  const under = renderToStaticMarkup(createElement(Page));
  assert.match(under, /averages 5\.1 assists/);
  assert.match(under, /under 7\.5 assists a statistical case/);
  assert.doesNotMatch(under, /Core rotation|Previous full-season average:|Key limitation:/, 'Reasoning never invents rotation, baseline or risks missing from this pick');
  const navCSS = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(navCSS, /font-size: clamp\(9px, 2\.5vw, 11px\)/);
  assert.match(navCSS, /\.primary-nav button > span:last-child[^}]+min-height: 24px/);
  const leanState = memberState.slice();
  leanState[27] = [{ sport: 'NBA', event_id: 'lean-game', event_start: quote.start, matchup: 'Lean game', team_lean: {
    pick: { ...candidate, market: 'h2h', line: null }, qualifies: false, reason: 'Failed value checks. Not a Top Pick.',
  } }];
  leanState[23] = 'lean-game';
  fixture(leanState);
  const leanView = renderToStaticMarkup(createElement(Page));
  assert.match(leanView, /Lean only/);
  assert.match(leanView, /Failed value checks/);
  assert.match(leanView, /No published picks yet/);
  assert.equal((leanView.match(/class="gai-pick angle-card"/g) ?? []).length, 1, 'Selecting an unpublished lean game never shows another game\'s published picks');
  const nflCandidate = { ...candidate, key: 'nfl-pick', sport: 'NFL', subject: 'NFL Player', market: 'player_pass_yds', line: 250.5 };
  const nbaRecord = { ...pick, sport: 'NBA', event_start: quote.start };
  const nflRecord = { ...pick, id: 'nfl-record', sport: 'NFL', subject: 'NFL Player', market: 'player_pass_yds',
    event_start: quote.start, result: 'win', withdrawn: false, data: nflCandidate };
  const mixed = memberState.slice();
  mixed[2] = [nbaRecord, nflRecord];
  mixed[22] = [...memberState[22], { ...memberState[22][0], sport: 'NFL', event_id: 'nfl', picks: [nflCandidate] }];
  mixed[23] = ''; mixed[24] = 'all';
  fixture(mixed);
  const allSports = renderToStaticMarkup(createElement(Page));
  assert.match(allSports, /aria-label="Published sport"/);
  assert.match(allSports, /aria-pressed="true">All sports/);
  assert.match(allSports, /<h3>NFL Player · Over 250\.5 Passing yards<\/h3>/);
  assert.match(allSports, /class="gai-history-list" aria-label="Published pick history"/);
  assert.match(allSports, /gai-result-win">Won/);
  assert.match(allSports, /gai-result-loss">Lost/);
  assert.match(allSports, /not automatically settled/);
  assert.match(allSports, /More filters/);
  mixed[24] = 'NFL'; mixed[20] = 'NFL';
  fixture(mixed);
  const nflOnly = renderToStaticMarkup(createElement(Page));
  assert.equal((nflOnly.match(/class="gai-pick angle-card"/g) ?? []).length, 1);
  assert.equal((nflOnly.match(/class="gai-history-row"/g) ?? []).length, 1);
  assert.match(nflOnly, /Summary: all NFL history/);
  assert.match(nflOnly, /<dt>Win rate<\/dt><dd>100\.0%/);
  assert.doesNotMatch(nflOnly, /gai-result-loss">Lost/);
  mixed[21] = '2025-01-01';
  fixture(mixed);
  assert.match(renderToStaticMarkup(createElement(Page)), /No published picks match these filters/);
});

const endpointSource = readFileSync(new URL('../supabase/functions/gamewaire/index.ts', import.meta.url), 'utf8')
  .replace(/if \(import\.meta\.main\) Deno\.serve[^;]+;/, '');
const endpointCode = ts.transpileModule(endpointSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function endpoint({ role = 'admin', allowed = role === 'admin' || role === 'owner', configured = false, failClaim = false, publicationVersion = engine.modelVersion, eventCache = null, scheduledJob = null, cachedRun = null, lockBusy = false } = {}) {
  const rpc = [], tables = [], fetches = [], writes = [], env = { get: (name) => ({
    SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'public-fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    GAMEWIRE_CRON_SECRET: 'fixture-cron',
    ...(configured ? { ODDS_API_KEY: 'fixture-odds' } : {}),
  })[name] };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-fixture' } }, error: null }) },
    from(table) {
      tables.push(table);
      const builder = {
        select: (columns) => { builder.columns = columns; return builder; }, eq: () => builder, order: () => builder, limit: () => builder, lt: () => builder,
        update: (value) => { writes.push({ table, value }); return builder; }, insert: (value) => { builder.value = value; return builder; },
        upsert: () => builder,
        delete: () => builder,
        maybeSingle: async () => ({ data: table === 'livewire_roles' ? { role }
          : table === 'sports_resources' ? eventCache
          : table === 'gamewaire_runs' && builder.columns === 'payload' ? { payload: { modelVersion: publicationVersion } }
          : table === 'gamewaire_runs' ? cachedRun : null, error: null }),
        single: async () => ({ data: { ...builder.value, id: 'run-fixture' }, error: null }),
        then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return builder;
    },
    rpc: async (name, args) => {
      if (name === 'gamewaire_can_admin') return { data: allowed, error: null };
      rpc.push({ name, args }); return { data: name === 'gamewaire_claim' ? !failClaim
      : name === 'gamewaire_analysis_lock' ? lockBusy ? null : 'lock-fixture'
      : name === 'gamewaire_schedule_claim' ? scheduledJob : null, error: null }; },
  };
  const fetcher = async (url) => {
    fetches.push(String(url));
    return Response.json({ id: 'event', home_team: quote.home, away_team: quote.away, commence_time: quote.start,
      bookmakers: [{ key: 'book', title: 'Book', markets: [{ key: 'player_points', last_update: quote.updatedAt,
        outcomes: [{ name: 'Over', description: 'Player', point: 20.5, price: 150 }, { name: 'Under', description: 'Player', point: 20.5, price: -180 }] }] }] });
  };
  const context = vm.createContext({ exports: {}, Response, Request, URL, AbortSignal, Date: class extends Date { static now() { return now; } }, console,
    require(name) {
      if (name.startsWith('npm:')) return { createClient: () => client };
      if (name.includes('gamewaireSchedule')) return { ...schedule, planScheduledAnalyses: async () => {} };
      if (name.includes('gamewaireSources')) return { ...sources, resolveMatchup: async () => ({}), collectEvidence: async (quotes) => ({
        evidence: new Map(quotes.map((q) => [q.key, evidence])), warnings: [], coverage: {},
      }) };
      return engine;
    },
  });
  vm.runInContext(endpointCode, context);
  return { rpc, tables, fetches, writes,
    cron: (body = { action: 'scheduled' }, secret = 'fixture-cron', customFetcher = fetcher) => context.exports.handleGamewaire(new Request('https://test/engine', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gamewire-cron-secret': secret }, body: JSON.stringify(body),
    }), env, customFetcher),
    run: (body, auth = true, customFetcher = fetcher) => context.exports.handleGamewaire(new Request('https://test/engine', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer fixture' } : {}) }, body: JSON.stringify(body),
  }), env, customFetcher), exports: context.exports };
}
test('Endpoint requires authentication/admin access and honestly reports unconfigured providers', async () => {
  const api = endpoint();
  assert.equal((await api.run({ action: 'status' }, false)).status, 401);
  const status = await (await api.run({ action: 'status' })).json();
  assert.equal(status.oddsReady, false); assert.equal(status.aiReady, false);
  assert.equal((await api.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings })).status, 503);
  assert.equal(api.fetches.length, 0, 'No invented response or paid call without credentials');
  const member = endpoint({ role: 'member', configured: true });
  assert.equal((await member.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings })).status, 403);
  assert.equal(member.fetches.length, 0);
  assert.equal((await member.run({ action: 'publish', runId: '00000000-0000-0000-0000-000000000001', keys: [quote.key] })).status, 403);
});
test('Other admins and owners have member-only GamewAIre access with no paid requests or writes', async () => {
  for (const role of ['admin', 'owner', 'member']) {
    const api = endpoint({ role, allowed: false, configured: true });
    const status = await (await api.run({ action: 'status' })).json();
    assert.equal(status.canAnalyze, false);
    for (const action of ['events', 'report', 'analyze', 'publish', 'publishLean', 'settle']) {
      assert.equal((await api.run({ action })).status, 403, `${role}: ${action}`);
    }
    assert.equal(api.fetches.length, 0);
    assert.equal(api.writes.length, 0);
    assert.equal(api.rpc.length, 0);
  }
});
test('Opening even an old saved automatic analysis returns its original picks without provider calls or budget claims', async () => {
  const cachedRun = { id: '00000000-0000-0000-0000-000000000001', status: 'completed',
    event_start: '2025-01-01T00:00:00Z', payload: { scheduled: { jobId: 'old-job' }, picks: [{ key: 'saved-pick' }] } };
  const api = endpoint({ cachedRun, configured: false });
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await api.run({ action: 'report', runId: cachedRun.id });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).run, cachedRun);
  }
  assert.equal(api.fetches.length, 0, 'No Odds API or ESPN request to open saved picks');
  assert.equal(api.rpc.length, 0, 'No budget claim, paid analysis, or refresh');
  assert.equal(api.writes.length, 0);
});
test('Publication is admin-only, rejects invalid counts, and uses the transactional publication RPC', async () => {
  const api = endpoint();
  const runId = '00000000-0000-0000-0000-000000000001';
  for (const keys of [[], [quote.key, quote.key], [1], ['a', 'b', 'c', 'd', 'e']]) {
    assert.equal((await api.run({ action: 'publish', runId, keys })).status, 400);
  }
  assert.equal((await api.run({ action: 'publish', runId, keys: [quote.key] })).status, 200);
  assert.equal(api.rpc.at(-1).name, 'gamewaire_publish');
  assert.equal(api.rpc.at(-1).args.selected_keys[0], quote.key);
  assert.equal(api.fetches.length, 0, 'Publishing a prepared report never triggers a paid call');
  const legacy = endpoint({ publicationVersion: 'empirical-baseline-v2' });
  const result = await legacy.run({ action: 'publish', runId, keys: [quote.key] });
  assert.equal(result.status, 400);
  assert.match((await result.json()).error, /older model/);
  assert.equal(legacy.rpc.length, 0);
});
test('Endpoint rate limits before paid API calls and persists deterministic complete reports transactionally', async () => {
  const limited = endpoint({ configured: true, failClaim: true });
  const limitedResponse = await limited.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings });
  assert.equal(limitedResponse.status, 429);
  const limit = await limitedResponse.json();
  assert.equal(limit.retryAt, '2026-10-27T19:00:00.000Z');
  assert.match(limit.error, /Hourly analysis limit/);
  assert.match(limit.error, /Saved reports, published picks and game lists are still available/);
  assert.equal(limited.fetches.length, 0);
  const api = endpoint({ configured: true });
  const response = await api.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.run.status, 'completed');
  assert.equal(api.rpc.at(-1).name, 'gamewaire_finish');
  assert.ok(api.rpc.at(-1).args.candidates.length > 0);
  const requested = new URL(api.fetches[0]);
  assert.ok(requested.searchParams.get('markets').split(',').includes('h2h'));
  assert.ok(requested.searchParams.get('markets').split(',').includes('spreads'));
  assert.ok(body.run.payload.warnings.some((warning) => warning.includes('OPENAI_API_KEY')));
  const filtered = await endpoint({ configured: true }).run({ action: 'analyze', sport: 'NBA', eventId: 'event',
    settings: { ...settings, markets: ['player_points'], player: 'No matching player' } });
  assert.equal(filtered.status, 200);
  assert.equal((await filtered.json()).run.status, 'no_qualifying', 'An empty player filter is an abstention, not a provider failure');
});
test('Quota-free game lists remain available when the paid analysis budget is exhausted', async () => {
  const upcoming = { id: 'event', sport: 'NBA', home: quote.home, away: quote.away, start: quote.start };
  const cached = { payload: { events: [upcoming, { ...upcoming, id: 'started', start: new Date(now - 60_000).toISOString() }] },
    updated_at: new Date(now - 60_000).toISOString() };
  const api = endpoint({ configured: true, failClaim: true, eventCache: cached });
  const body = { action: 'events', sport: 'NBA', date: quote.start.slice(0, 10) };
  const response = await api.run(body);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).events, [upcoming]);
  assert.equal(api.rpc.length, 0);
  assert.equal(api.fetches.length, 0);
  const stale = endpoint({ configured: true, failClaim: true, eventCache: { ...cached, updated_at: new Date(now - 300_001).toISOString() } });
  let fetchCount = 0;
  const refreshed = await stale.run(body, true, async () => {
    fetchCount++;
    return Response.json([{ id: 'event', home_team: quote.home, away_team: quote.away, commence_time: quote.start }]);
  });
  assert.equal(refreshed.status, 200);
  assert.deepEqual((await refreshed.json()).events, [upcoming]);
  assert.equal(fetchCount, 1);
  assert.equal(stale.rpc.length, 0, 'Refreshing an expired event list must not spend an analysis slot');
  const invalid = await stale.run(body, true, async () => Response.json([{ id: 'bad' }]));
  assert.equal(invalid.status, 502, 'Invalid provider data remains an explicit error');
});
test('Scheduled worker requires the private cron secret, bypasses only manual caps and never publishes', async () => {
    const job = { id: 'job', sport: 'NBA', event_id: 'event', event_start: quote.start, matchup: 'Away @ Home', selection_note: 'Top-three matchup.' };
    const api = endpoint({ configured: true, failClaim: true, scheduledJob: job });
    assert.equal((await api.cron({ action: 'scheduled' }, 'wrong')).status, 401);
    assert.equal((await api.cron({ action: 'publish' })).status, 403);
    assert.equal((await api.run({ action: 'scheduled', sport: 'NBA' })).status, 400, 'A signed-in admin cannot impersonate the worker');
    assert.equal(api.fetches.length, 0);
    const result = await api.cron();
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.equal(body.run.payload.scheduled.jobId, 'job');
    assert.deepEqual(new URL(api.fetches[0]).searchParams.get('markets').split(','), ['h2h', 'spreads']);
    assert.deepEqual([...body.run.settings.markets], ['h2h', 'spreads']);
    assert.ok((body.run.payload.picks ?? []).every((pick) => ['h2h', 'spreads'].includes(pick.market)));
    assert.ok(!api.rpc.some(({ name }) => ['gamewaire_claim', 'gamewaire_publish', 'gamewaire_publish_lean'].includes(name)));
    assert.ok(api.writes.some(({ table, value }) => table === 'gamewaire_schedule_jobs' && value.status === 'completed'));
    const idle = endpoint({ configured: true });
    assert.equal((await idle.cron()).status, 200);
    assert.equal(idle.fetches.length, 0, 'No claimed job means no paid call');
  });
test('NFL scheduled requests retain full markets; publishing an NBA lean is explicit and uses no provider credits', async () => {
  const api = endpoint({ configured: true, scheduledJob: {
    id: 'nfl-job', sport: 'NFL', event_id: 'event', event_start: quote.start, matchup: 'Away @ Home', selection_note: 'Weekly slate.',
  } });
  assert.equal((await api.cron()).status, 200);
  assert.equal(new URL(api.fetches[0]).searchParams.get('markets').split(',').length, 7);
  const publish = endpoint();
  assert.equal((await publish.run({ action: 'publishLean', runId: '00000000-0000-0000-0000-000000000001' })).status, 200);
  assert.equal(publish.rpc.at(-1).name, 'gamewaire_publish_lean');
  assert.equal(publish.fetches.length, 0);
  const legacy = endpoint({ publicationVersion: 'old' });
  assert.equal((await legacy.run({ action: 'publishLean', runId: '00000000-0000-0000-0000-000000000001' })).status, 400);
});
test('Team-only evidence never fetches player rosters or player game logs', async () => {
  const calls = [];
  const teamQuote = { ...quote, market: 'h2h', subject: quote.home, side: quote.home, line: null };
  await sources.collectEvidence([teamQuote], {
    id: 'event', season: 2027, home: { id: '1', name: quote.home }, away: { id: '2', name: quote.away },
  }, now, async (url) => {
    calls.push(String(url));
    return Response.json({ events: [] });
  });
  assert.ok(calls.length > 0);
  assert.ok(calls.every((url) => !url.includes('/roster') && !url.includes('/athletes/')));
});
test('NBA review buttons publish freely, refresh only team markets, and request players only explicitly', async () => {
  const source = readFileSync(new URL('../src/Gamewaire.tsx', import.meta.url), 'utf8')
    .replace('function ReviewNBALean(', 'export function ReviewNBALean(');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const calls = [], refreshed = [];
  const run = { id: 'run', sport: 'NBA', event_id: 'event', event_start: new Date(Date.now() + 86400000).toISOString(),
    settings, payload: { teamLean: { reason: 'Lean only', pick: { ...evaluate().picks[0],
      updatedAt: new Date().toISOString(), dataAt: new Date().toISOString() } } } };
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, Date, console, require(name) {
    if (name === 'react') return { useState: (value) => [value, () => {}] };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('services/gamewaire')) return { ...engine, engineRequest: async (body) => {
      calls.push(body); return { run };
    } };
    return {};
  } });
  vm.runInContext(code, context);
  const tree = context.exports.ReviewNBALean({ report: run, refresh() {}, onFreshReport: (next) => refreshed.push(next) });
  const nodes = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const buttons = nodes(tree).filter((node) => node.type === 'button');
  assert.equal(buttons.length, 3);
  assert.equal(buttons[0].props.disabled, false);
  buttons[0].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0].action, 'publishLean');
  assert.equal(calls[0].settings, undefined, 'Publishing cannot launch analysis');
  buttons[1].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([...calls[1].settings.markets], ['h2h', 'spreads']);
  buttons[2].props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([...calls[2].settings.markets], [...engine.markets.NBA]);
  assert.equal(refreshed.length, 2, 'Both analyses return to review, never publish automatically');
  assert.equal(calls.filter((call) => call.action === 'publishLean').length, 1);
});
  test('Scheduled provider failures are explicit and recorded without a paid retry', async () => {
    const job = { id: 'job', sport: 'NFL', event_id: 'event', event_start: quote.start, matchup: 'Away @ Home', selection_note: 'Weekly slate.' };
    const api = endpoint({ configured: true, scheduledJob: job });
    let fetchCount = 0;
    const failed = await api.cron(undefined, undefined, async () => {
      fetchCount++;
      return new Response('', { status: 429, headers: { 'x-requests-remaining': '0' } });
    });
    assert.equal(failed.status, 502);
    assert.equal(fetchCount, 1);
    const saved = api.writes.find(({ table, value }) => table === 'gamewaire_schedule_jobs' && value.status === 'failed');
    assert.match(saved.value.error, /rate limit/);
    assert.equal(saved.value.provider_usage.creditsRemaining, 0);
  });
  test('Fresh reports are reused for ten minutes only while actual quote and data timestamps remain valid', async () => {
    const candidate = evaluate().picks[0];
    const cachedRun = { id: 'cached', status: 'completed', event_start: quote.start, created_at: new Date(now - 9 * 60_000).toISOString(),
      settings, payload: { modelVersion: engine.modelVersion, picks: [candidate] } };
    const api = endpoint({ configured: true, failClaim: true, cachedRun });
    const response = await api.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cached, true);
    assert.equal(api.rpc.length, 0);
    assert.equal(api.fetches.length, 0);
    const stale = endpoint({ configured: true, failClaim: true, cachedRun: { ...cachedRun,
      payload: { ...cachedRun.payload, picks: [{ ...candidate, updatedAt: new Date(now - 600_001).toISOString() }] } } });
    assert.equal((await stale.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings })).status, 429);
    const changed = await api.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings: { ...settings, minEV: 0.1 } });
    assert.equal(changed.status, 429, 'Changed settings require a new budgeted analysis');
  });
  test('Actual provider credit headers are saved; absent headers are unknown, not zero', async () => {
    const api = endpoint({ configured: true });
    let usage;
    await api.exports.oddsJSON('sports/basketball_nba/events/event/odds', 'fixture', async () => Response.json({}, { headers: {
      'x-requests-last': '7', 'x-requests-used': '21', 'x-requests-remaining': '479',
    } }), (value) => { usage = value; });
    assert.equal(usage.requestCost, 7);
    assert.equal(usage.creditsUsed, 21);
    assert.equal(usage.creditsRemaining, 479);
    await api.exports.oddsJSON('sports/basketball_nba/events', 'fixture', async () => Response.json([]), (value) => { usage = value; });
    assert.equal(usage.requestCost, null);
  });
test('Budget migration and fresh schema use the same atomic, non-consuming rejection logic', () => {
  const schema = readFileSync(new URL('../supabase/gamewaire.sql', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/gamewaire-budget.sql', import.meta.url), 'utf8');
  const claim = (sql) => sql.slice(sql.indexOf('create or replace function public.gamewaire_claim('), sql.indexOf('grant execute on function public.gamewaire_claim(uuid) to service_role;') + 'grant execute on function public.gamewaire_claim(uuid) to service_role;'.length);
  assert.equal(claim(schema), claim(migration));
  assert.ok(migration.indexOf('then return false') < migration.indexOf('attempts = global_amount + 1'));
  assert.match(migration, /where scope = 'global' for update/);
});
test('Concurrent game refreshes stop before budget claims or provider calls', async () => {
  const api = endpoint({ configured: true, lockBusy: true });
  const response = await api.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings });
  assert.equal(response.status, 409);
  assert.equal(api.fetches.length, 0);
  assert.ok(!api.rpc.some(({ name }) => name === 'gamewaire_claim'));
  assert.match((await response.json()).error, /no additional credits were used/);
});
test('Client displays a local reset time for analysis limits without changing other errors', async () => {
  const source = readFileSync(new URL('../src/services/gamewaire.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let payload = { error: 'Hourly analysis limit reached.', retryAt: '2026-10-27T19:00:00.000Z' };
  const client = {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    functions: { invoke: async () => ({ error: { context: Response.json(payload, { status: 429 }) } }) },
  };
  const context = vm.createContext({ exports: {}, Response, Date, require: (name) => name.includes('supabaseClient') ? { supabase: client } : engine });
  vm.runInContext(code, context);
  const localTime = new Date(payload.retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  await assert.rejects(context.exports.engineRequest({ action: 'analyze' }), (error) =>
    error.message === `Hourly analysis limit reached. Try again at ${localTime}.`);
  payload = { error: 'Provider failed.', retryAt: 'invalid' };
  await assert.rejects(context.exports.engineRequest({ action: 'events' }), (error) => error.message === 'Provider failed.');
});
test('Provider errors, invalid lines and AI failures remain explicit; AI only selects supplied factual phrases', async () => {
  const api = endpoint({ configured: true });
  const error = await api.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings }, true, async () => new Response('', { status: 429 }));
  assert.equal(error.status, 502); assert.match((await error.json()).error, /rate limit/);
  const picks = evaluate().picks;
  await api.exports.explain(picks, 'fixture-ai', 'fixture-model', async () => Response.json({ choices: [{ message: {
    content: JSON.stringify({ selections: [{ key: picks[0].key, facts: [0, 1], risks: [0] }] }),
  } }] }));
  assert.equal(picks[0].explanation, `${picks[0].facts[0]} ${picks[0].facts[1]} ${picks[0].risks[0]}`);
  await assert.rejects(api.exports.explain(picks, 'fixture-ai', 'fixture-model', async () => Response.json({ choices: [{ message: { content: '{"selections":[]}' } }] })), /incomplete/);
});

test('Edge source type-checks against existing Supabase types without installing tools', () => {
  const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1');
  const shim = `${root}gamewaire-test-runtime.d.ts`;
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, types: [] };
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  host.fileExists = (name) => name === shim || exists(name);
  host.readFile = (name) => name === shim ? 'interface ImportMeta { main?: boolean } declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };' : read(name);
  host.resolveModuleNames = (names, containing) => names.map((name) => ts.resolveModuleName(name.startsWith('npm:') ? '@supabase/supabase-js' : name, containing, options, host).resolvedModule);
  const program = ts.createProgram([`${root}supabase/functions/gamewaire/index.ts`, shim], options, host);
  const errors = ts.getPreEmitDiagnostics(program);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => root, getCanonicalFileName: (file) => file, getNewLine: () => '\n' }));
});
