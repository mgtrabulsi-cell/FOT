import assert from 'node:assert/strict';
import test from 'node:test';
import { anglePicks, angleSport, angleSportGameId, angleSportRecords, publishedAnglePicks, readAnglePicks, anglePublishError, angleWriteFields, birthdayNearGame, isAngleSource, readAngles, readPlayerBirthdays, selectAngleSuggestions, suggestedAngleCategory } from '../src/services/theAngle.ts';

const game = { id: 'NFL:123', date: '2026-10-18T17:00:00Z' };
const article = { headline: 'A former team reunion', description: 'A story to review', published: '2026-10-16T12:00:00Z', url: 'https://www.espn.com/nfl/story/123' };
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
  for (const invalid of [null, {}, [picks[0], picks[0]], [{ ...picks[0], result: 'win' }], [{ ...picks[0], text: '' }], [{ ...picks[0], id: 'invalid' }]]) {
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
  assert.equal(anglePublishError({ title: 'T', narrative: 'N', subject: '', evidence: '', counterpoint: '', source_url: '', source_label: '', reviewed: true, matchup: ' ' }), 'Add the matchup before saving.');
  assert.equal(angleWriteFields({ game_id: 'NBA:0', matchup: ' Lakers @ Celtics ', kind: 'team', subject: '', category: 'Other', title: 'T', narrative: 'N', evidence: '', counterpoint: '', pick: '', source_url: '', source_label: '', reviewed: true }, 'draft').matchup, 'Lakers @ Celtics');
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
  ]);
  assert.equal(rows[0].picks[0].result, 'hit');
  assert.deepEqual(angleSportRecords(rows), records);
  assert.ok(angleSportRecords([]).every((sport) => sport.wins === 0 && sport.losses === 0));
  assert.deepEqual(angleSportRecords([]).map((sport) => sport.label), ['NFL', 'NBA', 'NHL', 'UCL', 'Soccer']);
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
