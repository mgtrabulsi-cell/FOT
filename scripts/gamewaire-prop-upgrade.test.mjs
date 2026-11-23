import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { propSequence } from '../supabase/functions/_shared/propSequence.ts';
import { bestPlusMoneyProp, defaultSettings, evaluate, isAllowedPropPrice, soccerSports } from '../supabase/functions/_shared/gamewaire.ts';
import { oddsSport } from '../supabase/functions/_shared/gamewaireSources.ts';
import { soccerPaths } from '../supabase/functions/_shared/gamewaireSoccer.ts';
import { parseGameInjuries } from '../src/services/gameInjuries.ts';

const now = Date.parse('2026-11-23T12:00:00Z');
const observations = outcomes => outcomes.map((hit, index) => ({ eventId: String(index),
  date: new Date(now - (outcomes.length - index) * 86400000).toISOString(), value: hit ? 30 : 0 }));
test('A repeated alternate-game pattern can activate only after chronological validation, capped at three points', () => {
  const rows = observations(Array.from({ length: 80 }, (_, i) => i % 2));
  const result = propSequence(rows, 10.5);
  assert.equal(result.active, true);
  assert.equal(result.validationGames, 20);
  assert.ok(result.adjustedError < result.baselineError);
  assert.ok(result.adjustment < 0 && result.adjustment >= -.03);
  assert.equal(result.pattern, 'miss then hit');
  assert.equal(result.streak.games, 1);
  assert.deepEqual(propSequence([...rows].reverse(), 10.5), result, 'Provider order cannot change temporal validation');
});
test('Insufficient samples, constant cold streaks and failed later validation never create a due-player bonus', () => {
  for (const outcomes of [Array(30).fill(0), Array(80).fill(0), Array(80).fill(1),
    [...Array.from({ length: 60 }, (_, i) => Math.floor(i / 2) % 2), ...Array.from({ length: 20 }, (_, i) => i % 2)]]) {
    const result = propSequence(observations(outcomes), 10.5);
    assert.equal(result.active, false);
    assert.equal(result.adjustment, 0);
  }
});
test('Form excludes pushes, invalid observations and duplicate event IDs; exact-line changes recompute history', () => {
  const rows = observations([1, 0, 1, 0]);
  rows.push({ ...rows[0] }, { eventId: 'push', date: new Date(now - 1000).toISOString(), value: 10.5 },
    { eventId: 'bad', date: 'invalid', value: NaN });
  const result = propSequence(rows, 10.5);
  assert.equal(result.games, 4);
  assert.deepEqual(result.last5, { hits: 2, games: 4 });
  assert.equal(propSequence(rows.slice(0, 4), 35.5).last5.hits, 0);
});
test('Prop price floor includes -200, even money and +5000, but not shorter or malformed odds', () => {
  for (const american of [-200, -199, -100, 100, 500, 5000])
    assert.equal(isAllowedPropPrice({ market: 'player_points', american }), true);
  for (const american of [-201, -400, NaN, Infinity, 0, 99])
    assert.equal(isAllowedPropPrice({ market: 'player_points', american }), false);
  assert.equal(isAllowedPropPrice({ market: 'h2h', american: -400 }), true, 'User floor applies to player props, not game lines');
});
test('Each analysis reserves the highest-probability supported plus-money prop without duplicating a player', () => {
  const q = (key, american, wins) => ({ key, american, wins, eventId: 'game', sport: 'NBA', start: new Date(now + 3600000).toISOString(),
    market: 'player_points', subject: key, side: 'Over', line: 10.5, home: 'H', away: 'A', noVig: .5, book: 'Book', updatedAt: new Date(now).toISOString() });
  const quotes = [q('negative-a', -200, 19), q('negative-b', -110, 18), q('negative-c', -120, 17), q('negative-d', -150, 16),
    q('best-positive', 100, 15), q('big-payout', 5000, 13), q('too-short', -201, 20)];
  const evidence = new Map(quotes.map(row => [row.key, { eligible: true, quality: 1, risks: [], fetchedAt: new Date(now).toISOString(),
    samples: observations(Array.from({ length: 20 }, (_, i) => i < row.wins ? 1 : 0)) }]));
  const run = evaluate(quotes, evidence, { ...defaultSettings, markets: ['player_points'], recentWeight: 0 }, now, 5, 4);
  assert.equal(run.plusMoneyProp.key, 'best-positive');
  assert.equal(run.picks.length, 4);
  assert.ok(run.picks.some(row => row.key === 'best-positive'));
  assert.ok(!run.picks.some(row => row.key === 'too-short'));
  assert.equal(new Set(run.picks.map(row => row.subject)).size, run.picks.length);
  const single = evaluate(quotes, evidence, { ...defaultSettings, markets: ['player_points'] }, now, 1, 0);
  assert.equal(single.picks.length, 1);
  assert.equal(single.picks[0].key, 'best-positive');
  assert.equal(bestPlusMoneyProp([...run.picks].reverse()).key, 'best-positive');
  const negativeOnly = evaluate(quotes.slice(0, 4), evidence, { ...defaultSettings, markets: ['player_points'] }, now, 5, 4);
  assert.equal(negativeOnly.plusMoneyProp, undefined);
  assert.equal(negativeOnly.picks.length, 4, 'No forced alternative when a supported plus-money option is absent');
});
const game = { league: 'NFL', eventId: '900', home: { id: '2', abbr: 'HME' }, away: { id: '1', abbr: 'AWY' } };
const injuryData = injuries => ({ header: { id: '900', competitions: [{ competitors: [
  { homeAway: 'home', team: { id: '2' } }, { homeAway: 'away', team: { id: '1' } },
] }] }, injuries });
const athlete = (id, status, date = '') => ({ athlete: { id, displayName: `Player ${id}` }, status, date });
test('NFL/NBA injury reports mark only explicit Out as OUT, preserving doubtful and questionable', () => {
  for (const league of ['NFL', 'NBA']) {
    const report = parseGameInjuries(injuryData([{ team: { id: '1' }, injuries: [
      athlete('a', 'Out'), athlete('b', 'Doubtful'), athlete('c', 'Questionable'),
    ] }]), { ...game, league });
    assert.deepEqual(report.players.map(row => row.status), ['OUT', 'Doubtful', 'Questionable']);
    assert.equal(report.players[0].name, 'Player a');
  }
});
test('Missing, malformed and different-game injuries cannot appear as a clean empty list', () => {
  assert.throws(() => parseGameInjuries(injuryData(undefined), game), /not supplied/);
  assert.throws(() => parseGameInjuries({ ...injuryData([]), header: { id: 'other' } }, game), /does not match/);
  assert.throws(() => parseGameInjuries(injuryData([{ team: { id: 'wrong' }, injuries: [] }]), game), /unexpected team/);
  assert.throws(() => parseGameInjuries(injuryData([{ team: { id: '1' }, injuries: [{}] }]), game), /incomplete/);
  assert.equal(parseGameInjuries(injuryData([]), game).players.length, 0);
});
test('Later player designations supersede older ones; undated conflicting reports are not labeled OUT', () => {
  const report = parseGameInjuries(injuryData([{ team: { id: '1' }, injuries: [
    athlete('a', 'Out', '2026-11-20T12:00:00Z'), athlete('a', 'Questionable', '2026-11-22T12:00:00Z'),
    athlete('b', 'Out'), athlete('b', 'Questionable'),
  ] }]), game);
  assert.equal(report.players.find(row => row.id === 'a').status, 'Questionable');
  assert.match(report.players.find(row => row.id === 'b').status, /Unconfirmed/);
});
test('Champions League is wired to distinct provider identities and both pregame views mount injuries', () => {
  assert.ok(soccerSports.includes('Champions League'));
  assert.equal(oddsSport['Champions League'], 'soccer_uefa_champs_league');
  assert.equal(soccerPaths['Champions League'], 'soccer/uefa.champions');
  for (const file of ['NBAExperience', 'TheWire']) assert.match(readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8'), /<PregameInjuries/);
});
