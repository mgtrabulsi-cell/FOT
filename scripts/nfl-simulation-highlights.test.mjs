import assert from 'node:assert/strict';
import test from 'node:test';
import { featuredSimulationMinimums, isFeaturedSimulationPlayer } from '../supabase/functions/_shared/nflSimulationAccuracy.ts';

test('Featured player minimums match the requested production thresholds exactly', () => {
  assert.deepEqual(featuredSimulationMinimums, {
    rushingYards: 30, receivingYards: 30, passingYards: 200, passingTouchdowns: 2,
    receptions: 3, receivingTouchdowns: 1, rushingTouchdowns: 1,
  });
});
test('Each minimum is inclusive and must be met by both unrounded prediction and actual result', () => {
  for (const [stat, minimum] of Object.entries(featuredSimulationMinimums)) {
    const row = { playerId: '1', name: 'Player', position: 'QB', team: 'AWY', stat, projected: minimum, actual: minimum, error: 0 };
    assert.equal(isFeaturedSimulationPlayer(row), true, stat);
    assert.equal(isFeaturedSimulationPlayer({ ...row, projected: minimum - .001 }), false, `${stat}: prediction below minimum`);
    assert.equal(isFeaturedSimulationPlayer({ ...row, actual: minimum - 1 }), false, `${stat}: actual below minimum`);
    assert.equal(isFeaturedSimulationPlayer({ ...row, projected: minimum + 10, actual: minimum + 10 }), true, stat);
  }
});
test('Passing highlights require QBs; other stats and unspecified metrics retain their intended behavior', () => {
  const row = { playerId: '1', name: 'Player', position: 'WR', team: 'AWY', projected: 250, actual: 250, error: 0 };
  assert.equal(isFeaturedSimulationPlayer({ ...row, stat: 'passingYards' }), false);
  assert.equal(isFeaturedSimulationPlayer({ ...row, stat: 'passingTouchdowns' }), false);
  assert.equal(isFeaturedSimulationPlayer({ ...row, stat: 'rushingYards' }), true);
  assert.equal(isFeaturedSimulationPlayer({ ...row, stat: 'receivingYards' }), true);
  assert.equal(isFeaturedSimulationPlayer({ ...row, stat: 'completions' }), true);
});
