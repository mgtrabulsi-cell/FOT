import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { activeAnglePicks, readAngles, angleSport } from '../src/services/theAngle.ts';

const pending = { id: '11111111-1111-4111-8111-111111111111', text: 'Team A -3.5', result: 'pending' };
const story = {
  id: 'old-story', season: 2025, week: 1, game_id: 'NBA:0', matchup: 'Team A @ Team B', kind: 'team',
  subject: 'Team A', category: 'Other', title: 'Original headline', narrative: 'Analysis',
  evidence: '', counterpoint: '', pick: '', source_url: '', source_label: '', reviewed: true,
  status: 'published', revision: 1, section: 'angle', picks: [pending],
};

const source = readFileSync(new URL('../src/ActiveAngleBets.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('ActiveAngleBets.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find((node) => ts.isFunctionDeclaration(node));
const code = ts.transpileModule(component.getText(parsed).replace('export default ', ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture(saved = null) {
  const hooks = [], requests = [], timers = new Map(), writes = [];
  let cursor = 0, changed = false, effects = [], tree, foreground;
  const props = { active: false, revision: '' };
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({
    exports: {}, require: () => ({ jsx, jsxs: jsx }), AbortController, AbortSignal,
    console: { error() {} }, activeAnglePicks, readAngles, angleSport, AnglePicks: 'original-pick-format',
    readRenderSnapshot: () => saved,
    saveRenderSnapshot: (_kind, _key, value) => writes.push(value),
    subscribeForegroundRefresh: (callback) => { foreground = callback; return () => {}; },
    document: { visibilityState: 'visible' },
    window: { setInterval: (callback) => { timers.set(1, callback); return 1; }, clearInterval: (id) => timers.delete(id) },
    supabase: { from: (table) => {
      const request = { table, filters: [], ranges: [] };
      const promise = new Promise((resolve, reject) => Object.assign(request, { resolve, reject }));
      const builder = {
        select: () => builder, eq: (...args) => { request.filters.push(args); return builder; },
        contains: (...args) => { request.contains = args; return builder; },
        order: () => builder, range: (...args) => { request.ranges = args; return builder; },
        abortSignal: (signal) => { request.signal = signal; requests.push(request); return promise; },
      };
      return builder;
    } },
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
      if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; });
      }
    },
  });
  vm.runInContext(code, context);
  function render(runEffects = true) {
    for (let i = 0; i < 30; i++) {
      cursor = 0; changed = false; effects = [];
      tree = context.ActiveAngleBets(props);
      if (runEffects) effects.forEach((run) => run());
      if (!changed) return;
    }
    throw new Error('Active bets did not stabilize');
  }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children ?? null)];
  }
  return {
    props, requests, writes, render, nodes, text: () => JSON.stringify(tree),
    foreground: () => { foreground(); render(); },
    tick: () => { timers.get(1)(); render(); },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); render(); },
    unmount: () => hooks.forEach((hook) => hook?.cleanup?.()),
  };
}

test('All-week active picks exclude settled individual picks, drafts, and review attachments without splitting parlays', () => {
  const parlay = { ...pending, id: '22222222-2222-4222-8222-222222222222', text: 'Leg one\nLeg two', category: 'parlay' };
  const settled = { ...pending, id: '33333333-3333-4333-8333-333333333333', result: 'hit' };
  const missed = { ...settled, id: '44444444-4444-4444-8444-444444444444', result: 'miss' };
  const found = activeAnglePicks([
    { ...story, picks: [pending, settled, missed, parlay] },
    { ...story, id: 'sprinkle', picks: [{ ...pending, category: 'sprinkle' }] },
    { ...story, id: 'draft', status: 'draft' },
    { ...story, id: 'review-only', picks: [], review_picks: [{ text: 'Never count this again' }] },
  ]);
  assert.equal(found.length, 3);
  assert.equal(found[1].pick.text, 'Leg one\nLeg two');
  assert.equal(found[2].pick.category, 'sprinkle');
  assert.equal(activeAnglePicks([{ ...story, picks: undefined, pick: 'Legacy pick' }]).length, 1);
});

test('Saved picks render synchronously in a collapsed accessible dropdown using the original pick renderer', () => {
  const app = fixture({ rows: [story] });
  app.render(false);
  assert.equal(app.nodes()[0].type, 'details');
  assert.equal(app.nodes()[0].props.open, undefined, 'Collapsed by default');
  assert.ok(app.nodes().some((node) => node.type === 'summary'));
  const pick = app.nodes().find((node) => node.type === 'original-pick-format');
  assert.equal(pick.props.picks[0].text, pending.text);
  assert.equal(app.nodes().some((node) => node.type === 'a' || node.props?.href), false, 'Active picks have no links');
  assert.match(app.text(), /Pick |Team A @ Team B/);
  const metadata = app.nodes().find((node) => node.props?.className === 'active-bet-meta');
  assert.ok(metadata);
  assert.ok(app.nodes().some((node) => node.type === 'strong' && JSON.stringify(node.props.children) === JSON.stringify(['Pick ', 1])));
  assert.doesNotMatch(app.text(), /Loading active bets/);
  assert.equal(app.requests.length, 0);
});

test('Active query is published/pending only, unbounded by week, paginated, and retains picks after refresh failure', async () => {
  const app = fixture();
  try {
    app.render();
    const first = app.requests[0];
    assert.deepEqual(first.filters, [['status', 'published']]);
    assert.equal(first.contains[0], 'picks');
    assert.deepEqual(JSON.parse(first.contains[1]), [{ result: 'pending' }], 'JSON containment must be encoded as JSON, not a Postgres array literal');
    assert.deepEqual(first.ranges, [0, 99]);
    first.resolve({ data: Array.from({ length: 100 }, (_, i) => ({ ...story, id: String(i) })), error: null });
    await app.settle();
    assert.deepEqual(app.requests[1].ranges, [100, 199]);
    app.requests[1].resolve({ data: [story], error: null });
    await app.settle();
    assert.equal(app.writes.at(-1).rows.length, 101);
    app.props.active = true; app.render();
    app.requests[2].reject(new Error('Offline'));
    await app.settle();
    assert.match(app.text(), /Team A -3.5/);
    assert.match(app.text(), /Saved picks may have changed/);
    app.foreground();
    app.requests[3].resolve({ data: [], error: null });
    await app.settle();
    assert.doesNotMatch(app.text(), /Team A -3.5/);
    assert.match(app.text(), /No active bets/);
    assert.equal(app.writes.at(-1).rows.length, 0, 'Settlements and deletions clear the saved active list');
    app.tick();
    assert.equal(app.requests.length, 5, 'Visible lists poll for settlements');
    app.props.revision = 'edited-story:2'; app.render();
    assert.equal(app.requests.length, 6, 'Local publishing and editing prompt a refresh');
    assert.equal(app.requests[4].signal.aborted, true);
  } finally { app.unmount(); }
});
