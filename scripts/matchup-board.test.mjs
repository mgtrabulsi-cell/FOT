import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPPRProjections, lastFiveAverage, moveMatchupPick, readMatchupPicks, readPPRProjections } from '../src/services/matchupBoard.ts';

const pick = (id, position) => ({ id, position, name: `Player ${id}`, teamId: '1', gameId: 'NFL:123', headshot: '' });

test('Moves players only within their position without changing other groups', () => {
  const original = [pick('1', 'QB'), pick('2', 'RB'), pick('3', 'QB'), pick('4', 'QB')];
  const next = moveMatchupPick(original, '3', -1);
  assert.deepEqual(next.map((item) => item.id), ['3', '2', '1', '4']);
  assert.deepEqual(original.map((item) => item.id), ['1', '2', '3', '4']);
  assert.strictEqual(moveMatchupPick(original, '1', -1), original);
  assert.strictEqual(moveMatchupPick(original, '4', 1), original);
  assert.strictEqual(moveMatchupPick(original, 'missing', 1), original);
});

test('Published selection parser preserves ordering and rejects malformed players', () => {
  const picks = [pick('4', 'TE'), pick('2', 'RB')];
  assert.deepEqual(readMatchupPicks(picks), picks);
  assert.throws(() => readMatchupPicks({}));
  assert.throws(() => readMatchupPicks([{ ...pick('1', 'QB'), position: 'K' }]));
});

test('Average uses the five most recent games before kickoff, with zero preserved', () => {
  const recentGames = Array.from({ length: 8 }, (_, i) => ({
    gameId: String(i), date: `2026-09-${String(i + 1).padStart(2, '0')}T17:00:00Z`,
    stats: { passingYards: i * 10 },
  }));
  const game = { eventId: '7', date: '2026-09-08T17:00:00Z' };
  assert.deepEqual(lastFiveAverage({ recentGames }, 'QB', game), { average: 40, games: 5 });
  assert.equal(lastFiveAverage({ recentGames: [{ ...recentGames[0], stats: { rushingYards: 0 } }] }, 'RB', game).average, 0);
  assert.equal(lastFiveAverage(undefined, 'TE', game).average, null);
});

test('Missing stats do not become zeros or pull in older games', () => {
  const recentGames = Array.from({ length: 6 }, (_, i) => ({
    gameId: String(i), date: `2026-09-${String(i + 1).padStart(2, '0')}T17:00:00Z`,
    stats: i === 5 ? {} : { receivingYards: 40 },
  }));
  assert.deepEqual(lastFiveAverage({ recentGames }, 'WR', { eventId: 'next', date: '2026-10-01T17:00:00Z' }), { average: null, games: 5 });
});

test('Projection requires the exact season/week, projected source and weekly split', () => {
  const base = { seasonId: 2026, scoringPeriodId: 6, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 17.8 };
  const rows = [
    { ...base, seasonId: 2025, appliedTotal: 99 },
    { ...base, scoringPeriodId: 5, appliedTotal: 88 },
    { ...base, statSourceId: 0, appliedTotal: 77 },
    { ...base, statSplitTypeId: 0, appliedTotal: 66 },
    base,
  ];
  const payload = { players: [{ player: { id: 123, stats: rows } }, { player: { id: 456, stats: [{ ...base, appliedTotal: 0 }] } }] };
  assert.deepEqual([...readPPRProjections(payload, 2026, 6)], [['123', 17.8], ['456', 0]]);
  assert.equal(readPPRProjections(payload, 2026, 7).size, 0);
  assert.throws(() => readPPRProjections({}, 2026, 6));
});

test('Projection requests target selected players with the required limit sort and verify PPR', async (t) => {
  const calls = [];
  let scoringItems = [{ statId: 53, points: 1 }];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        settings: { scoringSettings: { scoringItems } },
        players: [{ player: { id: 3139477, stats: [{ seasonId: 2026, scoringPeriodId: 6, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 21.3 }] } }],
      }),
    };
  });
  const signal = new AbortController().signal;
  assert.equal((await fetchPPRProjections(2026, 6, [], signal)).size, 0);
  assert.equal(calls.length, 0);
  const result = await fetchPPRProjections(2026, 6, ['3139477', '3918298'], signal);
  assert.equal(result.get('3139477'), 21.3);
  assert.equal(result.has('3918298'), false);
  assert.match(calls[0].url, /seasons\/2026\/.*scoringPeriodId=6$/);
  const filter = JSON.parse(calls[0].options.headers['X-Fantasy-Filter']);
  assert.deepEqual(filter.players.filterIds.value, [3139477, 3918298]);
  assert.equal(filter.players.limit, 2);
  assert.equal(filter.players.sortPercOwned.sortPriority, 1);
  assert.equal(calls[0].options.signal, signal);
  scoringItems = [{ statId: 53, points: 0.5 }];
  await assert.rejects(fetchPPRProjections(2026, 6, ['3139477'], signal), /PPR scoring could not be verified/);
});
