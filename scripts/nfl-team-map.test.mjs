import assert from 'node:assert/strict';
import test from 'node:test';
import { nflTeamByAPISportsId, nflTeamByESPNId, nflTeamMap } from '../supabase/functions/_shared/nflTeamMap.ts';

test('The NFL team map is a complete bijection between ESPN and API-Sports IDs', () => {
  assert.equal(nflTeamMap.length, 32, 'All 32 franchises are mapped');
  assert.equal(new Set(nflTeamMap.map((team) => team.espnId)).size, 32, 'ESPN IDs are unique');
  assert.equal(new Set(nflTeamMap.map((team) => team.apiSportsId)).size, 32, 'API-Sports IDs are unique');
  assert.equal(new Set(nflTeamMap.map((team) => team.name)).size, 32, 'Franchise names are unique');
  for (const team of nflTeamMap) {
    assert.ok(/^\d+$/.test(team.espnId) && /^\d+$/.test(team.apiSportsId), `${team.name} uses numeric IDs`);
    assert.ok(team.espnAbbr.length >= 2 && team.espnAbbr.length <= 4, `${team.name} has a plausible abbreviation`);
    assert.equal(nflTeamByESPNId.get(team.espnId), team);
    assert.equal(nflTeamByAPISportsId.get(team.apiSportsId), team);
  }
});

test('Known franchises resolve to their verified API-Sports IDs', () => {
  // Spot-checked against live /games and /teams responses (Eagles at Commanders, 2026 week 8).
  assert.equal(nflTeamByESPNId.get('21')?.apiSportsId, '12', 'Philadelphia Eagles');
  assert.equal(nflTeamByESPNId.get('28')?.apiSportsId, '18', 'Washington Commanders');
  assert.equal(nflTeamByAPISportsId.get('1')?.name, 'Las Vegas Raiders');
});
