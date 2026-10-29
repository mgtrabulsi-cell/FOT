import assert from 'node:assert/strict';
import test from 'node:test';
import { gamewaireAngleDraft } from '../src/services/gamewaireAngle.ts';
import { anglePublishError, angleWriteFields, readAngles } from '../src/services/theAngle.ts';
const pick = { key: 'one', sport: 'NFL', subject: 'Receiver', market: 'player_reception_yds', side: 'Over', line: 55.5,
  american: -110, away: 'Away', home: 'Home', samples: [], seasonAverage: 60, isGameLean: false };
test('Manual post contains ordered published selections and reasoning, with exact subject and no duplicate Angle tracking', () => {
  const second = { ...pick, key: 'two', market: 'spreads', subject: 'Home', side: 'Home', line: 3.5, american: 105, isGameLean: true };
  const draft = gamewaireAngleDraft([second, pick], 2026, 8);
  assert.equal(draft.title, 'GamewAIre best bets');
  assert.match(draft.narrative, /^#1 Game Lean: Home \+3.5 \(\+105\)/);
  assert.match(draft.narrative, /#2 Top Pick: Receiver - Over 55.5 Receiving yards \(-110\)/);
  assert.match(draft.narrative, /Away @ Home/);
  assert.match(draft.evidence, /Receiver averages 60.0 receiving yards/);
  assert.equal(draft.status, 'draft'); assert.equal(draft.reviewed, false);
  assert.equal(draft.post_to_x, false); assert.deepEqual(draft.themes, ['betting']);
  assert.deepEqual(draft.picks, []);
  assert.equal(draft.game_id, 'COMBO:0');
  assert.ok(anglePublishError(draft), 'Owner review is still required');
  assert.equal(anglePublishError({ ...draft, reviewed: true }), '');
  assert.equal(angleWriteFields(draft, 'draft').status, 'draft');
  assert.equal(readAngles([{ ...draft, revision: 1 }]).length, 1);
});
test('No empty post, unknown week or silently truncated oversized post can be created', () => {
  assert.throws(() => gamewaireAngleDraft([], 2026, 8), /Choose published/);
  assert.throws(() => gamewaireAngleDraft([pick], null, 8), /still loading/);
  assert.throws(() => gamewaireAngleDraft(Array.from({ length: 50 }, () => pick), 2026, 8), /text limit/);
});
