import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { fetchLivewirePosts, livewireSnapshot, readLivewirePosts } from '../src/services/livewirePosts.ts';
import { readRenderSnapshot, saveRenderSnapshot } from '../src/services/renderSnapshots.ts';
import { createWebOfflineStore } from '../src/services/webOffline.ts';

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
  .replace(/from ['"]\.\/services\/foregroundRefresh['"]/g, `from '${new URL('../src/services/foregroundRefresh.ts', import.meta.url)}'`)
  .replace(/import OfflineImage from [^;]+;/, 'const OfflineImage = () => null;')
  .replace(/import PostGallery from [^;]+;/, 'const PostGallery = () => null;')
  .replace(/import AnglePicks from [^;]+;/, 'const AnglePicks = () => null;')
  .replace(/import \{ AngleReviewList \} from [^;]+;/, 'const AngleReviewList = () => null;')
  .replace(/import XPublishingStatus from [^;]+;/, 'const XPublishingStatus = () => null;')
  .replace(/import PostViewers from [^;]+;/, 'const PostViewers = () => null;')
  .replace(/import \{ usePublicDataRevision \} from [^;]+;/, 'const usePublicDataRevision = () => 0;')
  .replace(/import \{ publicSupabaseConfig, supabase \} from [^;]+;/, 'const publicSupabaseConfig = null; const supabase = null;')
  .replace(/import \{ observePostViews \} from [^;]+;/, 'const observePostViews = () => () => {};')
  .replace(/import \{ loadLivewireDraft, saveLivewireDraft \} from [^;]+;/, 'const loadLivewireDraft = async () => null; const saveLivewireDraft = async () => {};');
const { default: LiveWire } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('The app keeps one LIVEWIRE instance mounted outside tab-selection conditionals', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const app = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const instances = [];
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(app) === 'LiveWire') instances.push(node);
    ts.forEachChild(node, visit);
  };
  visit(app);
  assert.equal(instances.length, 1);
  const wrapper = instances[0].parent;
  assert.ok(ts.isJsxElement(wrapper), 'LIVEWIRE stays mounted inside a visibility wrapper');
  assert.match(wrapper.openingElement.getText(app), /hidden=\{view !== 'LiveWire'\}/);
  assert.match(instances[0].getText(app), /active=\{view === 'LiveWire'\}/);
  assert.ok(ts.isJsxElement(wrapper.parent), 'The wrapper is a direct main-app child, not a conditional branch');
});

const parsed = ts.createSourceFile('LiveWire.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'LiveWire');
const executable = ts.transpileModule(component.getText(parsed).replace('export default ', ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function livewireFixture() {
  const hooks = [], requests = [], timers = new Map();
  let cursor = 0, changed = false, effects = [], tree, saved = null, foreground;
  const listeners = new Set();
  const props = { user: null, active: false };
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({
    exports: {}, require: () => ({ jsx, jsxs: jsx }), console, AbortController, Error,
    publicSupabaseConfig: { url: 'https://test.supabase.co', key: 'public-key' }, supabase: null,
    usePublicDataRevision: () => 0,
    readRenderSnapshot: () => saved,
    saveRenderSnapshot: (_kind, _key, data) => { saved = data; listeners.forEach((callback) => callback()); },
    subscribeRenderSnapshots: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
    livewireSnapshot,
    fetchLivewirePosts: (_config, options, signal) => new Promise((resolve, reject) => requests.push({ options, signal, resolve, reject })),
    subscribeForegroundRefresh: (callback) => { foreground = callback; return () => { foreground = undefined; }; },
    document: { visibilityState: 'visible' },
    window: { setInterval: (callback) => { const id = timers.size + 1; timers.set(id, callback); return id; }, clearInterval: (id) => timers.delete(id) },
    postThemes: [{ value: 'news', label: 'News', color: 'tnf' }, { value: 'fantasy', label: 'Fantasy', color: 'snf' }],
    PostGallery: 'gallery', AnglePicks: 'picks', PostViewers: 'post-viewers', XPublishingStatus: 'x-status', Plus: 'plus',
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], (next) => {
        const value = typeof next === 'function' ? next(hooks[index]) : next;
        if (!Object.is(value, hooks[index])) { hooks[index] = value; changed = true; }
      }];
    },
    useEffect(callback, deps) {
      const index = cursor++, previous = hooks[index];
      if (!previous || !equal(previous.deps, deps)) {
        effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; });
      }
    },
  });
  vm.runInContext(executable, context);
  function render() {
    for (let iteration = 0; iteration < 30; iteration++) {
      cursor = 0; changed = false; effects = [];
      tree = context.LiveWire(props);
      effects.forEach((run) => run());
      if (!changed) return tree;
    }
    throw new Error('LIVEWIRE fixture did not stabilize');
  }
  function all(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((child) => all(child ?? null));
    return [node, ...all(node.props?.children ?? null)];
  }
  return {
    props, requests, timers, render,
    async settle() { await new Promise((resolve) => setImmediate(resolve)); render(); },
    text: () => JSON.stringify(tree),
    button: (label) => all().find((node) => node.type === 'button' && node.props.children === label),
    themeButton: (label) => all().find((node) => node.type === 'button' && node.props.children?.props?.children === label),
    foreground: () => foreground(),
    preload: (posts) => { saved = livewireSnapshot(posts, 20); listeners.forEach((callback) => callback()); render(); },
    unmount: () => hooks.forEach((hook) => hook?.cleanup?.()),
  };
}

test('LIVEWIRE adopts a completed background preload while its own request is still pending', () => {
  const app = livewireFixture();
  try {
    app.render();
    app.preload([post]);
    assert.match(app.text(), /Saved headline/);
    assert.doesNotMatch(app.text(), /Loading LIVEWIRE/);
    assert.equal(app.requests.length, 1);
  } finally { app.unmount(); }
});

test('LIVEWIRE preloads before its tab opens, preserves in-flight loads and keeps posts through tab changes and slow refreshes', async () => {
  const app = livewireFixture();
  try {
    app.render();
    assert.equal(app.requests.length, 1, 'Public feed starts loading while another tab is open');
    const preload = app.requests[0];
    app.props.active = true; app.render();
    assert.equal(app.requests.length, 1, 'Opening does not restart a pending preload');
    assert.equal(preload.signal.aborted, false);
    preload.resolve([post]);
    await app.settle();
    assert.match(app.text(), /Saved headline/);
    assert.doesNotMatch(app.text(), /Loading LIVEWIRE/);
    app.props.active = false; app.render();
    app.timers.forEach((tick) => tick());
    app.render();
    assert.equal(app.requests.length, 1, 'Hidden tabs do not poll');
    app.props.active = true; app.render();
    assert.equal(app.requests.length, 2, 'Reopening refreshes in the background');
    assert.match(app.text(), /Saved headline/);
    assert.doesNotMatch(app.text(), /Loading LIVEWIRE/);
    app.requests[1].reject(new Error('Connection unavailable'));
    await app.settle();
    assert.match(app.text(), /Saved headline/);
    assert.match(app.text(), /Connection unavailable/);
    assert.doesNotMatch(app.text(), /Loading LIVEWIRE/);
    app.foreground(); app.render();
    assert.equal(app.requests.length, 3, 'Foreground return retries without removing posts');
    app.requests[2].resolve([]);
    await app.settle();
    assert.doesNotMatch(app.text(), /Saved headline/);
    assert.match(app.text(), /No posts yet/);
  } finally { app.unmount(); }
});

test('LIVEWIRE theme changes filter available posts immediately without showing a network-only loading screen', async () => {
  const app = livewireFixture();
  try {
    app.render();
    app.requests[0].resolve([post, { ...post, id: 'fantasy', title: 'Fantasy headline', themes: ['fantasy'] }]);
    await app.settle();
    app.themeButton('Fantasy').props.onClick(); app.render();
    assert.match(app.text(), /Fantasy headline/);
    assert.doesNotMatch(app.text(), /Saved headline|Loading LIVEWIRE/);
    app.button('All posts').props.onClick(); app.render();
    assert.match(app.text(), /Saved headline/);
    assert.match(app.text(), /Fantasy headline/);
    assert.doesNotMatch(app.text(), /Loading LIVEWIRE/);
  } finally { app.unmount(); }
});

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

test('Public post entry permits saved-first reads and keeps ordering, filters and pagination without account tokens', async () => {
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
    assert.equal(requests[0].options.cache, 'default');
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

test('Explicit refresh after a mutation bypasses saved reads', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.cache, 'reload');
    return Response.json([post]);
  };
  try {
    await fetchLivewirePosts({ url: 'https://test.supabase.co', key: 'key' }, { limit: 20, themes: [], fresh: true });
  } finally { globalThis.fetch = original; }
});

test('Feed timeout and caller cancellation both reach requests', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const timeout = new AbortController();
  const caller = new AbortController();
  AbortSignal.timeout = (ms) => { assert.equal(ms, 15_000); return timeout.signal; };
  globalThis.fetch = async (_url, options) => {
    options.signal.throwIfAborted();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  };
  try {
    const pending = fetchLivewirePosts({ url: 'https://test.supabase.co', key: 'key' }, { limit: 20, themes: [] }, caller.signal);
    timeout.abort(new DOMException('Timed out', 'TimeoutError'));
    await assert.rejects(pending, { name: 'TimeoutError' });
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(fetchLivewirePosts({ url: 'https://test.supabase.co', key: 'key' }, { limit: 20, themes: [] }, cancelled.signal), { name: 'AbortError' });
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});

test('LIVEWIRE uses its response cache immediately while a fresh feed request is blocked', { timeout: 2000 }, async () => {
  const original = globalThis.fetch;
  const records = new Map();
  const cache = {
    async match(key) { return records.get(String(key))?.clone(); },
    async put(key, response) { records.set(String(key), response.clone()); },
    async keys() { return [...records.keys()]; },
    async delete(key) { return records.delete(String(key)); },
  };
  let finish;
  let slow = false;
  let downloads = 0;
  const options = {
    scope: 'https://gamewire.us/', publicOrigin: 'https://test.supabase.co',
    caches: { open: async () => cache }, online: () => true,
    onSavedResponse() {}, onSaveError(error) { throw error; },
    fetch: async () => {
      downloads++;
      return slow ? new Promise((resolve) => { finish = resolve; }) : Response.json([post]);
    },
  };
  const config = { url: 'https://test.supabase.co', key: 'public-key' };
  try {
    globalThis.fetch = createWebOfflineStore(options).fetch;
    await fetchLivewirePosts(config, { limit: 20, themes: [] });
    slow = true;
    const store = createWebOfflineStore(options);
    globalThis.fetch = store.fetch;
    assert.deepEqual(await fetchLivewirePosts(config, { limit: 20, themes: [] }), [post]);
    assert.equal(downloads, 2);
    assert.ok(finish, 'Refresh should run without holding up the cached feed');
    finish(Response.json([{ ...post, title: 'Fresh headline' }]));
    await store.settle();
    assert.equal((await fetchLivewirePosts(config, { limit: 20, themes: [] }))[0].title, 'Fresh headline');
    assert.equal(downloads, 2, 'Reading refreshed content must not start a revalidation loop');
  } finally {
    finish?.(Response.json([post]));
    globalThis.fetch = original;
  }
});
