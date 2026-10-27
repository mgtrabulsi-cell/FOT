import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as angles from '../src/services/theAngle.ts';
import * as picks from '../src/services/anglePicks.ts';
import { postThemes } from '../src/services/postThemes.ts';
import { readRenderSnapshot, saveRenderSnapshot } from '../src/services/renderSnapshots.ts';

const story = {
  id: 'saved-angle', season: 2026, week: 7, game_id: 'NFL:0', matchup: 'NFL', kind: 'team',
  subject: 'NFL', category: 'Other', title: 'Saved Angle headline', narrative: 'Saved analysis',
  evidence: '', counterpoint: '', pick: '', source_url: '', source_label: '', reviewed: true,
  status: 'published', revision: 1, section: 'angle', image_paths: [],
};
const source = readFileSync(new URL('../src/TheAngle.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('TheAngle.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'TheAngle');
const code = ts.transpileModule(component.getText(parsed).replace('export default ', ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture(saved = null) {
  const hooks = [], requests = [], listeners = new Set();
  let cursor = 0, changed = false, effects = [], tree;
  const props = { user: null, games: [], season: 2026, week: 7, active: false };
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({
    ...angles, ...picks, postThemes,
    exports: {}, require: () => ({ jsx, jsxs: jsx }), console, AbortController,
    errorMessage: (cause) => cause.message, generalMatchups: [],
    readRenderSnapshot: () => saved,
    saveRenderSnapshot: (_kind, _key, data) => { saved = data; },
    subscribeForegroundRefresh: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
    supabase: { from: () => {
      const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: story, error: null }) };
      return builder;
    }, rpc: (_name, args) => {
      const request = { args };
      const promise = new Promise((resolve, reject) => Object.assign(request, { resolve, reject }));
      const builder = { order: () => builder, range: () => builder, abortSignal: (signal) => {
        request.signal = signal; requests.push(request); return promise;
      } };
      return builder;
    } },
    document: { visibilityState: 'visible', getElementById: () => ({ scrollIntoView() {}, focus() {} }) },
    window: { setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {} },
    useAnalystReadObserver: () => ({ root: { current: null } }),
    observePostViews: () => () => {},
    PostGallery: 'gallery', AnglePicks: 'picks', AngleReviewList: 'review-picks', ActiveAngleBets: 'active-bets',
    PostViewers: 'viewers', XPublishingStatus: 'x-status', Plus: 'plus', ExternalLink: 'link',
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
      if (!previous || !deps || !previous.deps || !deps.every((value, i) => Object.is(value, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; });
      }
    },
  });
  vm.runInContext(code, context);
  function render(runEffects = true) {
    for (let i = 0; i < 30; i++) {
      cursor = 0; changed = false; effects = [];
      tree = context.TheAngle(props);
      if (runEffects) effects.forEach((run) => run());
      if (!changed) return tree;
    }
    throw new Error('Angle fixture did not stabilize');
  }
  return {
    props, requests, render, text: () => JSON.stringify(tree), saved: () => saved,
    async settle() { await new Promise((resolve) => setImmediate(resolve)); render(); },
    unmount: () => hooks.forEach((hook) => hook?.cleanup?.()),
  };
}

test('Angle renders saved published posts before effects, schedule, or network', () => {
  const app = fixture({ season: 2026, week: 7, rows: [story] });
  app.props.active = true;
  app.props.season = null; app.props.week = null;
  app.render(false);
  assert.match(app.text(), /Saved Angle headline|Saved analysis/);
  assert.match(app.text(), /Showing saved posts from Week/);
  assert.doesNotMatch(app.text(), /Loading The Angle|Waiting for the selected/);
  assert.equal(app.requests.length, 0);
});

function findNode(node, predicate) {
  if (Array.isArray(node)) return node.map((item) => findNode(item, predicate)).find(Boolean);
  if (!node || typeof node !== 'object') return undefined;
  return predicate(node) ? node : findNode(node.props?.children, predicate);
}

test('Collapsed Angle titles prefix the first assigned theme only and remove it while expanded', () => {
  for (const [themes, label] of [[['betting'], 'Betting'], [['fantasy'], 'Fantasy'], [['news'], 'News'], [['betting', 'news'], 'Betting'], [undefined, 'News'], [[], null]]) {
    const app = fixture({ season: 2026, week: 7, rows: [{ ...story, themes }] });
    app.props.active = true;
    try {
      let tree = app.render();
      const prefix = () => findNode(tree, (node) => node.props?.className === 'angle-post-theme');
      const toggle = () => findNode(tree, (node) => node.props?.className === 'angle-post-toggle');
      if (label) assert.equal(prefix().props.children.join(''), `${label}: `);
      else assert.equal(prefix(), undefined);
      toggle().props.onClick(); tree = app.render();
      assert.equal(prefix(), undefined, 'Opened posts show an unprefixed title');
      assert.match(app.text(), /Saved analysis/);
      toggle().props.onClick(); tree = app.render();
      if (label) assert.equal(prefix().props.children.join(''), `${label}: `);
    } finally { app.unmount(); }
  }
});

test('Angle starts with titles only, expands full posts independently, and collapses without mounting media or recording views', () => {
  const second = { ...story, id: 'second-angle', title: 'Second headline', narrative: 'Second analysis' };
  const app = fixture({ season: 2026, week: 7, rows: [story, second] });
  app.props.active = true;
  try {
    let tree = app.render();
    assert.match(app.text(), /Saved Angle headline/);
    assert.doesNotMatch(app.text(), /Saved analysis|Second analysis|"data-post-id"|"type":"gallery"/);
    const toggle = () => findNode(tree, (node) => node.props?.className === 'angle-post-toggle' && node.props['aria-controls'] === `angle-body-${story.id}`);
    assert.equal(toggle().props['aria-expanded'], false);
    toggle().props.onClick(); tree = app.render();
    assert.equal(toggle().props['aria-expanded'], true);
    assert.match(app.text(), /Saved analysis|"data-post-id":"saved-angle"|"type":"gallery"/);
    assert.doesNotMatch(app.text(), /Second analysis/);
    const secondToggle = findNode(tree, (node) => node.props?.['aria-controls'] === 'angle-body-second-angle');
    secondToggle.props.onClick(); tree = app.render();
    assert.match(app.text(), /Saved analysis/);
    assert.match(app.text(), /Second analysis/);
    toggle().props.onClick(); tree = app.render();
    assert.doesNotMatch(app.text(), /Saved analysis|"data-post-id":"saved-angle"/);
    assert.match(app.text(), /Second analysis/);
    assert.equal(toggle().props['aria-expanded'], false);
  } finally { app.unmount(); }
});

test('Linked Angle posts expand automatically and can still be collapsed', async () => {
  const app = fixture({ season: 2026, week: 7, rows: [story] });
  app.props.active = true; app.props.storyId = story.id;
  try {
    app.render(); await app.settle();
    const toggle = findNode(app.render(), (node) => node.props?.className === 'angle-post-toggle');
    assert.equal(toggle.props['aria-expanded'], true);
    assert.match(app.text(), /Saved analysis/);
    toggle.props.onClick(); app.render();
    assert.doesNotMatch(app.text(), /Saved analysis/);
    app.props.storyOpenKey = 1; app.render();
    assert.match(app.text(), /Saved analysis/);
  } finally { app.unmount(); }
});

test('Fantasy News retains the full-post layout', () => {
  const app = fixture({ season: 2026, week: 7, rows: [{ ...story, section: 'news' }] });
  app.props.active = true; app.props.section = 'news';
  try {
    app.render();
    assert.match(app.text(), /Saved analysis/);
    assert.doesNotMatch(app.text(), /angle-post-toggle/);
  } finally { app.unmount(); }
});

test('Angle preloads while closed, preserves posts during failed refresh, and accepts edits/deletions', async () => {
  const app = fixture();
  try {
    app.render();
    assert.equal(app.requests.length, 1, 'Preload does not wait for tab activation');
    const draft = { ...story, id: 'draft', status: 'draft' };
    app.requests[0].resolve({ data: [story, draft], error: null });
    await app.settle();
    assert.equal(app.saved().rows.length, 1, 'Private drafts are not persisted with published posts');
    app.props.active = true; app.render();
    assert.match(app.text(), /Saved Angle headline/);
    app.requests[1].reject(new Error('Offline'));
    await app.settle();
    assert.match(app.text(), /Saved Angle headline/);
    assert.match(app.text(), /Offline/);
    app.props.active = false; app.render();
    app.props.active = true; app.render();
    app.requests[2].resolve({ data: [{ ...story, title: 'Updated headline' }], error: null });
    await app.settle();
    assert.match(app.text(), /Updated headline/);
    assert.doesNotMatch(app.text(), /Saved Angle headline/);
    app.props.active = false; app.render();
    app.props.active = true; app.render();
    app.requests[3].resolve({ data: [], error: null });
    await app.settle();
    assert.doesNotMatch(app.text(), /Updated headline/);
    assert.equal(app.saved().rows.length, 0);
  } finally { app.unmount(); }
});

test('A resolved different week does not present the old NFL archive as current', () => {
  const app = fixture({ season: 2026, week: 7, rows: [story] });
  app.props.active = true; app.props.week = 8;
  app.render();
  assert.doesNotMatch(app.text(), /Saved Angle headline/);
  app.unmount();
});

test('Opening Angle during its first preload does not restart or cancel the request', async () => {
  const app = fixture();
  try {
    app.render();
    const request = app.requests[0];
    app.props.active = true; app.render();
    assert.equal(app.requests.length, 1);
    assert.equal(request.signal.aborted, false);
    request.resolve({ data: [story], error: null });
    await app.settle();
    assert.match(app.text(), /Saved Angle headline/);
  } finally { app.unmount(); }
});

test('Published feed snapshots survive sports cache churn and reject drafts', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return entries.size; }, key: (index) => [...entries.keys()][index],
    getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  } });
  const log = console.error;
  try {
    saveRenderSnapshot('angleFeed', 'angle', { season: 2026, week: 7, rows: [story] });
    saveRenderSnapshot('activeBets', 'last', { rows: [story] });
    saveRenderSnapshot('posts', 'livewire', { posts: [], hasMore: false });
    for (let i = 0; i < 200; i++) saveRenderSnapshot('nbaRoster', String(i), []);
    assert.equal(readRenderSnapshot('angleFeed', 'angle').rows[0].id, story.id);
    assert.equal(readRenderSnapshot('activeBets', 'last').rows[0].id, story.id);
    assert.deepEqual(readRenderSnapshot('posts', 'livewire'), { posts: [], hasMore: false });
    const key = [...entries.keys()].find((key) => key.includes('angleFeed:angle'));
    const raw = JSON.parse(entries.get(key));
    raw.data.rows[0].status = 'draft';
    entries.set(key, JSON.stringify(raw));
    const errors = [];
    console.error = (...args) => errors.push(args);
    assert.equal(readRenderSnapshot('angleFeed', 'angle'), null);
    assert.equal(errors.length, 1);
  } finally {
    console.error = log;
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
