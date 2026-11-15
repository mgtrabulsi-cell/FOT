import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { defaultSettings, evaluate, modelVersion, probabilityModelVersion, rankTopPicks } from '../supabase/functions/_shared/gamewaire.ts';
import { evaluateSoccer } from '../supabase/functions/_shared/gamewaireSoccer.ts';
import { scoreboardPicks } from '../supabase/functions/_shared/gamewaireScoreboard.ts';
import { pickBreakdown } from '../supabase/functions/_shared/gamewaireNarrative.ts';

const now = Date.parse('2026-11-10T12:00:00Z');
const quote = (sport, key, extra = {}) => ({ key, eventId: key, sport, start: new Date(now + 86400000).toISOString(),
  home: 'Home', away: 'Away', market: sport === 'NBA' ? 'player_points' : 'player_rush_yds',
  subject: key, side: 'Over', line: 10.5, american: -110, noVig: .5, book: 'Book', updatedAt: new Date(now).toISOString(), ...extra });
const evidence = (wins, total = 30) => ({ eligible: true, quality: .8, fetchedAt: new Date(now).toISOString(), risks: [],
  samples: Array.from({ length: total }, (_, i) => ({ value: i < wins ? 30 : 0, date: new Date(now - (i + 1) * 86400000).toISOString() })) });
const settings = { ...defaultSettings, markets: ['player_points', 'player_rush_yds', 'h2h', 'spreads', 'totals'], recentWeight: 0, minEV: 1, minEdge: 1 };

test('NBA/NFL probabilities and selected keys are invariant to valid sportsbook prices and no-vig probabilities in every mode', () => {
  for (const sport of ['NBA', 'NFL']) for (const minimum of [0, 3, 4, 8]) {
    const quotes = [quote(sport, 'likely'), quote(sport, 'valuable')];
    const data = new Map([[quotes[0].key, evidence(26)], [quotes[1].key, evidence(20)]]);
    const baseline = evaluate(quotes, data, settings, now, 8, minimum);
    for (const american of [-10000, -201, -100, 100, 5000]) for (const noVig of [.1, .9]) {
      const report = evaluate(quotes.map(q => ({ ...q, american, noVig })), data, settings, now, 8, minimum);
      assert.deepEqual(report.picks.map(p => [p.key, p.probability, p.projection]), baseline.picks.map(p => [p.key, p.probability, p.projection]));
      assert.ok(Math.abs(report.picks[0].probability - 28 / 34) < 1e-12, 'Neutral prior, not bookmaker belief');
      assert.equal(report.picks[0].learning.baseModelVersion, probabilityModelVersion);
    }
    const expensive = evaluate([{ ...quotes[0], american: -10000 }, { ...quotes[1], american: 500 }], data, settings, now, 8, minimum);
    assert.deepEqual(expensive.picks.map(p => p.key), ['likely', 'valuable']);
    assert.ok(expensive.picks[0].ev < 0 && expensive.picks[1].ev > 0);
    assert.ok(expensive.picks[0].conservativeEV < 0 && expensive.picks[0].edge < 0);
    assert.equal(JSON.stringify(data.get('likely')), JSON.stringify(evidence(26)), 'Evidence remains immutable');
  }
});

test('Only exact probability and stable keys break ranking ties, independently of prices, value scores and input order', () => {
  const q = quote('NBA', 'base');
  const base = evaluate([q], new Map([[q.key, evidence(24)]]), settings, now).picks[0];
  const a = { ...base, key: 'a', ev: -1, edge: -.9, conservativeEV: -1, american: -10000, quality: .75 };
  const z = { ...base, key: 'z', ev: 9, edge: .9, conservativeEV: 9, american: 5000, quality: 1 };
  for (const order of [[a, z], [z, a]]) assert.deepEqual(rankTopPicks(order).map(p => p.key), ['a', 'z']);
  assert.equal(rankTopPicks([a, { ...z, probability: a.probability + .000001 }])[0].key, 'z');
});

test('Supported options have no fixed probability floor, but missing, stale, invalid and projection-opposed data still fail', () => {
  for (const sport of ['NBA', 'NFL']) {
    const q = quote(sport, 'supported');
    const data = evidence(12);
    const report = evaluate([q], new Map([[q.key, data]]), settings, now, 5, 4);
    assert.equal(report.picks.length, 1);
    assert.ok(report.picks[0].probability < .5 && report.picks[0].projection > q.line);
    for (const patch of [{ eligible: false }, { quality: NaN }, { quality: .2 }, { samples: [] },
      { fetchedAt: new Date(now - 3600001).toISOString() }])
      assert.equal(evaluate([q], new Map([[q.key, { ...data, ...patch }]]), settings, now).picks.length, 0);
    for (const patch of [{ american: -99 }, { noVig: null }, { side: 'Under' }, { line: 100 },
      { updatedAt: new Date(now - 600001).toISOString() }])
      assert.equal(evaluate([{ ...q, ...patch }], new Map([[q.key, data]]), settings, now).picks.length, 0);
  }
});

test('A higher-probability total is not displaced by a lower-probability moneyline', () => {
  const props = Array.from({ length: 4 }, (_, i) => quote('NBA', `player-${i}`));
  const total = quote('NBA', 'total', { market: 'totals' });
  const ml = quote('NBA', 'moneyline', { market: 'h2h', subject: 'Home', side: 'Home', line: null });
  const data = new Map([...props, total, ml].map(q => [q.key, evidence(q === ml ? 18 : 26)]));
  const report = evaluate([...props, ml, total], data, settings, now, 5, 4);
  assert.equal(report.picks.length, 5);
  assert.equal(report.picks.filter(p => p.market.startsWith('player_')).length, 4);
  assert.ok(report.picks.some(p => p.key === total.key));
  assert.ok(!report.picks.some(p => p.key === ml.key));
  assert.equal(report.teamLean.pick.key, ml.key, 'Separate lean remains available without overriding the stronger total');
});

test('Soccer player estimates ignore price/value and retain projection, single-sided and evidence safeguards', () => {
  const q = quote('EPL', 'player', { market: 'player_shots', line: 1.5, noVig: null, priceCoverage: 'single-sided' });
  const data = { ...evidence(24), soccerLeague: 'EPL', currentSeason: 2026 };
  data.samples = data.samples.map(row => ({ ...row, value: row.value ? 3 : 0, season: 2026 }));
  const run = (american, patch = {}) => evaluateSoccer([{ ...q, american, ...patch }], new Map([[q.key, data]]),
    { ...settings, markets: [q.market] }, now);
  const cheap = run(500).picks[0], expensive = run(-10000).picks[0];
  assert.equal(expensive.probability, cheap.probability);
  assert.ok(expensive.ev < 0 && cheap.ev > 0);
  assert.equal(run(-10000, { line: 3.5 }).picks.length, 0);
  assert.equal(run(-10000, { side: 'Under' }).picks.length, 0);
});

test('Automatic Wire picks rank negative-EV supported selections ahead of lower-probability value selections on all slates', () => {
  const q = quote('NBA', 'team', { market: 'h2h', subject: 'Home', side: 'Home', line: null });
  const base = evaluate([q], new Map([[q.key, evidence(26)]]), settings, now).picks[0];
  const likely = { ...base, key: 'likely', identifiers: { espnEventId: 'likely' }, probability: .8,
    ev: -.4, edge: -.2, conservativeEV: -.5, american: -10000 };
  const valuable = { ...base, key: 'valuable', identifiers: { espnEventId: 'valuable' }, probability: .6,
    ev: 2, edge: .3, conservativeEV: 1, american: 500 };
  const strongest = { ...likely, key: 'strongest', market: 'spreads', line: -1.5,
    identifiers: { espnEventId: 'strongest' }, probability: .9 };
  for (const nbaGames of [1, 2, 4]) {
    const picks = scoreboardPicks([valuable, strongest], now, { nbaGames, winnerLeans: [{ pick: likely, qualifies: true }] });
    assert.deepEqual(picks.map(p => p.eventId), nbaGames < 3 ? ['strongest'] : ['strongest', 'likely', 'valuable']);
  }
  assert.deepEqual(scoreboardPicks([valuable, likely], now).map(p => p.eventId), ['likely', 'valuable']);
  assert.equal(scoreboardPicks([{ ...likely, samples: [] }], now).length, 0);
  assert.equal(scoreboardPicks([{ ...likely, modelVersion: 'probability-first-v11' }], now).length, 0);
  assert.ok(modelVersion !== 'probability-first-v11' && probabilityModelVersion !== 'probability-evidence-v11');
});

test('Selection controls and explanations no longer advertise value-based eligibility', () => {
  const ui = readFileSync(new URL('../src/Gamewaire.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /Minimum estimated EV|Minimum probability edge|Manual team-only analyses retain value screens/);
  assert.match(ui, /EV, odds value and payout do not determine eligibility or order/);
  const q = quote('NBA', 'team', { market: 'h2h', subject: 'Home', side: 'Home', line: null });
  const base = evaluate([q], new Map([[q.key, evidence(24)]]), settings, now).picks[0];
  const pick = { ...base, probability: .6, pushProbability: .1 };
  assert.match(pickBreakdown(pick), /60\.0% win chance/);
  assert.doesNotMatch(pickBreakdown(pick), /66\.7%|percentage-point edge|uses weighted prior-game outcomes and market pricing/);
  for (const invalid of [{ probability: NaN }, { probability: .95 }, { pushProbability: 1 }]) {
    const text = pickBreakdown({ ...pick, ...invalid });
    assert.match(text, /model probabilities are unavailable/);
    assert.doesNotMatch(text, /NaN|Infinity|win chance/);
  }
});
