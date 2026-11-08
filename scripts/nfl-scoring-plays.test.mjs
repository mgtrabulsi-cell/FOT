import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNFLScoringPlays, readNFLScoringPlays } from '../src/services/sportsData.ts';

const play = (id, type, awayScore, homeScore) => ({
  id, text: `${type} description`, type: { text: type }, team: { id: '1' },
  period: { number: 1 }, clock: { displayValue: '11:45' }, awayScore, homeScore,
});
test('Scoring summary includes every reported scoring type and real zero scores without inventing missing scores', () => {
  const rows = [
    play('1', 'Field Goal Good', 3, 0), play('2', 'Rushing Touchdown', 3, 7),
    play('3', 'Safety', 5, 7), play('4', 'Two Point Conversion', 5, 15),
    play('5', 'Extra Point Good', undefined, undefined),
  ];
  const parsed = readNFLScoringPlays({ scoringPlays: rows });
  assert.equal(parsed.length, 5);
  assert.equal(parsed[0].homeScore, 0);
  assert.equal(parsed[0].clock, '11:45');
  assert.equal(parsed[0].period, 1);
  assert.equal(parsed[0].teamId, '1');
  assert.equal(parsed[4].homeScore, undefined);
  assert.equal(parsed[4].awayScore, undefined);
  assert.deepEqual(readNFLScoringPlays({ scoringPlays: [] }), []);
});
test('Duplicate scoring IDs use the feed correction and malformed plays surface an error', () => {
  const first = play('1', 'Field Goal Good', 3, 0);
  const corrected = { ...first, text: 'Corrected scoring description' };
  assert.deepEqual(readNFLScoringPlays({ scoringPlays: [first, corrected] }).map(row => row.text), [corrected.text]);
  assert.throws(() => readNFLScoringPlays({ scoringPlays: [{ id: '1' }] }), /incomplete play/);
});
test('Scoring feed refreshes live games, passes cancellation and explicitly rejects HTTP failures', async () => {
  const original = globalThis.fetch, controller = new AbortController();
  const game = { eventId: '999888777', feedPath: 'football/nfl', status: 'LIVE' };
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.match(url, /football\/nfl\/summary\?event=999888777/);
      assert.equal(options.signal, controller.signal);
      assert.equal(options.cache, 'no-store');
      return new Response(JSON.stringify({ scoringPlays: [play('1', 'Field Goal Good', calls * 3, 0)] }));
    };
    assert.equal((await fetchNFLScoringPlays(game, controller.signal))[0].awayScore, 3);
    assert.equal((await fetchNFLScoringPlays(game, controller.signal))[0].awayScore, 6);
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(fetchNFLScoringPlays(game), /HTTP 503/);
  } finally {
    globalThis.fetch = original;
  }
});
