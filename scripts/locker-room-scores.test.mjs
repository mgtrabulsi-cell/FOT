import assert from 'node:assert/strict';
import test from 'node:test';
import { completedScoreUpdates } from '../src/services/lockerRoomScores.ts';

const favorite = { key: 'team:nfl:1', name: 'Test team' };
const game = {
  id: 'NFL:123', status: 'LIVE', date: '2026-10-16T00:00:00Z', league: 'NFL',
  away: { score: 14 }, home: { score: 10 },
};

test('No mid-quarter score snapshots are generated', () => {
  assert.deepEqual(completedScoreUpdates(game, favorite), []);
  assert.deepEqual(completedScoreUpdates({ ...game, status: 'UPCOMING' }, favorite), []);
});
test('Completed quarter scores remain exact while the live score changes', () => {
  const completedPeriods = [{ period: 1, awayScore: 7, homeScore: 0 }, { period: 2, awayScore: 7, homeScore: 0 }];
  const updates = completedScoreUpdates({ ...game, completedPeriods }, favorite);
  assert.equal(updates.length, 2);
  assert.equal(updates[0].away.score, 7);
  assert.equal(updates[1].home.score, 0);
  assert.equal(updates[1].period, 'End of Q2');
  assert.notEqual(updates[0].id, updates[1].id);
  assert.equal(updates[0].checkpoint, true);
});
test('Final and overtime checkpoints are stable and independent of favorites', () => {
  const final = { ...game, status: 'FINAL', completedPeriods: [{ period: 4, awayScore: 14, homeScore: 14 }, { period: 5, awayScore: 14, homeScore: 14 }] };
  const updates = completedScoreUpdates(final, favorite);
  assert.equal(updates[1].period, 'End of OT');
  assert.equal(updates.at(-1).status, 'FINAL');
  assert.equal(updates.at(-1).home.score, 10);
  assert.equal(updates.at(-1).id, completedScoreUpdates(final, { ...favorite, key: 'player:1' }).at(-1).id);
});
