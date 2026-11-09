import assert from 'node:assert/strict';
import test from 'node:test';
import { featuredSimulationMinimums, fullPlayerPerformances, isFeaturedSimulationPlayer } from '../supabase/functions/_shared/nflSimulationAccuracy.ts';

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

const receivingRows = () => [
  { stat: 'receivingYards', projected: 100, actual: 60 },
  { stat: 'receptions', projected: 5, actual: 5 },
  { stat: 'receivingTouchdowns', projected: .5, actual: 1 },
].map(row => ({ ...row, playerId: '1', name: 'Receiver', position: 'WR', team: 'AWY', error: Math.abs(row.projected - row.actual) }));
const performanceReport = players => ({ games: [{ eventId: '1', kickoff: '2026-11-08T18:00:00Z', players }], pending: 0, issues: [] });
test('Full performances accept large yardage misses while requiring every inclusive unrounded threshold', () => {
  const rows = receivingRows();
  assert.equal(fullPlayerPerformances(performanceReport(rows)).length, 1);
  for (const [stat, projected, actual] of [
    ['receivingYards', 60, 60], ['receptions', 5, 5], ['receivingTouchdowns', .5, 1],
  ]) {
    const atBoundary = rows.map(row => row.stat === stat ? { ...row, projected, actual } : row);
    assert.equal(fullPlayerPerformances(performanceReport(atBoundary)).length, 1, stat);
    for (const field of ['projected', 'actual']) {
      const below = atBoundary.map(row => row.stat === stat ? { ...row, [field]: row[field] - .001 } : row);
      assert.equal(fullPlayerPerformances(performanceReport(below)).length, 0, `${stat} ${field}`);
    }
  }
});
test('Full performances never combine missing, duplicate, nonfinite or mismatched identities across players, teams or games', () => {
  const rows = receivingRows();
  for (const invalid of [
    rows.slice(0, 2), [...rows, rows[0]],
    rows.map((row, i) => i ? row : { ...row, playerId: '2' }),
    rows.map((row, i) => i ? row : { ...row, team: 'HOM' }),
    rows.map((row, i) => i ? row : { ...row, name: 'Other name' }),
    rows.map((row, i) => i ? row : { ...row, actual: NaN }),
  ]) assert.equal(fullPlayerPerformances(performanceReport(invalid)).length, 0);
  const report = performanceReport(rows.slice(0, 2));
  report.games.push({ ...report.games[0], eventId: '2', players: rows.slice(2) });
  assert.equal(fullPlayerPerformances(report).length, 0);
});
test('Full performances rank actual receiving production, not closeness or a named-player allowlist', () => {
  const rows = receivingRows();
  const higherTD = rows.map(row => ({ ...row, playerId: '2', name: 'Another Receiver',
    actual: row.stat === 'receivingTouchdowns' ? 2 : row.actual }));
  const report = performanceReport([...rows, ...higherTD]);
  assert.deepEqual(fullPlayerPerformances(report).map(row => row.playerId), ['2', '1']);
  report.games[0].players = report.games[0].players.map(row => row.stat === 'receivingYards' ? { ...row, projected: 300 } : row);
  assert.deepEqual(fullPlayerPerformances(report).map(row => row.playerId), ['2', '1']);
});
