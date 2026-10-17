import assert from 'node:assert/strict';
import test from 'node:test';
import { anglePublishError, angleWriteFields, isAngleSource, readAngles, selectAngleSuggestions, suggestedAngleCategory } from '../src/services/theAngle.ts';

const game = { id: 'NFL:123', date: '2026-10-18T17:00:00Z' };
const article = { headline: 'A former team reunion', description: 'A story to review', published: '2026-10-16T12:00:00Z', url: 'https://www.espn.com/nfl/story/123' };
test('News suggests unverified categories, never inventing a historical trend', () => {
  assert.equal(suggestedAngleCategory('A former team reunion'), 'Former team');
  assert.equal(suggestedAngleCategory('A rivalry rematch'), 'Rivalry / rematch');
  assert.equal(suggestedAngleCategory('Career against this opponent'), 'Head-to-head history');
  assert.equal(suggestedAngleCategory('A career milestone'), 'Milestone / comeback');
  assert.equal(suggestedAngleCategory('Team wins its third game'), null);
});
test('Suggestions require safe sources, dated news near the selected game, and deduplicate articles', () => {
  assert.equal(selectAngleSuggestions(game, [article, article]).length, 1);
  for (const change of [{ url: undefined }, { url: 'javascript:alert(1)' }, { published: 'bad' }, { published: '2025-01-01' }, { published: '2026-10-22' }, { headline: 'Routine practice', description: '' }]) {
    assert.deepEqual(selectAngleSuggestions(game, [{ ...article, ...change }]), []);
  }
  assert.deepEqual(selectAngleSuggestions({ ...game, date: 'invalid' }, [article]), []);
  assert.equal(selectAngleSuggestions(game, [article])[0].category, 'Former team');
});
test('Publishing needs editorial context, a counterpoint, a source, and explicit review; a pick is optional', () => {
  const draft = { title: 'The reunion angle', subject: 'Player', narrative: 'Editorial context', evidence: 'Cited evidence', counterpoint: 'Small sample', source_url: article.url, source_label: 'ESPN', reviewed: true };
  assert.equal(anglePublishError(draft), '');
  for (const key of ['title', 'subject', 'narrative', 'evidence', 'counterpoint', 'source_label']) {
    assert.notEqual(anglePublishError({ ...draft, [key]: ' ' }), '');
  }
  assert.notEqual(anglePublishError({ ...draft, reviewed: false }), '');
  assert.notEqual(anglePublishError({ ...draft, source_url: 'data:text/html,test' }), '');
});
test('Sources cannot execute scripts or embed credentials; malformed server rows fail visibly', () => {
  for (const url of ['javascript:alert(1)', 'https://', 'https://user:pass@example.com', 'https://example.com/space here']) assert.equal(isAngleSource(url), false);
  assert.equal(isAngleSource('https://www.espn.com/nfl/'), true);
  assert.deepEqual(readAngles([]), []);
  assert.throws(() => readAngles([{ id: 'bad' }]), /invalid angle data/);
  assert.throws(() => readAngles(null), /invalid angle data/);
});

test('Saves whitelist editable columns and never send server-owned metadata back in updates', () => {
  const payload = angleWriteFields({
    id: 'test', season: 2026, week: 6, revision: 2, created_by: 'author', updated_at: 'server timestamp',
    game_id: 'NFL:123', matchup: 'Away @ Home', kind: 'player', subject: ' Player ', category: 'Former team',
    title: ' Title ', narrative: 'Story', evidence: 'Context', counterpoint: 'Caution', pick: '',
    source_url: ' https://www.espn.com/nfl/ ', source_label: ' ESPN ', reviewed: true, status: 'draft',
  }, 'published');
  assert.equal(payload.subject, 'Player');
  assert.equal(payload.title, 'Title');
  assert.equal(payload.source_url, 'https://www.espn.com/nfl/');
  assert.equal(payload.status, 'published');
  assert.equal(payload.pick, '');
  for (const field of ['id', 'season', 'week', 'revision', 'created_by', 'updated_at']) assert.equal(field in payload, false);
});
