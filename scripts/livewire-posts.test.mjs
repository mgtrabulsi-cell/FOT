import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { fetchLivewirePosts, livewireSnapshot, readLivewirePosts } from '../src/services/livewirePosts.ts';
import { readRenderSnapshot, saveRenderSnapshot } from '../src/services/renderSnapshots.ts';

const post = {
  id: 'post-1', author_id: null, author_name: "From The Analyst's Desk", title: 'Saved headline',
  body: 'Saved post content', source_url: null, created_at: '2026-10-18T14:00:00Z',
  updated_at: '2026-10-18T14:00:00Z', themes: ['news'], image_paths: [],
};
const source = readFileSync(new URL('../src/LiveWire.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText
  .replace(/from ['"]react['"]/g, `from '${import.meta.resolve('react')}'`)
  .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
  .replace(/from ['"]lucide-react['"]/g, `from '${import.meta.resolve('lucide-react')}'`)
  .replace(/from ['"]\.\/services\/renderSnapshots['"]/g, `from '${new URL('../src/services/renderSnapshots.ts', import.meta.url)}'`)
  .replace(/from ['"]\.\/services\/livewirePosts['"]/g, `from '${new URL('../src/services/livewirePosts.ts', import.meta.url)}'`)
  .replace(/from ['"]\.\/services\/theAngle['"]/g, `from '${new URL('../src/services/theAngle.ts', import.meta.url)}'`)
  .replace(/from ['"]\.\/services\/postThemes['"]/g, `from '${new URL('../src/services/postThemes.ts', import.meta.url)}'`)
  .replace(/import OfflineImage from [^;]+;/, 'const OfflineImage = () => null;')
  .replace(/import PostGallery from [^;]+;/, 'const PostGallery = () => null;')
  .replace(/import AnglePicks from [^;]+;/, 'const AnglePicks = () => null;')
  .replace(/import \{ usePublicDataRevision \} from [^;]+;/, 'const usePublicDataRevision = () => 0;')
  .replace(/import \{ publicSupabaseConfig, supabase \} from [^;]+;/, 'const publicSupabaseConfig = null; const supabase = null;')
  .replace(/import \{ observePostViews \} from [^;]+;/, 'const observePostViews = () => () => {};')
  .replace(/import \{ loadLivewireDraft, saveLivewireDraft \} from [^;]+;/, 'const loadLivewireDraft = async () => null; const saveLivewireDraft = async () => {};');
const { default: LiveWire } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function withStorage(run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  } });
  try { run(entries); }
  finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

test('LIVEWIRE renders saved published posts on its first render without network or effects', () => withStorage(() => {
  saveRenderSnapshot('posts', 'livewire', livewireSnapshot([post], 20));
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('First render must not wait for a request'); };
  try {
    const html = renderToStaticMarkup(createElement(LiveWire, { user: null }));
    assert.match(html, /Saved headline/);
    assert.match(html, /Saved post content/);
    assert.doesNotMatch(html, /Loading LIVEWIRE/);
    assert.doesNotMatch(html, /LIVEWIRE admins|livewire-composer/);
  } finally { globalThis.fetch = original; }
}));

test('New, edited, and deleted feed snapshots replace older saved content, bounded to 20 posts', () => withStorage(() => {
  saveRenderSnapshot('posts', 'livewire', livewireSnapshot(Array.from({ length: 21 }, (_, i) => ({ ...post, id: String(i) })), 20));
  assert.equal(readRenderSnapshot('posts', 'livewire').posts.length, 20);
  assert.equal(readRenderSnapshot('posts', 'livewire').hasMore, true);
  saveRenderSnapshot('posts', 'livewire', livewireSnapshot([{ ...post, body: 'Edited content' }], 20));
  assert.equal(readRenderSnapshot('posts', 'livewire').posts[0].body, 'Edited content');
  saveRenderSnapshot('posts', 'livewire', livewireSnapshot([], 20));
  const html = renderToStaticMarkup(createElement(LiveWire, { user: null }));
  assert.match(html, /No posts yet/);
  assert.doesNotMatch(html, /Saved headline/);
}));

test('Malformed published posts and pick data are rejected rather than cached', () => {
  for (const value of [null, [{}], [{ ...post, themes: ['invalid'] }], [{ ...post, image_paths: [123] }],
    [{ ...post, created_at: 'bad' }], [{ ...post, admin_picks: [{}] }]]) {
    assert.throws(() => readLivewirePosts(value), /invalid/);
  }
});

test('Public post refresh bypasses stale reads, keeps ordering, filters and pagination, without account tokens', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: new URL(url), options });
    return Response.json(requests.length === 1 ? Array(500).fill(post) : [post, post]);
  };
  try {
    const posts = await fetchLivewirePosts({ url: 'https://test.supabase.co', key: 'public-key' }, { limit: 501, themes: ['news', 'fantasy'] });
    assert.equal(posts.length, 502);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.cache, 'reload');
    assert.equal(requests[0].options.headers.Authorization, undefined);
    assert.equal(requests[0].options.headers.apikey, 'public-key');
    assert.equal(requests[0].url.searchParams.get('themes'), 'ov.{news,fantasy}');
    assert.equal(requests[0].url.searchParams.get('order'), 'created_at.desc,id.desc');
    assert.equal(requests[1].url.searchParams.get('offset'), '500');
    assert.equal(requests[1].url.searchParams.get('limit'), '2');
  } finally { globalThis.fetch = original; }
});

test('Linked posts use an independent ID query and refresh failures are explicit', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).searchParams.get('id'), 'eq.post-1');
    assert.equal(new URL(url).searchParams.has('themes'), false);
    return Response.json([post]);
  };
  try {
    assert.equal((await fetchLivewirePosts({ url: 'https://test.supabase.co', key: 'key' }, { limit: 1, themes: [], postId: post.id }))[0].id, post.id);
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(fetchLivewirePosts({ url: 'https://test.supabase.co', key: 'key' }, { limit: 20, themes: [] }), /HTTP 503/);
  } finally { globalThis.fetch = original; }
});
