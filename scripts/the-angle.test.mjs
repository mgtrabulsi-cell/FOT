import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { newestAnglesFirst } from '../src/services/theAngle.ts';
import { angleReviewKey, readAngleReviews, settledAngleReviews } from '../src/services/angleReviews.ts';
import { readLivewirePosts } from '../src/services/livewirePosts.ts';
import { angleMediaAccept, angleMediaError, isPostVideo, postMediaExtensions } from '../src/services/postMedia.ts';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { anglePicks, angleSport, angleSportGameId, angleSportRecords, angleThemes, angleVisibleInWeek, publishedAnglePicks, readAnglePicks, anglePublishError, angleWriteFields, birthdayNearGame, isAngleSource, readAngles, readPlayerBirthdays, selectAngleSuggestions, suggestedAngleCategory } from '../src/services/theAngle.ts';

test('Angle media accepts supported photos/videos with exact size limits and rejects empty/unsupported files', () => {
  for (const type of ['video/mp4', 'video/webm', 'video/quicktime']) {
    assert.ok(angleMediaAccept.includes(type));
    assert.equal(angleMediaError({ type, size: 50 * 1024 * 1024 }), '');
    assert.match(angleMediaError({ type, size: 50 * 1024 * 1024 + 1 }), /50 MB/);
    assert.ok(isPostVideo(`author/file.${postMediaExtensions[type]}`));
  }
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    assert.equal(angleMediaError({ type, size: 5 * 1024 * 1024 }), '');
    assert.match(angleMediaError({ type, size: 5 * 1024 * 1024 + 1 }), /5 MB/);
    assert.equal(isPostVideo(`author/file.${postMediaExtensions[type]}`), false);
  }
  assert.equal(isPostVideo('author/video.MP4'), true);
  assert.match(angleMediaError({ type: 'video/mp4', size: 0 }), /empty/);
  assert.match(angleMediaError({ type: 'text/html', size: 100 }), /Use JPG/);
  assert.match(angleMediaError({ type: 'video/avi', size: 100 }), /Use JPG/);
});

test('Mixed published galleries render controlled inline videos and retain photo enlargement', async () => {
  const transpile = (name) => ts.transpileModule(readFileSync(new URL(`../src/${name}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replace(/from ['"]react['"]/g, `from '${import.meta.resolve('react')}'`)
    .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`);
  const videoCode = transpile('PostVideo');
  const videoUrl = `data:text/javascript;base64,${Buffer.from(videoCode).toString('base64')}`;
  const galleryCode = transpile('PostGallery')
    .replace(/import OfflineImage from [^;]+;/, `const OfflineImage = (props) => _jsx('img', props);`)
    .replace(/import PostPhotoViewer from [^;]+;/, 'const PostPhotoViewer = () => null;')
    .replace(/from ['"]\.\/PostVideo['"]/g, `from '${videoUrl}'`)
    .replace(/from ['"]\.\/services\/postMedia['"]/g, `from '${new URL('../src/services/postMedia.ts', import.meta.url)}'`)
    .replace(/from ['"]\.\/services\/postImages['"]/g, `from '${new URL('../src/services/postImages.ts', import.meta.url)}'`)
    .replace(/import \{ supabase \} from [^;]+;/, `const supabase = { storage: { from: () => ({ getPublicUrl: (path) => ({ data: { publicUrl: 'https://example.test/' + path } }) }) } };`);
  const { default: Gallery } = await import(`data:text/javascript;base64,${Buffer.from(galleryCode).toString('base64')}`);
  const html = renderToStaticMarkup(createElement(Gallery, { paths: ['user/a.mp4', 'user/b.png', 'user/c.mov', 'user/d.webm'], title: 'Analysis' }));
  assert.equal((html.match(/<video /g) ?? []).length, 3);
  assert.equal((html.match(/controls=""/g) ?? []).length, 3);
  assert.equal((html.match(/playsinline=""/g) ?? []).length, 3);
  assert.equal((html.match(/preload="none"/g) ?? []).length, 3, 'Feed videos wait for playback instead of competing with posts and scores');
  assert.equal((html.match(/Open original video/g) ?? []).length, 3);
  assert.match(html, /Enlarge photo 2 for Analysis/);
  assert.doesNotMatch(html, /autoplay/);
});

const reviewOriginal = {
  id: 'a8541111-1111-4111-8111-111111111121', season: 2026, week: 7, game_id: 'NBA:123', matchup: 'Away @ Home',
  kind: 'team', subject: '', category: 'Other', title: 'Original pick', narrative: 'Original analysis', evidence: '', counterpoint: '',
  pick: '', source_url: '', source_label: '', reviewed: true, revision: 1, status: 'published',
  picks: [
    { id: 'a8541111-1111-4111-8111-111111111131', text: 'Player over 25 points', category: 'straight', result: 'hit' },
    { id: 'a8541111-1111-4111-8111-111111111132', text: 'Team ML\nPlayer assists', category: 'parlay', result: 'miss' },
    { id: 'a8541111-1111-4111-8111-111111111133', text: 'Pending pick', category: 'sprinkle', result: 'pending' },
  ],
};

test('Review candidates include only existing published settled picks across weeks/sports, never self references', () => {
  const older = { ...reviewOriginal, id: 'a8541111-1111-4111-8111-111111111122', season: 2025, week: 2, game_id: 'NFL:456' };
  const reviews = settledAngleReviews([reviewOriginal, older, { ...older, status: 'draft' }], reviewOriginal.id);
  assert.equal(reviews.length, 2);
  assert.ok(reviews.every((pick) => pick.story_id === older.id && pick.week === 2 && pick.game_id === 'NFL:456'));
  assert.equal(reviews[1].text, 'Team ML\nPlayer assists');
  assert.equal(reviews[1].category, 'parlay');
  assert.equal(reviews[1].result, 'miss');
  assert.equal(reviewOriginal.picks.length, 3);
});

test('Review snapshots survive write/read and LIVEWIRE, without new picks or record entries', () => {
  const reviews = settledAngleReviews([reviewOriginal]);
  const review = { ...reviewOriginal, id: 'a8541111-1111-4111-8111-111111111122', pick: '', picks: [], review_picks: reviews };
  const fields = angleWriteFields(review, 'published');
  assert.deepEqual(fields.review_picks, reviews);
  assert.deepEqual(fields.picks, []);
  assert.equal(fields.pick, '');
  const [saved] = readAngles([{ ...review, ...fields }]);
  assert.deepEqual(saved.review_picks, reviews);
  assert.deepEqual(publishedAnglePicks([saved]), []);
  for (const category of ['straight', 'parlay', 'sprinkle']) {
    assert.deepEqual(angleSportRecords([reviewOriginal, saved], category), angleSportRecords([reviewOriginal], category));
  }
  const [post] = readLivewirePosts([{ id: 'mirror', author_id: null, author_name: 'Analyst', title: 'Review',
    body: 'Review analysis', source_url: null, angle_id: review.id, admin_picks: [], review_picks: reviews,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }]);
  assert.deepEqual(post.review_picks, reviews);
});

test('Malformed, pending, duplicate and oversized review snapshots fail explicitly', () => {
  const [pick] = settledAngleReviews([reviewOriginal]);
  assert.deepEqual(readAngleReviews([pick]), [pick]);
  const twenty = Array.from({ length: 20 }, (_, index) => ({ ...pick,
    pick_id: `a8541111-1111-4111-8111-${String(index).padStart(12, '0')}` }));
  assert.equal(readAngleReviews(twenty).length, 20);
  assert.throws(() => readAngleReviews([...twenty, { ...pick, pick_id: 'a8541111-1111-4111-8111-999999999999' }]), /settled-pick reviews/);
  assert.equal(angleReviewKey({ ...pick, story_id: pick.story_id.toUpperCase() }), angleReviewKey(pick));
  for (const invalid of [null, {}, [{ ...pick, result: 'pending' }], [{ ...pick, text: '' }],
    [{ ...pick, text: 'x'.repeat(501) }], [{ ...pick, story_id: 'invalid' }], [{ ...pick, category: 'invalid' }],
    [pick, { ...pick, story_id: pick.story_id.toUpperCase() }], Array(21).fill(pick)]) {
    assert.throws(() => readAngleReviews(invalid), /settled-pick reviews/);
    assert.throws(() => readAngles([{ ...reviewOriginal, review_picks: invalid }]), /settled-pick reviews/);
  }
});

test('Newest publications lead regardless of pending picks or later edits, without mutating the feed', () => {
  const stories = [
    { id: 'older-pending', published_at: '2026-10-25T18:00:00Z', updated_at: '2026-10-28T18:00:00Z', pick: 'Pending pick' },
    { id: 'newest-news', published_at: '2026-10-27T18:00:00Z', pick: '' },
    { id: 'missing-date', published_at: null },
    { id: 'recent-settled', published_at: '2026-10-26T18:00:00Z', picks: [{ result: 'hit' }] },
    { id: 'same-date', published_at: '2026-10-26T18:00:00Z' },
  ];
  const original = [...stories];
  assert.deepEqual(newestAnglesFirst(stories).map((story) => story.id),
    ['newest-news', 'recent-settled', 'same-date', 'older-pending', 'missing-date']);
  assert.deepEqual(stories, original, 'Does not mutate the fetched feed');
  assert.deepEqual(newestAnglesFirst([]), []);
});

test('Angle feeds use newest-first ordering, with an explicitly linked story still pinned first', () => {
  const source = readFileSync(new URL('../src/TheAngle.tsx', import.meta.url), 'utf8');
  assert.match(source, /\.\.\.\(visibleLinked \? \[visibleLinked\] : \[\]\),\s*\.\.\.newestAnglesFirst\(feedStories\)/);
  assert.match(source, /row\.id !== visibleLinked\?\.id/);
});

test('Multiline parlay legs survive save/read as one pick, one grade and one record entry', () => {
  const text = 'Pacers ML\nSpurs +5.5\nRockets team total over 110.5';
  const pick = { id: '11111111-1111-4111-8111-111111111111', text, category: 'parlay', result: 'hit' };
  const story = { id: 'parlay-story', game_id: 'COMBO:0', matchup: 'NBA', kind: 'team', subject: '',
    category: 'Other', title: 'Three-leg parlay', narrative: 'Editorial opinion', evidence: '', counterpoint: '',
    pick: text, picks: [pick], source_url: '', source_label: '', reviewed: true,
    season: 2026, week: 7, revision: 1, status: 'published' };
  const saved = angleWriteFields(story, 'published');
  const [restored] = readAngles(JSON.parse(JSON.stringify([{ ...story, ...saved }])));
  assert.equal(restored.picks.length, 1);
  assert.equal(restored.picks[0].text, text);
  assert.equal(restored.picks[0].id, pick.id);
  assert.equal(publishedAnglePicks([restored]).length, 1);
  const record = angleSportRecords([restored], 'parlay').find((sport) => sport.key === 'COMBO');
  assert.equal(record.wins, 1);
  assert.equal(record.losses, 0);
  const source = readFileSync(new URL('../src/TheAngle.tsx', import.meta.url), 'utf8');
  assert.match(source, /rows=\{pickCategory\(pick\) === 'parlay' \? 5 : 2\}/);
  assert.match(source, /Press Enter for each leg/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.angle-pick p \{ white-space: pre-wrap;/);
  assert.match(css, /textarea\.angle-parlay-input \{ min-height: 130px;/);
});

test('Pick editor keeps type and add controls compact while the play uses remaining desktop width', () => {
  const source = readFileSync(new URL('../src/TheAngle.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(source, /label className="angle-pick-type-field"/);
  assert.match(source, /label className="angle-pick-play-field"/);
  assert.match(css, /\.angle-pick-type-field \{ width: 132px; max-width: 100%; \}/);
  assert.match(css, /grid-template-columns: 132px minmax\(0, 1fr\) auto/);
  assert.match(css, /\.angle-pick-play-field \{ grid-column: 2; grid-row: 1; \}/);
  assert.match(css, /\.angle-parlay-help \{ grid-column: 2 \/ -1; \}/);
  assert.match(css, /\.angle-pick-editor > button \{ justify-self: start; width: auto;/);
});

test('Non-NFL Angle stories cross weeks for exactly 168 hours, then stay in their original week', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const story = { season: 2026, week: 7, section: 'angle', status: 'published', game_id: 'NBA:0', published_at: new Date(now - 1000).toISOString() };
  const visible = (changes = {}, season = 2026, week = 8) => angleVisibleInWeek({ ...story, ...changes }, season, week, now);
  for (const sport of ['NBA', 'NHL', 'UCL', 'SOCCER', 'CFB', 'UFC']) assert.equal(visible({ game_id: `${sport}:0` }), true);
  assert.equal(visible({}, 2025, 1), true, 'Includes other selected seasons');
  assert.equal(visible({ published_at: new Date(now).toISOString() }), true);
  assert.equal(visible({ published_at: new Date(now - 168 * 3600000 + 1).toISOString() }), true);
  assert.equal(visible({ published_at: new Date(now - 168 * 3600000).toISOString() }), false);
  assert.equal(visible({ published_at: new Date(now - 169 * 3600000).toISOString() }, 2026, 7), true);
  for (const changes of [
    { game_id: 'NFL:123' }, { game_id: 'UNKNOWN:0' }, { section: 'news' }, { status: 'draft' },
    { published_at: null }, { published_at: 'invalid' }, { published_at: new Date(now + 1).toISOString() },
  ]) assert.equal(visible(changes), false);
  assert.equal(visible({ game_id: 'NFL:123' }, 2026, 7), true);
  assert.equal(visible({ section: 'news' }, 2026, 7), true);
});

const game = { id: 'NFL:123', date: '2026-10-18T17:00:00Z' };
const article = { headline: 'A former team reunion', description: 'A story to review', published: '2026-10-16T12:00:00Z', url: 'https://www.espn.com/nfl/story/123' };
test('General NFL, Fantasy and News posts retain their labels, independent themes, and selected week', () => {
  for (const section of ['angle', 'news']) {
    for (const [game_id, matchup] of [['NFL:0', 'NFL'], ['FANTASY:0', 'Fantasy'], ['NEWS:0', 'News']]) {
      const draft = { id: 'general', season: 2026, week: 7, revision: 1, section,
        game_id, matchup, kind: 'team', subject: '', category: 'Other', title: 'General update',
        narrative: 'Editorial context', evidence: '', counterpoint: '', pick: '', source_url: '',
        source_label: '', reviewed: true, themes: ['news'], news_types: ['news'] };
      assert.equal(anglePublishError(draft), '');
      const fields = angleWriteFields(draft, 'published');
      assert.equal(fields.game_id, game_id);
      assert.equal(fields.matchup, matchup);
      assert.deepEqual(fields.themes, ['news']);
      assert.equal(fields.post_to_x, false);
      const [restored] = readAngles([{ ...draft, ...fields }]);
      assert.equal(restored.matchup, matchup);
      assert.equal(angleVisibleInWeek(restored, 2026, 7), true);
      assert.equal(angleVisibleInWeek({ ...restored, published_at: new Date().toISOString() }, 2026, 8), false);
    }
  }
});
test('Story publishing defaults X off for new drafts and preserves explicit choices', () => {
  const fields = { game_id: 'NFL:123', matchup: 'Test', kind: 'team', subject: 'Test', category: 'Other',
    title: 'Headline', narrative: 'Text', evidence: '', counterpoint: '', pick: '', source_url: '', source_label: '', reviewed: true };
  assert.equal(angleWriteFields(fields, 'draft').post_to_x, false);
  assert.equal(angleWriteFields({ ...fields, post_to_x: true }, 'published').post_to_x, true);
  assert.equal(angleWriteFields({ ...fields, post_to_x: false }, 'published').post_to_x, false);
});
test('News suggests unverified categories, never inventing a historical trend', () => {
  assert.equal(suggestedAngleCategory('A former team reunion'), 'Former team');
  assert.equal(suggestedAngleCategory('A rivalry rematch'), 'Rivalry / rematch');
  assert.equal(suggestedAngleCategory('Career against this opponent'), 'Head-to-head history');
  assert.equal(suggestedAngleCategory('A career milestone'), 'Milestone / comeback');
  assert.equal(suggestedAngleCategory('Team wins its third game'), null);
  assert.equal(suggestedAngleCategory('A player celebrates his birthday'), 'Birthday');
  assert.equal(suggestedAngleCategory('A player welcomes his first child'), 'Public life event');
  assert.equal(suggestedAngleCategory('A player became a father'), 'Public life event');
  assert.equal(suggestedAngleCategory('A team welcomes a new coach'), null);
});

test('Birthday leads use Eastern game dates, handle year boundaries and leap days without invented dates', () => {
  assert.deepEqual(birthdayNearGame('1996-10-18', '2026-10-19T00:20:00Z'), { date: '2026-10-18', onGameDay: true });
  assert.deepEqual(birthdayNearGame('1996-10-15', '2026-10-18T17:00:00Z'), { date: '2026-10-15', onGameDay: false });
  assert.equal(birthdayNearGame('1996-10-14', '2026-10-18T17:00:00Z'), null);
  assert.deepEqual(birthdayNearGame('1996-12-31', '2027-01-02T17:00:00Z'), { date: '2026-12-31', onGameDay: false });
  assert.equal(birthdayNearGame('1996-02-29', '2027-03-01T17:00:00Z'), null);
  assert.deepEqual(birthdayNearGame('1996-02-29', '2028-02-29T17:00:00Z'), { date: '2028-02-29', onGameDay: true });
  assert.equal(birthdayNearGame('invalid', game.date), null);
});
test('Birthdays require exact player IDs, Wikidata identity links, valid full dates, and reject conflicts', () => {
  const binding = { espn: { value: '123' }, person: { value: 'http://www.wikidata.org/entity/Q123' }, dob: { value: '1996-10-18T00:00:00Z' } };
  const response = (bindings) => ({ results: { bindings } });
  assert.deepEqual(readPlayerBirthdays(response([binding, binding])), [{ playerId: '123', dateOfBirth: '1996-10-18', sourceUrl: 'https://www.wikidata.org/entity/Q123' }]);
  assert.throws(() => readPlayerBirthdays(response([{ ...binding, dob: { value: '1996-02-31T00:00:00Z' } }])), /invalid birth date/);
  assert.throws(() => readPlayerBirthdays(response([binding, { ...binding, dob: { value: '1996-10-19T00:00:00Z' } }])), /Conflicting/);
  const warnings = [];
  const unambiguous = { ...binding, espn: { value: '456' }, person: { value: 'http://www.wikidata.org/entity/Q456' } };
  const partial = readPlayerBirthdays(response([binding, { ...binding, dob: { value: '1996-10-19T00:00:00Z' } }, unambiguous]), (warning) => warnings.push(warning));
  assert.deepEqual(partial.map((row) => row.playerId), ['456']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /123/);
  assert.throws(() => readPlayerBirthdays(response([{ ...binding, person: { value: 'https://untrusted.test/Q123' } }])), /invalid identity/);
  assert.throws(() => readPlayerBirthdays({}), /invalid data/);
});
test('Suggestions require safe sources, dated news near the selected game, and deduplicate articles', () => {
  assert.equal(selectAngleSuggestions(game, [article, article]).length, 1);
  for (const change of [{ url: undefined }, { url: 'javascript:alert(1)' }, { published: 'bad' }, { published: '2025-01-01' }, { published: '2026-10-22' }, { headline: 'Routine practice', description: '' }]) {
    assert.deepEqual(selectAngleSuggestions(game, [{ ...article, ...change }]), []);
  }
  assert.deepEqual(selectAngleSuggestions({ ...game, date: 'invalid' }, [article]), []);
  assert.equal(selectAngleSuggestions(game, [article])[0].category, 'Former team');
});
test('Publishing needs a headline, storyline, and explicit review; other text and a pick are optional', () => {
  const draft = { title: 'The reunion angle', subject: 'Player', narrative: 'Editorial context', evidence: 'Cited evidence', counterpoint: 'Small sample', source_url: article.url, source_label: 'ESPN', reviewed: true };
  assert.equal(anglePublishError(draft), '');
  for (const key of ['title', 'narrative']) {
    assert.notEqual(anglePublishError({ ...draft, [key]: ' ' }), '');
  }
  assert.notEqual(anglePublishError({ ...draft, reviewed: false }), '');
  assert.notEqual(anglePublishError({ ...draft, source_url: 'data:text/html,test' }), '');
  assert.equal(anglePublishError({ ...draft, subject: '', evidence: '', counterpoint: '', source_label: '', source_url: '' }), '');
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

test('Storyline photos survive serialization and malformed attachment arrays fail explicitly', () => {
  const story = { id: 'test', season: 2026, week: 6, revision: 1, game_id: 'NFL:123', matchup: 'Away @ Home',
    kind: 'team', subject: '', category: 'Other', title: 'Title', narrative: 'Story', evidence: '', counterpoint: '',
    pick: 'Exact pick', source_url: '', source_label: '', reviewed: true, status: 'published', image_paths: ['user/one.png', 'user/two.png'] };
  assert.deepEqual(angleWriteFields(story, 'published').image_paths, story.image_paths);
  assert.deepEqual(readAngles([story])[0].image_paths, story.image_paths);
  for (const image_paths of [null, 'bad', [123], Array(5).fill('user/photo.png')]) assert.throws(() => readAngles([{ ...story, image_paths }]), /invalid angle data/);
});

test('Separate picks preserve IDs and independent grades, and reject malformed results', () => {
  const picks = [
    { id: 'a8541111-1111-4111-8111-111111111131', text: 'Team ML', result: 'hit' },
    { id: 'a8541111-1111-4111-8111-111111111132', text: 'Player TD', result: 'miss' },
  ];
  assert.deepEqual(readAnglePicks(picks), picks);
  assert.deepEqual(anglePicks({ id: 'legacy', pick: 'Combined old pick' }), [{ id: 'legacy', text: 'Combined old pick', result: 'pending' }]);
  assert.deepEqual(anglePicks({ id: 'new', pick: 'Old fallback', picks: [] }), []);
  for (const invalid of [null, {}, [picks[0], picks[0]], [{ ...picks[0], result: 'win' }], [{ ...picks[0], category: 'bad' }], [{ ...picks[0], category: null }], [{ ...picks[0], text: '' }], [{ ...picks[0], id: 'invalid' }]]) {
    assert.throws(() => readAnglePicks(invalid), /invalid admin picks/);
  }
  const story = { game_id: 'NFL:123', matchup: 'A @ B', kind: 'team', subject: '', category: 'Other',
    title: 'Story', narrative: 'Story', evidence: '', counterpoint: '', pick: 'Old', source_url: '', source_label: '',
    reviewed: true, picks: [...picks, { id: 'a8541111-1111-4111-8111-111111111133', text: ' ', result: 'pending' }] };
  const saved = angleWriteFields(story, 'published');
  assert.deepEqual(saved.picks, picks);
  assert.equal(saved.pick, 'Team ML');
  assert.equal('published_at' in saved, false);
});

test('Pick categories survive saves and reads, with independent records and no sprinkle results counted', () => {
  const picks = ['straight', 'parlay', 'sprinkle'].flatMap((category, categoryIndex) =>
    ['hit', 'miss', 'pending'].map((result, resultIndex) => ({
      id: `a8541111-1111-4111-8111-1111111111${categoryIndex}${resultIndex}`,
      text: `${category} ${result}`, result, category,
    })));
  assert.deepEqual(readAnglePicks(picks), picks);
  const story = { game_id: 'NFL:123', matchup: 'A @ B', kind: 'team', subject: '', category: 'Other',
    title: 'Story', narrative: 'Story', evidence: '', counterpoint: '', pick: '', source_url: '', source_label: '',
    reviewed: true, status: 'published', picks };
  assert.deepEqual(angleWriteFields(story, 'published').picks, picks);
  for (const category of ['straight', 'parlay']) {
    const record = angleSportRecords([story], category).find((sport) => sport.key === 'NFL');
    assert.equal(record.wins, 1);
    assert.equal(record.losses, 1);
  }
  assert.equal(publishedAnglePicks([story]).length, 9, 'Sprinkles remain public without entering either record');
  const changed = { ...story, picks: picks.map((pick) => pick.category === 'straight' ? { ...pick, category: 'sprinkle' } : pick) };
  assert.equal(angleSportRecords([changed])[0].wins, 0);
  assert.equal(angleSportRecords([changed], 'parlay')[0].wins, 1);
});

test('Results include every published Admin pick as a separate item without splitting or duplicating text', () => {
  const picks = [
    { id: 'a8541111-1111-4111-8111-111111111131', text: 'Team ML', result: 'pending' },
    { id: 'a8541111-1111-4111-8111-111111111132', text: 'Player TD', result: 'hit' },
  ];
  const first = { id: 'first', status: 'published', picks, pick: 'Team ML', week: 7 };
  const legacy = { id: 'legacy', status: 'published', pick: 'Keep this\ncombined pick', week: 6 };
  const rows = [
    first,
    { ...first, id: 'draft', status: 'draft' },
    { ...first, id: 'empty', picks: [], pick: '' },
    legacy,
  ];
  assert.deepEqual(publishedAnglePicks(rows), [
    { story: first, pick: picks[0] },
    { story: first, pick: picks[1] },
    { story: legacy, pick: { id: 'legacy', text: legacy.pick, result: 'pending' } },
  ]);
  assert.equal(publishedAnglePicks(rows.filter((story) => story.id !== 'first')).length, 1);
  assert.deepEqual(publishedAnglePicks([]), []);
});

test('Angle sports map game IDs to labels and emoji, defaulting to NFL', () => {
  assert.equal(angleSport('NFL:123').key, 'NFL');
  assert.equal(angleSport(angleSportGameId('NBA')).label, 'NBA');
  assert.equal(angleSport('NHL:0').emoji, '\u{1F3D2}');
  assert.equal(angleSport('SOCCER:0').label, 'Soccer');
  assert.equal(angleSport('UCL:0').key, 'UCL');
  assert.equal(angleSport(angleSportGameId('COMBO')).label, 'Combo');
  assert.equal(angleSport(angleSportGameId('CFB')).label, 'CFB');
  assert.equal(angleSport(angleSportGameId('UFC')).label, 'UFC');
  assert.equal(anglePublishError({ title: 'T', narrative: 'N', subject: '', evidence: '', counterpoint: '', source_url: '', source_label: '', reviewed: true, matchup: ' ' }), 'Add the matchup before saving.');
  assert.equal(angleWriteFields({ game_id: 'NBA:0', matchup: ' Lakers @ Celtics ', kind: 'team', subject: '', category: 'Other', title: 'T', narrative: 'N', evidence: '', counterpoint: '', pick: '', source_url: '', source_label: '', reviewed: true }, 'draft').matchup, 'Lakers @ Celtics');
});

test('Combo parlays count only once in Combo parlay records and use the seven-day feed window', () => {
  const now = Date.parse('2026-10-23T15:00:00Z');
  const story = { id: 'combo', game_id: 'COMBO:0', season: 2026, week: 7, status: 'published',
    section: 'angle', published_at: new Date(now - 1000).toISOString(), pick: '',
    picks: [{ id: 'parlay', text: 'NBA + NFL + NHL three-leg parlay', category: 'parlay', result: 'hit' }] };
  const records = angleSportRecords([story], 'parlay');
  assert.equal(records.find((sport) => sport.key === 'COMBO').wins, 1);
  assert.ok(records.filter((sport) => sport.key !== 'COMBO').every((sport) => sport.wins === 0 && sport.losses === 0));
  assert.ok(angleSportRecords([story]).every((sport) => sport.wins === 0 && sport.losses === 0));
  assert.equal(angleVisibleInWeek(story, 2026, 8, now), true);
  story.published_at = new Date(now - 168 * 60 * 60 * 1000).toISOString();
  assert.equal(angleVisibleInWeek(story, 2026, 8, now), false);
  assert.equal(angleVisibleInWeek(story, 2026, 7, now), true);
});

test('Fantasy News posts require a type and keep tags out of angles', () => {
  const base = { title: 'T', narrative: 'N', subject: '', evidence: '', counterpoint: '', source_url: '', source_label: '', reviewed: true };
  assert.equal(anglePublishError({ ...base, section: 'news', news_types: [] }), 'Choose Injuries, News, or both before publishing.');
  assert.equal(anglePublishError({ ...base, section: 'news', news_types: ['injury'] }), '');
  assert.equal(anglePublishError(base), '');
  const fields = { game_id: 'NFL:1', matchup: 'A @ B', kind: 'player', subject: '', category: 'Other', title: 'T', narrative: 'N', evidence: '', counterpoint: '', pick: '', source_url: '', source_label: '', reviewed: true };
  assert.deepEqual(angleWriteFields({ ...fields, section: 'news', news_types: ['news', 'injury', 'news'] }, 'draft').news_types, ['news', 'injury']);
  assert.deepEqual(angleWriteFields({ ...fields, news_types: ['news'] }, 'draft').news_types, []);
  assert.equal('section' in angleWriteFields({ ...fields, section: 'news' }, 'draft'), false);
  const row = { id: '11111111-1111-4111-8111-111111111111', season: 2026, week: 1, revision: 1, status: 'published', ...fields };
  assert.equal(readAngles([{ ...row, section: 'news', news_types: ['injury'] }]).length, 1);
  assert.throws(() => readAngles([{ ...row, section: 'other' }]));
  assert.throws(() => readAngles([{ ...row, section: 'news', news_types: ['rumor'] }]));
});

test('Sport records count individual published Hit and Missed picks across weeks and sections, not pending or drafts', () => {
  const story = (id, game_id, results, extra = {}) => ({
    id, game_id, status: 'published', pick: '', week: 7,
    picks: results.map((result, index) => ({ id: `${id}-${index}`, text: `Pick ${index}`, result })),
    ...extra,
  });
  const rows = [
    story('nfl', 'NFL:123', ['hit', 'miss', 'pending', 'hit']),
    story('past', 'NFL:456', ['miss'], { week: 1, season: 2025 }),
    story('nba', 'NBA:0', ['hit', 'miss']),
    story('nhl', 'NHL:0', ['miss', 'miss']),
    story('ucl', 'UCL:0', ['hit']),
    story('soccer', 'SOCCER:0', ['miss', 'hit'], { section: 'news' }),
    story('private', 'NFL:789', ['hit', 'miss'], { status: 'draft' }),
    { id: 'legacy', game_id: 'NFL:999', status: 'published', pick: 'Ungraded legacy pick' },
  ];
  const records = angleSportRecords(rows);
  assert.deepEqual(records.map(({ key, wins, losses }) => ({ key, wins, losses })), [
    { key: 'NFL', wins: 2, losses: 2 },
    { key: 'NBA', wins: 1, losses: 1 },
    { key: 'NHL', wins: 0, losses: 2 },
    { key: 'UCL', wins: 1, losses: 0 },
    { key: 'SOCCER', wins: 1, losses: 1 },
    { key: 'CFB', wins: 0, losses: 0 },
    { key: 'UFC', wins: 0, losses: 0 },
    { key: 'COMBO', wins: 0, losses: 0 },
  ]);
  assert.equal(rows[0].picks[0].result, 'hit');
  assert.deepEqual(angleSportRecords(rows), records);
  assert.ok(angleSportRecords([]).every((sport) => sport.wins === 0 && sport.losses === 0));
  assert.deepEqual(angleSportRecords([]).map((sport) => sport.label), ['NFL', 'NBA', 'NHL', 'UCL', 'Soccer', 'CFB', 'UFC', 'Combo']);
});

test('Regrading, resetting, removing and unpublishing picks recompute records without double counting', () => {
  const row = { id: 'story', game_id: 'NBA:0', status: 'published', pick: '', picks: [
    { id: 'one', text: 'First', result: 'pending' },
    { id: 'two', text: 'Second', result: 'miss' },
  ] };
  const record = (story) => {
    const { wins, losses } = angleSportRecords([story]).find((sport) => sport.key === 'NBA');
    return { wins, losses };
  };
  assert.deepEqual(record(row), { wins: 0, losses: 1 });
  row.picks[0].result = 'hit';
  assert.deepEqual(record(row), { wins: 1, losses: 1 });
  assert.deepEqual(record(row), { wins: 1, losses: 1 });
  row.picks[0].result = 'miss';
  assert.deepEqual(record(row), { wins: 0, losses: 2 });
  row.picks[0].result = 'pending';
  assert.deepEqual(record(row), { wins: 0, losses: 1 });
  assert.deepEqual(record({ ...row, picks: [] }), { wins: 0, losses: 0 });
  assert.deepEqual(record({ ...row, status: 'draft' }), { wins: 0, losses: 0 });
});

test('Angle themes preserve selection order through saves and reads, with section defaults for legacy drafts', () => {
  const row = { id: 'story', season: 2026, week: 7, revision: 1, game_id: 'NFL:123', matchup: 'Away @ Home',
    kind: 'team', subject: '', category: 'Other', title: 'Title', narrative: 'Story', evidence: '', counterpoint: '',
    pick: '', source_url: '', source_label: '', reviewed: true, status: 'published' };
  for (const themes of [['betting', 'fantasy', 'news'], ['fantasy', 'news'], ['news', 'betting']]) {
    const saved = angleWriteFields({ ...row, themes }, 'published');
    assert.deepEqual(saved.themes, themes);
    assert.deepEqual(angleThemes(readAngles([{ ...row, ...saved }])[0]), themes);
  }
  assert.deepEqual(angleThemes(row), ['news']);
  assert.deepEqual(angleThemes({ ...row, section: 'news' }), ['fantasy']);
  assert.deepEqual(angleThemes({ themes: [] }), []);
  for (const themes of [null, ['other'], ['news', 'news'], ['news', 'fantasy', 'betting', 'news']]) {
    assert.throws(() => readAngles([{ ...row, themes }]), /invalid/);
  }
});
