import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as angles from '../src/services/theAngle.ts';
import * as categories from '../src/services/anglePicks.ts';
import { feedImageUrl } from '../src/services/postImages.ts';
import { isNativePublicImage } from '../src/services/nativePolicy.ts';

test('Feed images request smaller cached variants while GIFs and original URLs stay untouched', () => {
  const original = 'https://project.supabase.co/storage/v1/object/public/livewire-photos/user/photo.png';
  const thumbnail = feedImageUrl(original);
  assert.equal(new URL(thumbnail).pathname, '/storage/v1/render/image/public/livewire-photos/user/photo.png');
  assert.equal(new URL(thumbnail).searchParams.get('width'), '640');
  assert.equal(new URL(thumbnail).searchParams.get('resize'), 'contain');
  assert.equal(isNativePublicImage(new URL(thumbnail), 'https://project.supabase.co'), true);
  assert.equal(isNativePublicImage(new URL(thumbnail), 'https://other.test'), false);
  const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const workerFunction = worker.match(/function isOfflineImage\(url\) \{[\s\S]*?\n\}/)[0];
  const workerAccepts = vm.runInNewContext(`${workerFunction}; isOfflineImage`, { self: { GAMEWIRE_OFFLINE: { publicApiOrigin: 'https://project.supabase.co' } } });
  assert.equal(workerAccepts(new URL(thumbnail)), true);
  assert.equal(workerAccepts(new URL(thumbnail.replace('/public/', '/private/'))), false);
  for (const url of [original.replace('.png', '.gif'), original.replace('.png', '.mp4'), 'https://other.test/photo.png', '']) {
    assert.equal(feedImageUrl(url), url);
  }
  const gallery = readFileSync(new URL('../src/PostGallery.tsx', import.meta.url), 'utf8');
  assert.ok(gallery.includes('setExpanded({ src: postPhotoUrl(path)'));
  assert.ok(gallery.includes('setUseOriginal(true)'), 'Failed thumbnails fall back explicitly to originals');
});

test('Startup has no artificial one-second delay or resume splash, while protected account checks remain', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /splashReplay|splashStartedAt|setShowSplash|signedInRef/);
  assert.match(app, /authLoading && !guestMode\) return <SplashScreen/);
  assert.match(app, /<AccountRequired hasAccount=\{!!sessionUser\}/);
  assert.match(app, /if \(supabase && !authUser && !guestMode\) return <AuthScreen/);
});

const story = { id: '11111111-1111-4111-8111-111111111111', season: 2026, week: 7, game_id: 'NFL:0', matchup: 'NFL', kind: 'team',
  subject: 'Team', category: 'Other', title: 'Saved result', narrative: '', evidence: '', counterpoint: '',
  pick: '', picks: [{ id: '11111111-1111-4111-8111-111111111112', text: 'Saved winning pick', result: 'hit', category: 'straight' }],
  source_url: '', source_label: '', reviewed: true, status: 'published', revision: 1 };
const source = readFileSync(new URL('../src/OurResults.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('OurResults.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'OurResults');
const code = ts.transpileModule(component.getText(parsed).replace('export default ', ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('Our Results restores all saved picks before requests, keeps them on failures, and accepts changed or deleted results', async () => {
  const hooks = [], requests = [];
  let cursor = 0, changed = false, effects = [], tree, saved = { rows: [story] }, foreground;
  const jsx = (type, props) => ({ type: typeof type === 'function' ? type.name : type, props });
  const context = vm.createContext({
    exports: {},
    ...angles, ...categories, require: () => ({ jsx, jsxs: jsx }), AbortController,
    document: { visibilityState: 'visible' },
    window: { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} },
    readRenderSnapshot: () => saved, saveRenderSnapshot: (_kind, _key, data) => { saved = data; },
    message: (error) => error.message, PickResult: 'result', Check: 'check', X: 'x',
    subscribeForegroundRefresh: (fn) => { foreground = fn; return () => {}; },
    supabase: { from: () => {
      const request = {};
      const promise = new Promise((resolve, reject) => Object.assign(request, { resolve, reject }));
      const builder = { select: () => builder, eq: () => builder, order: () => builder, range: () => builder,
        update: (fields) => { builder.maybeSingle = async () => ({ data: { ...story, ...fields }, error: null }); return builder; },
        abortSignal: (signal) => { requests.push({ ...request, signal }); return promise; } };
      return builder;
    } },
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
      if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; });
      }
    },
  });
  vm.runInContext(code, context);
  function render(runEffects = true) {
    for (let count = 0; count < 30; count++) {
      cursor = 0; changed = false; effects = [];
      tree = context.OurResults({ user: null });
      if (runEffects) effects.forEach((effect) => effect());
      if (!changed) return JSON.stringify(tree);
    }
    throw new Error('Results did not settle');
  }
  const settle = async () => { await new Promise(setImmediate); return render(); };
  try {
    assert.match(render(false), /Saved winning pick/);
    assert.doesNotMatch(render(false), /Loading results/);
    render();
    requests[0].reject(new Error('Offline'));
    assert.match(await settle(), /Saved winning pick/);
    assert.match(render(), /Saved results may be out of date/);
    foreground(); render();
    requests[1].resolve({ data: [{ ...story, picks: [{ ...story.picks[0], result: 'miss' }] }], error: null });
    await settle();
    assert.equal(saved.rows[0].picks[0].result, 'miss');
    hooks[2] = true; render();
    const findNode = (node, predicate) => {
      if (Array.isArray(node)) return node.map((item) => findNode(item, predicate)).find(Boolean);
      if (!node || typeof node !== 'object') return undefined;
      return predicate(node) ? node : findNode(node.props?.children, predicate);
    };
    const grade = findNode(tree, (node) => node.props?.className === 'grade-hit');
    assert.ok(grade, 'Admins retain their grade controls');
    grade.props.onClick(); render();
    await settle();
    assert.equal(saved.rows[0].picks[0].result, 'hit', 'A successful admin grade is saved before the next refresh');
    assert.equal(saved.rows[0].revision, 2);
    foreground(); render();
    assert.equal(requests[2].signal.aborted, true, 'Superseded refresh requests are cancelled');
    requests[2].resolve({ data: [story], error: null });
    requests[3].resolve({ data: [], error: null });
    assert.doesNotMatch(await settle(), /Saved winning pick/);
    assert.equal(saved.rows.length, 0);
  } finally { hooks.forEach((hook) => hook?.cleanup?.()); }
});
