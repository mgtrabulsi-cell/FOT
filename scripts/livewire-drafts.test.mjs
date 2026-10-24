import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLivewireDraft, saveLivewireDraft, deleteLivewireDraft } from '../src/services/livewireDrafts.ts';
import { loadAngleDraft, saveAngleDraft, deleteAngleDrafts } from '../src/services/angleDrafts.ts';

const records = new Map();
let fail = false;
let stalled = false;
globalThis.indexedDB = {
  open() {
    const opening = {};
    if (stalled) return opening;
    queueMicrotask(() => {
      opening.result = {
        close() {},
        transaction() {
          const tx = {
            objectStore() {
              const operation = (run) => {
                const request = {};
                queueMicrotask(() => {
                  if (fail) { tx.error = new Error('Quota exceeded'); tx.onabort(); }
                  else { request.result = run(); tx.oncomplete(); }
                });
                return request;
              };
              return {
                get: (key) => operation(() => records.get(key)),
                put: (value, key) => operation(() => { records.set(key, value); return key; }),
                delete: (key) => operation(() => { records.delete(key); }),
              };
            },
          };
          return tx;
        },
      };
      opening.onsuccess();
    });
    return opening;
  },
};
const empty = { title: '', body: '', source: '', themes: [], editing: null, photos: [] };
const draft = { ...empty, title: 'Headline', body: 'Unpublished post', source: 'https://example.com/', themes: ['news'], editing: 'post-id', photos: [{ file: new File(['photo bytes'], 'draft.png', { type: 'image/png' }) }, { path: 'author/existing.png' }] };

test('Draft text, edit target, themes, attachments and original file bytes survive a new read, isolated by account', async () => {
  await saveLivewireDraft('author-one', draft);
  const restored = await loadLivewireDraft('author-one');
  assert.equal(restored.title, draft.title);
  assert.equal(restored.body, draft.body);
  assert.equal(restored.source, draft.source);
  assert.equal(restored.editing, 'post-id');
  assert.deepEqual(restored.themes, ['news']);
  assert.equal(restored.photos[0].file.name, 'draft.png');
  assert.equal(await restored.photos[0].file.text(), 'photo bytes');
  assert.equal(restored.photos[1].path, 'author/existing.png');
  assert.equal(await loadLivewireDraft('author-two'), undefined);
});

test('LIVEWIRE X opt-out survives draft restoration', async () => {
  await saveLivewireDraft('x-opt-out', { ...draft, postToX: false });
  assert.equal((await loadLivewireDraft('x-opt-out')).postToX, false);
});

test('Rapid saves remain ordered; publishing/discarding empty state removes the saved draft', async () => {
  await Promise.all([
    saveLivewireDraft('rapid', { ...draft, title: 'First' }),
    saveLivewireDraft('rapid', { ...draft, title: 'Latest' }),
  ]);
  assert.equal((await loadLivewireDraft('rapid')).title, 'Latest');
  await saveLivewireDraft('rapid', empty);
  assert.equal(await loadLivewireDraft('rapid'), undefined);
});

test('Storage errors reject explicitly without poisoning later successful saves', async () => {
  fail = true;
  await assert.rejects(saveLivewireDraft('failure', draft), /Quota exceeded/);
  fail = false;
  await saveLivewireDraft('failure', draft);
  assert.equal((await loadLivewireDraft('failure')).body, draft.body);
});

test('Mobile storage restoring a File as a Blob preserves its bytes and restores an uploadable File', async () => {
  records.set('mobile-blob', { ...draft, photos: [{ file: new Blob(['mobile photo'], { type: 'image/png' }) }] });
  const restored = await loadLivewireDraft('mobile-blob');
  assert.ok(restored.photos[0].file instanceof File);
  assert.equal(restored.photos[0].file.type, 'image/png');
  assert.equal(await restored.photos[0].file.text(), 'mobile photo');
  assert.match(restored.photos[0].file.name, /\.png$/);
});

test('Invalid stored drafts reject without overwriting their recoverable text', async () => {
  const invalid = { ...draft, photos: [{ file: {} }] };
  records.set('invalid', invalid);
  await assert.rejects(loadLivewireDraft('invalid'), /invalid/);
  assert.equal(records.get('invalid').body, draft.body);
});

test('An unresponsive mobile database times out and later requests can recover', async () => {
  stalled = true;
  const pending = loadLivewireDraft('stalled');
  await assert.rejects(pending, /did not respond/);
  stalled = false;
  await saveLivewireDraft('stalled', draft);
  assert.equal((await loadLivewireDraft('stalled')).title, draft.title);
});

test('Account deletion clears its draft, preserves other accounts and prevents late writes', async () => {
  await saveLivewireDraft('deleted', draft);
  const pending = saveLivewireDraft('deleted', { ...draft, title: 'In flight' });
  const deletion = deleteLivewireDraft('deleted');
  await assert.rejects(pending, /stopped/);
  await deletion;
  await assert.rejects(saveLivewireDraft('deleted', draft), /stopped/);
  assert.equal(await loadLivewireDraft('deleted'), undefined);
  assert.equal((await loadLivewireDraft('author-one')).title, draft.title);
});

const angle = {
  id: '', season: 2026, week: 7, game_id: 'NFL:123', matchup: 'Away @ Home', kind: 'team',
  subject: 'AWY @ HME', category: 'Other', title: 'Unfinished angle', narrative: 'Writing on my phone',
  evidence: 'Source context', counterpoint: '', pick: '', source_url: '', source_label: '',
  reviewed: false, status: 'draft', revision: 0, section: 'angle', news_types: [],
  picks: [{ id: 'a8541111-1111-4111-8111-111111111131', text: '', result: 'pending' }],
};
const angleDraft = { form: angle, photos: draft.photos };

test('Past settled review picks survive offline draft restoration without becoming new bets', async () => {
  const review = { story_id: 'a8541111-1111-4111-8111-111111111121', pick_id: 'a8541111-1111-4111-8111-111111111131',
    text: 'Previous team ML', result: 'hit', category: 'straight', title: 'Previous pick',
    matchup: 'Away @ Home', game_id: 'NFL:123', season: 2025, week: 4 };
  await saveAngleDraft('angle-review', 'angle', { ...angleDraft, form: { ...angle, review_picks: [review] } });
  const restored = await loadAngleDraft('angle-review', 'angle');
  assert.deepEqual(restored.form.review_picks, [review]);
  assert.deepEqual(restored.form.picks, angle.picks);
  records.set('bad-review:angle', { ...angleDraft, form: { ...angle, review_picks: [{ ...review, result: 'pending' }] } });
  await assert.rejects(loadAngleDraft('bad-review', 'angle'), /invalid settled-pick reviews/i);
});

test('Angle editors restore new stories, empty pick lines, review state, week and photo bytes', async () => {
  await saveAngleDraft('angle-author', 'angle', angleDraft);
  const restored = await loadAngleDraft('angle-author', 'angle');
  assert.deepEqual(restored.form, angle);
  assert.equal(await restored.photos[0].file.text(), 'photo bytes');
  assert.equal(restored.photos[1].path, 'author/existing.png');
  await saveAngleDraft('angle-author', 'angle', { ...angleDraft, photos: [{ file: new Blob(['phone image'], { type: 'image/jpeg' }) }] });
  const mobile = await loadAngleDraft('angle-author', 'angle');
  assert.ok(mobile.photos[0].file instanceof File);
  assert.equal(await mobile.photos[0].file.text(), 'phone image');
  assert.equal(mobile.photos[0].file.type, 'image/jpeg');
});

test('Angle and Fantasy News drafts are isolated by section and account; edits retain their revision', async () => {
  const edited = { ...angle, id: 'server-story-id', revision: 4, reviewed: true, status: 'published' };
  await saveAngleDraft('angle-author', 'angle', { ...angleDraft, form: edited });
  await saveAngleDraft('angle-author', 'news', { form: { ...angle, section: 'news', title: 'Fantasy news', news_types: ['injury'] }, photos: [] });
  assert.deepEqual((await loadAngleDraft('angle-author', 'angle')).form, edited);
  assert.equal((await loadAngleDraft('angle-author', 'news')).form.title, 'Fantasy news');
  assert.equal(await loadAngleDraft('other-author', 'angle'), undefined);
});

test('Rapid Angle saves preserve the latest changes, and explicit clearing does not restore a closed draft', async () => {
  await Promise.all([
    saveAngleDraft('ordered-angle', 'angle', angleDraft),
    saveAngleDraft('ordered-angle', 'angle', { ...angleDraft, form: { ...angle, narrative: 'Latest words' } }),
  ]);
  assert.equal((await loadAngleDraft('ordered-angle', 'angle')).form.narrative, 'Latest words');
  await saveAngleDraft('ordered-angle', 'angle', undefined);
  assert.equal(await loadAngleDraft('ordered-angle', 'angle'), undefined);
});

test('Angle storage failures reject visibly and preserve the previous draft for recovery', async () => {
  await saveAngleDraft('angle-error', 'angle', angleDraft);
  fail = true;
  await assert.rejects(saveAngleDraft('angle-error', 'angle', { ...angleDraft, form: { ...angle, title: 'Not saved' } }), /Quota/);
  await assert.rejects(saveAngleDraft('angle-error', 'angle', undefined), /Quota/);
  fail = false;
  assert.equal((await loadAngleDraft('angle-error', 'angle')).form.title, angle.title);
  for (const invalid of [
    { ...angleDraft, form: { ...angle, narrative: null } },
    { ...angleDraft, form: { ...angle, revision: -1 } },
    { ...angleDraft, form: { ...angle, section: 'news' } },
    { ...angleDraft, form: { ...angle, picks: [{ id: 'test', text: 123, result: 'pending' }] } },
    { ...angleDraft, photos: [{ file: {} }] },
  ]) {
    records.set('invalid-angle:angle', invalid);
    await assert.rejects(loadAngleDraft('invalid-angle', 'angle'), /invalid/);
    assert.equal(records.get('invalid-angle:angle'), invalid);
  }
});

test('Account deletion removes both storyline editors and blocks queued writes without touching other accounts', async () => {
  await saveAngleDraft('delete-angle', 'angle', angleDraft);
  await saveAngleDraft('delete-angle', 'news', { ...angleDraft, form: { ...angle, section: 'news' } });
  const pending = saveAngleDraft('delete-angle', 'angle', angleDraft);
  const deletion = deleteAngleDrafts('delete-angle');
  await assert.rejects(pending, /stopped/);
  await deletion;
  for (const section of ['angle', 'news']) {
    assert.equal(await loadAngleDraft('delete-angle', section), undefined);
    await assert.rejects(saveAngleDraft('delete-angle', section, angleDraft), /stopped/);
  }
  assert.equal((await loadAngleDraft('angle-author', 'angle')).form.id, 'server-story-id');
});
