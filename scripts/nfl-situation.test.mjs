import assert from 'node:assert/strict';
import test from 'node:test';
import { readNFLSituation, nflFieldPosition } from '../src/services/nflSituation.ts';
import { fetchNFLNotificationGame } from '../src/services/sportsData.ts';

test('Possession and field location use explicit ESPN situation data', () => {
  const situation = readNFLSituation({
    possession: '3', possessionText: 'CHI 39', shortDownDistanceText: '2nd & 3',
    downDistanceText: '2nd & 3 at CHI 39', yardLine: 61,
  }, ['3', '1']);
  assert.deepEqual(situation, { possessionTeamId: '3', fieldPosition: 'CHI 39', downDistance: '2nd & 3' });
  assert.equal(nflFieldPosition(situation), '2nd & 3 · Ball at CHI 39');
  assert.equal(readNFLSituation({ possession: 1, possessionText: '50' }, ['3', '1']).possessionTeamId, '1');
});

test('Missing, unknown, or partial fields do not invent possession or infer field direction', () => {
  assert.equal(readNFLSituation(null, ['3', '1']), undefined);
  assert.equal(readNFLSituation({ yardLine: 61, lastPlay: { team: { id: '3' } } }, ['3', '1']), undefined);
  assert.equal(nflFieldPosition(undefined), 'Field position unavailable');
  const partial = readNFLSituation({ possession: '99', downDistanceText: '1st & Goal at ATL 4' }, ['3', '1']);
  assert.equal(partial.possessionTeamId, null);
  assert.equal(nflFieldPosition(partial), '1st & Goal · Ball at ATL 4');
  assert.equal(nflFieldPosition(readNFLSituation({ possession: '3' }, ['3', '1'])), 'Field position unavailable');
});

test('Scoreboard mapping carries live situations, updates turnovers, and clears pregame/final values', async () => {
  const original = globalThis.fetch;
  let state = 'in';
  let possession = '3';
  globalThis.fetch = async () => Response.json({
    header: {
      id: '123', season: { year: 2026 }, date: '2026-10-18T17:00:00Z',
      competitions: [{
        status: { type: { state }, period: 1, displayClock: '10:00' },
        situation: { possession, possessionText: 'CHI 39', shortDownDistanceText: '2nd & 3' },
        competitors: [
          { homeAway: 'away', team: { id: '3', displayName: 'Chicago', abbreviation: 'CHI' } },
          { homeAway: 'home', team: { id: '1', displayName: 'Atlanta', abbreviation: 'ATL' } },
        ],
      }],
    },
  });
  try {
    assert.equal((await fetchNFLNotificationGame('123')).situation.possessionTeamId, '3');
    possession = '1';
    assert.equal((await fetchNFLNotificationGame('123')).situation.possessionTeamId, '1');
    for (state of ['pre', 'post']) assert.equal((await fetchNFLNotificationGame('123')).situation, undefined);
  } finally { globalThis.fetch = original; }
});
