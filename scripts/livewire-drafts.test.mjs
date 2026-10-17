import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLivewireDraft, saveLivewireDraft, deleteLivewireDraft } from '../src/services/livewireDrafts.ts';

const records = new Map();
let fail = false;
globalThis.indexedDB = {
  open() {
    const opening = {};
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
