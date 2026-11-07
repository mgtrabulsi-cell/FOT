import assert from 'node:assert/strict';
import test from 'node:test';
import { learnAdjustment, adjustedPrediction, adjustedPickProbability, pickLearningKey } from '../supabase/functions/_shared/gamewireLearning.ts';
import { finalPlayerStats, archivePlayerForecast, settleForecasts } from '../supabase/functions/_shared/gamewireForecasts.ts';
import { loadPickLearning } from '../supabase/functions/_shared/gamewirePickLearning.ts';
import { modelVersion, probabilityModelVersion } from '../supabase/functions/_shared/gamewaire.ts';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluate, defaultSettings, expectedValue } from '../supabase/functions/_shared/gamewaire.ts';
const start = Date.parse('2026-01-01T12:00:00Z'), cutoff = start + 100 * 86400000;
const samples = (count = 40, actual = 110, prediction = 100) => Array.from({ length: count }, (_, i) => ({
  id: `sample-${i}`, eventId: String(i), start: new Date(start + i * 86400000).toISOString(),
  recordedAt: new Date(start + i * 86400000 - 3600000).toISOString(),
  settledAt: new Date(start + i * 86400000 + 4 * 3600000).toISOString(), prediction, actual,
}));
test('Stat learning requires 30 training and 10 later games; validated adjustment stays within ten percent', () => {
  assert.equal(learnAdjustment(samples(39), 'stat', cutoff).active, false);
  const result = learnAdjustment(samples(), 'stat', cutoff);
  assert.equal(result.trainingGames, 30); assert.equal(result.validationGames, 10);
  assert.equal(result.active, true); assert.equal(result.adjustment, 1.1);
  assert.equal(result.baselineError, 10); assert.ok(result.adjustedError < .0001);
  assert.equal(learnAdjustment(samples(40, 200), 'stat', cutoff).adjustment, 1.1);
});
test('Insufficient learning evidence reports sample progress without activating a correction', () => {
  const result = learnAdjustment(samples(20), 'stat', cutoff);
  assert.equal(result.active, false); assert.equal(result.adjustment, 1);
  assert.equal(result.trainingGames, 15); assert.equal(result.validationGames, 5);
  assert.equal(result.sampleIds.length, 20); assert.ok(result.through);
});
test('Later-game failures reject a training improvement rather than overfitting missed predictions', () => {
  const rows = samples(); rows.slice(30).forEach(row => row.actual = 90);
  const result = learnAdjustment(rows, 'stat', cutoff);
  assert.equal(result.active, false); assert.equal(result.adjustment, 1);
  assert.ok(result.adjustedError > result.baselineError);
});
test('Stat activation enforces the five-percent held-out improvement threshold exactly', () => {
  const rows = samples();
  rows.slice(30).forEach(row => row.actual = 105.12);
  assert.equal(learnAdjustment(rows, 'stat', cutoff).active, false);
  rows.slice(30).forEach(row => row.actual = 105.13);
  const result = learnAdjustment(rows, 'stat', cutoff);
  assert.equal(result.active, true);
  assert.ok(result.adjustedError <= result.baselineError * .95);
});
test('Already accurate forecasts and zero error retain the unchanged model', () => {
  const result = learnAdjustment(samples(40, 100), 'stat', cutoff);
  assert.equal(result.active, false); assert.equal(result.adjustment, 1);
});
test('Future, post-kickoff, invalid and duplicate samples cannot meet the learning minimum', () => {
  const rows = samples(20);
  assert.equal(learnAdjustment([...rows, ...rows, ...samples(40).map(row => ({ ...row, recordedAt: row.start }))], 'stat', cutoff).active, false);
  assert.equal(learnAdjustment(samples().map(row => ({ ...row, settledAt: new Date(cutoff + 1).toISOString() })), 'stat', cutoff).active, false);
  assert.equal(learnAdjustment(samples().map(row => ({ ...row, prediction: NaN })), 'stat', cutoff).active, false);
});
test('Training outcomes must have settled before validation starts, not merely before today', () => {
  const rows = samples();
  rows[0].settledAt = rows[39].settledAt;
  const result = learnAdjustment(rows, 'stat', cutoff);
  assert.equal(result.trainingGames, 29); assert.equal(result.active, false);
});
test('Probability learning uses held-out Brier improvement and non-worsening log loss with five point bound', () => {
  const rows = samples(80, 1, .5);
  const result = learnAdjustment(rows, 'probability', cutoff);
  assert.equal(result.active, true); assert.equal(result.adjustment, .05);
  assert.ok(result.adjustedError <= result.baselineError * .98);
  rows.slice(60).forEach(row => row.actual = 0);
  assert.equal(learnAdjustment(rows, 'probability', cutoff).active, false);
  assert.equal(pickLearningKey('player_receptions', 'Under'), 'player_receptions:under');
  assert.equal(pickLearningKey('h2h', 'Team'), 'h2h:team');
  assert.equal(adjustedPrediction(.98, 'probability', .05), .99);
});
test('Team probability adjustments preserve complementary sides and do not favor both sides of a coin flip', () => {
  assert.equal(adjustedPickProbability(.5, 'h2h', 'Team', .05), .5);
  assert.ok(Math.abs(adjustedPickProbability(.7, 'h2h', 'Team A', .05) + adjustedPickProbability(.3, 'h2h', 'Team B', .05) - 1) < 1e-10);
  assert.ok(adjustedPickProbability(.3, 'spreads', 'Underdog', -.05) > .3);
});
test('Applied game learning recomputes probability, push-aware EV and conservative EV while retaining original evidence', () => {
  const quote = { key: 'rush-over', sport: 'NFL', eventId: 'future', start: new Date(cutoff + 86400000).toISOString(), updatedAt: new Date(cutoff).toISOString(),
    home: 'Home', away: 'Away', market: 'player_rush_yds', subject: 'Test Player', side: 'Over', line: 50.5, american: -110, book: 'Fixture', noVig: .5 };
  const observations = Array.from({ length: 8 }, (_, i) => ({ value: 75, date: new Date(cutoff - (i + 1) * 86400000).toISOString(), season: 2026 }));
  const evidence = new Map([[quote.key, { eligible: true, quality: 1, fetchedAt: new Date(cutoff).toISOString(), samples: observations, risks: [], currentSeason: 2026 }]]);
  const settings = { ...defaultSettings, markets: ['player_rush_yds'] };
  const baseline = evaluate([quote], evidence, settings, cutoff).picks[0];
  const adjustment = learnAdjustment(samples(40, 1, .5), 'probability', cutoff);
  const learned = evaluate([quote], evidence, settings, cutoff, 4, 0, new Map([['player_rush_yds:over', adjustment]])).picks[0];
  assert.ok(learned.probability > baseline.probability);
  assert.equal(learned.ev, expectedValue(learned.probability, learned.pushProbability, learned.american));
  assert.ok(learned.conservativeEV > baseline.conservativeEV);
  assert.equal(learned.pushProbability, baseline.pushProbability);
  assert.equal(learned.learning.baseConditional, baseline.probability);
  assert.match(learned.modelVersion, /wf1/);
  assert.deepEqual(learned.samples, baseline.samples);
});
const row = { id: 'forecast', player_id: '123', team_id: '23', season: 2026, week: 8, event_id: '401234567',
  event_start: '2026-10-29T18:00:00Z', forecast_at: '2026-10-29T16:00:00Z', projections: [{ market: 'player_rush_yds', label: 'Rushing yards', estimate: 75, base: 75 }],
  actuals: null, settled_at: null };
const summary = () => ({ header: { id: row.event_id, season: { year: 2026, type: 2 }, week: { number: 8 },
  competitions: [{ status: { type: { completed: true } } }] }, boxscore: { players: [{ team: { id: '23' },
    statistics: [{ name: 'rushing', keys: ['rushingYards'], athletes: [{ athlete: { id: '123' }, stats: ['0'] }] }] }] } });
test('Actuals require exact event, week, season, team, player and confirmed final; real zero is preserved', () => {
  assert.deepEqual(finalPlayerStats(summary(), row, ['player_rush_yds']), { player_rush_yds: 0 });
  const scalarWeek = summary(); scalarWeek.header.week = 8;
  assert.deepEqual(finalPlayerStats(scalarWeek, row, ['player_rush_yds']), { player_rush_yds: 0 });
  for (const invalid of [{ ...row, event_id: 'other' }, { ...row, week: 7 }, { ...row, season: 2025 }])
    assert.throws(() => finalPlayerStats(summary(), invalid, ['player_rush_yds']), /did not match/);
  const live = summary(); live.header.competitions[0].status.type.completed = false;
  assert.equal(finalPlayerStats(live, row, ['player_rush_yds']), null);
  assert.throws(() => finalPlayerStats(summary(), { ...row, team_id: '5' }, ['player_rush_yds']), /does not report/);
  assert.deepEqual(finalPlayerStats(summary(), { ...row, player_id: '456' }, ['player_rush_yds']), { player_rush_yds: null });
  const missing = summary(); missing.boxscore.players[0].statistics[0].athletes[0].stats = ['-'];
  assert.throws(() => finalPlayerStats(missing, row, ['player_rush_yds']), /missing or invalid/);
});
test('Negative actual yards are valid; absent players never become fabricated zero production', () => {
  const negative = summary(); negative.boxscore.players[0].statistics[0].athletes[0].stats = ['-3'];
  assert.equal(finalPlayerStats(negative, row, ['player_rush_yds']).player_rush_yds, -3);
});
test('Settlement preserves forecasts and exposes failed writes; unchanged finals keep the original settled timestamp', async () => {
  const writes = [], admin = { from: () => ({ update: value => ({ eq: async () => { writes.push(value); return { error: null }; } }) }) };
  const existing = { ...row, actuals: { player_rush_yds: 0 }, settled_at: '2026-10-29T22:00:00Z' };
  const result = await settleForecasts(admin, [existing], async () => Response.json(summary()));
  assert.deepEqual(writes[0], { actuals: existing.actuals, settled_at: existing.settled_at });
  assert.equal(result.weeks[0].projections[0].estimate, 75);
  const failed = await settleForecasts({ from: () => ({ update: () => ({ eq: async () => ({ error: { message: 'write failed' } }) }) }) }, [row], async () => Response.json(summary()));
  assert.equal(failed.weeks[0].settled_at, null); assert.match(failed.issues[0], /Could not save/);
});
test('Archival uses independent bases, does not mutate cached estimates and never writes after kickoff', async () => {
  const writes = [], admin = { from: () => new Proxy({}, { get: (_, name) => name === 'then' ? resolve => resolve({ data: [], error: null }) : () => admin.from() }),
    rpc: async (name, args) => { writes.push({ name, args }); return { data: true, error: null }; } };
  const projection = { estimate: 75, market: 'player_rush_yds', label: 'Rushing yards', unit: 'yards', explanation: 'Independent data' };
  const report = { player: { id: '123', teamId: '23', position: 'RB' }, season: 2026, week: 8, format: 'ppr', eligibleForGuidance: true,
    matchup: { eventId: row.event_id, start: row.event_start, opponent: 'Browns', state: 'pre' }, projections: [projection] };
  await archivePlayerForecast(admin, report, Date.parse(row.forecast_at));
  assert.equal(writes.length, 1); assert.equal(writes[0].args.forecast.projections[0].base, 75);
  assert.equal(projection.learning, undefined);
  await archivePlayerForecast(admin, report, Date.parse(row.event_start));
  assert.equal(writes.length, 1);
  admin.rpc = async () => ({ data: false, error: null });
  await assert.rejects(archivePlayerForecast(admin, report, Date.parse(row.forecast_at)), /Kickoff locked/);
});
test('Game-pick adapter uses original pre-correction probabilities, ignores model changes and paginates verified settled picks', async () => {
  const rows = samples(40, 1, .5).map(sample => ({ id: sample.id, event_id: sample.eventId, event_start: sample.start, created_at: sample.recordedAt,
    settled_at: sample.settledAt, probability: .9, push_probability: 0, result: 'win', market: 'h2h', side: 'Team',
    data: { modelVersion, learning: { baseModelVersion: probabilityModelVersion, baseConditional: .5 } } }));
  rows[0].probability = .5;
  rows[0].data = { modelVersion: probabilityModelVersion };
  const calls = [];
  const builder = new Proxy({}, { get: (_, method) => method === 'then' ? resolve => resolve({ data: rows, error: null }) : (...args) => { calls.push([method, ...args]); return builder; } });
  const result = await loadPickLearning({ from: () => builder }, 'NFL', probabilityModelVersion, cutoff);
  assert.equal(result.get('h2h:team').active, true); assert.equal(result.get('h2h:team').adjustment, .05);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'withdrawn' && call[2] === false));
  assert.ok(calls.some(call => call[0] === 'in' && call[1] === 'result'));
});
test('Weekly tracker shows estimates beside real zero stats and switches to saved past-week estimates without a dropdown', () => {
  const history = { issues: [], weeks: [
    { ...row, week: 8, event_id: 'current', actuals: { player_rush_yds: 0 }, settled_at: '2026-10-29T22:00:00Z', opponent: 'Current opponent' },
    { ...row, week: 7, event_id: 'past', projections: [{ market: 'player_rush_yds', label: 'Rushing yards', estimate: 90, base: 90 }], actuals: { player_rush_yds: 65 }, settled_at: '2026-10-22T22:00:00Z', opponent: 'Past opponent' },
  ] };
  const state = [history, '', false, 0, false, 'current']; let index = 0;
  const source = ts.transpileModule(readFileSync(new URL('../src/GamewireBot.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = vm.createContext({ exports: {}, require: name => name === 'react/jsx-runtime' ? jsxRuntime : name === 'react'
    ? { useState: () => { const i = index++; return [state[i], next => state[i] = typeof next === 'function' ? next(state[i]) : next]; }, useEffect() {} } : {} });
  vm.runInContext(source, context);
  const render = () => { index = 0; return context.exports.WeeklyTracker({ report: { player: { id: '123', name: 'Test Player' }, season: 2026, week: 8, format: 'ppr', matchup: { eventId: 'current' } } }); };
  let tree = render(), html = renderToStaticMarkup(tree);
  assert.match(html, /GamewAIre estimate/); assert.match(html, /Actual · Final/);
  assert.match(html, /<td>75<\/td><td>0<\/td>/);
  const find = (root, predicate) => {
    if (!root || typeof root !== 'object') return undefined;
    if (predicate(root)) return root;
    const children = Array.isArray(root) ? root : root.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) { const found = find(child, predicate); if (found) return found; }
  };
  find(tree, node => node.type === 'button' && node.props.children === 'Past Weeks').props.onClick();
  tree = render();
  find(tree, node => node.type === 'button' && node.props.children?.[1] === 7).props.onClick();
  html = renderToStaticMarkup(render());
  assert.match(html, /<td>90<\/td><td>65<\/td>/); assert.match(html, /Past opponent/);
  assert.doesNotMatch(html, /<select/);
});
