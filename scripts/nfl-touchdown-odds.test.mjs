import assert from 'node:assert/strict';
import test from 'node:test';
import { readNFLTouchdownOdds, savedNFLTouchdownOdds } from '../supabase/functions/_shared/nflTouchdownOdds.ts';

const kickoff = '2026-11-23T20:00:00Z', capturedAt = '2026-11-23T19:00:00Z';
const raw = { commence_time: kickoff, bookmakers: [{ title: 'Test Book', markets: [{
  key: 'player_anytime_td', last_update: '2026-11-23T18:59:00Z',
  outcomes: [{ name: 'Yes', description: 'Test Player', price: 175 },
    { name: 'No', description: 'Test Player', price: -200 }, { name: 'Other Player', price: -110 },
    { name: 'Bad Price', price: 20 }, { name: 'Missing Price' }]
}] }] };
test('Archives only real pregame anytime touchdown prices, including negative odds', () => {
  const rows = readNFLTouchdownOdds(raw, '123', capturedAt);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].american, 175);
  assert.equal(rows[1].american, -110);
  assert.equal(savedNFLTouchdownOdds(rows, '123', kickoff, 'Test Player').provider, 'Test Book');
  assert.equal(savedNFLTouchdownOdds(rows, '456', kickoff, 'Test Player'), undefined);
  assert.equal(savedNFLTouchdownOdds(rows, '123', '2026-11-24T20:00:00Z', 'Test Player'), undefined);
  assert.equal(savedNFLTouchdownOdds(rows, '123', kickoff, 'Unknown'), undefined);
  assert.equal(readNFLTouchdownOdds(raw, '123', kickoff).length, 0);
  assert.equal(savedNFLTouchdownOdds([{ ...rows[0], capturedAt: kickoff }], '123', kickoff, 'Test Player'), undefined);
});
