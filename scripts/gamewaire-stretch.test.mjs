import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate, defaultSettings, rankTopPicks } from '../supabase/functions/_shared/gamewaire.ts';

const now = Date.parse('2026-10-27T18:00:00Z');
const settings = { ...defaultSettings, markets: ['player_points'], recentWeight: 0 };
const quotes = Array.from({ length: 6 }, (_, index) => ({
  key: `event|player_points|Player ${index}|Over|20.5`, eventId: 'event', sport: 'NBA', start: new Date(now + 86400000).toISOString(),
  home: 'Home', away: 'Away', market: 'player_points', subject: `Player ${index}`, side: 'Over', line: 20.5,
  american: -110, noVig: 0.5, book: 'Book', updatedAt: new Date(now - 60000).toISOString(),
}));
const evidence = new Map(quotes.map((quote, index) => [quote.key, {
  eligible: true, fetchedAt: new Date(now).toISOString(), quality: 0.9, risks: [],
  samples: Array.from({ length: 30 }, (_, row) => ({ date: new Date(now - (row + 1) * 86400000).toISOString(),
    value: row < (index === 0 ? 28 : 16 - index) ? 30 : 10 })),
}]));

test('Full NBA and NFL analyses retain normal qualifying props then fill to three distinct players with Stretch options', () => {
  for (const sport of ['NBA', 'NFL']) {
    const inputs = quotes.map((quote) => ({ ...quote, sport }));
    const ordinary = evaluate(inputs, evidence, settings, now, 8);
    const full = evaluate(inputs, evidence, settings, now, 8, 3);
    assert.equal(full.status, 'completed');
    assert.equal(full.picks.length, 3);
    assert.equal(new Set(full.picks.map((pick) => pick.subject)).size, 3);
    assert.equal(full.stretchKeys.length, 3 - ordinary.picks.length);
    for (const pick of ordinary.picks) assert.deepEqual(full.picks.find((candidate) => candidate.key === pick.key), pick);
    for (const pick of full.picks) {
      assert.equal('stretch' in pick, false, 'Public candidate JSON must not contain private label metadata');
      if (full.stretchKeys.includes(pick.key)) assert.ok(pick.ev < settings.minEV || pick.edge < settings.minEdge || pick.conservativeEV <= 0);
    }
    assert.deepEqual(full.picks, rankTopPicks(full.picks));
    assert.equal(ordinary.stretchKeys, undefined);
  }
});
test('Stretch fills only value failures: data quality, eligibility, odds, sample size, direction and player filters remain mandatory', () => {
  for (const change of [
    (data) => ({ ...data, eligible: false }),
    (data) => ({ ...data, quality: 0.1 }),
    (data) => ({ ...data, fetchedAt: new Date(now - 3600001).toISOString() }),
    (data) => ({ ...data, samples: data.samples.slice(0, 3) }),
  ]) {
    const unsafe = new Map([...evidence].map(([key, data]) => [key, change(data)]));
    const result = evaluate(quotes, unsafe, settings, now, 8, 3);
    assert.equal(result.picks.length, 0); assert.deepEqual(result.stretchKeys, []);
  }
  for (const patch of [{ noVig: null }, { updatedAt: new Date(now - 600001).toISOString() }, { start: new Date(now - 1).toISOString() }]) {
    assert.equal(evaluate(quotes.map((quote) => ({ ...quote, ...patch })), evidence, settings, now, 8, 3).picks.length, 0);
  }
  assert.equal(evaluate(quotes, evidence, { ...settings, player: 'Player 1' }, now, 8, 3).picks.length, 1);
  assert.equal(evaluate(quotes, evidence, { ...settings, direction: 'under' }, now, 8, 3).picks.length, 0);
});
test('Stretch never duplicates a player across markets and never adds extras when at least three players qualify', () => {
  const duplicated = quotes.map((quote) => ({ ...quote, key: `${quote.key}-second`, market: 'player_assists' }));
  const data = new Map([...evidence, ...duplicated.map((quote, index) => [quote.key, evidence.get(quotes[index].key)])]);
  const result = evaluate([...quotes, ...duplicated], data, { ...settings, markets: ['player_points', 'player_assists'] }, now, 8, 3);
  assert.equal(result.picks.length, 3);
  assert.equal(new Set(result.picks.map((pick) => pick.subject)).size, 3);
  const strong = new Map([...evidence].map(([key]) => [key, evidence.get(quotes[0].key)]));
  const normal = evaluate(quotes, strong, settings, now, 8);
  const full = evaluate(quotes, strong, settings, now, 8, 3);
  assert.deepEqual(full.picks, normal.picks);
  assert.deepEqual(full.stretchKeys, []);
  const allStretch = evaluate(quotes, evidence, { ...settings, minEV: 1 }, now, 8, 3);
  assert.equal(allStretch.status, 'completed');
  assert.equal(allStretch.picks.length, 3);
  assert.equal(allStretch.stretchKeys.length, 3);
});
test('Manual full analysis includes a verified team lean as private Stretch without relaxing safety gates', () => {
  const team = { ...quotes[0], sport: 'NFL', key: 'team', market: 'h2h', subject: 'Home', side: 'Home', line: null };
  const data = new Map([...evidence, [team.key, evidence.get(quotes[0].key)]]);
  const options = { ...settings, minEV: 1 };
  const result = evaluate([...quotes, team], data, options, now, 8, 3);
  assert.equal(result.picks.length, 4);
  assert.ok(result.stretchKeys.includes(team.key));
  assert.equal(result.teamLean.qualifies, false);
  assert.equal(evaluate([team], data, options, now).picks.length, 0, 'Scheduled lean-only analysis does not manufacture Top Picks');
  data.set(team.key, { ...data.get(team.key), eligible: false });
  assert.ok(!evaluate([...quotes, team], data, options, now, 8, 3).picks.some((pick) => pick.key === team.key));
});
