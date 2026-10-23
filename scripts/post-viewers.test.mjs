import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/PostViewers.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const summary = { viewers: [{ user_id: 'member', display_name: 'Test Viewer', views: 2, last_viewed_at: '2026-10-23T21:00:00Z' }], guest_views: 3, unattributed_views: 10 };
function setup(surface) {
  let index = 0, tree, fail = false;
  const state = [], calls = [];
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({
    exports: {}, require: () => ({ jsx, jsxs: jsx, Fragment: 'fragment' }), console: { error() {} },
    supabase: { rpc: async (...args) => { calls.push(args); return fail ? { error: new Error('Denied') } : { data: summary }; } },
    useState: (initial) => {
      const key = index++;
      if (!(key in state)) state[key] = initial;
      return [state[key], (value) => { state[key] = value; }];
    },
  });
  vm.runInContext(code, context);
  function render() { index = 0; tree = context.exports.default({ surface, postId: 'post', count: 15 }); }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((entry) => nodes(entry));
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render();
  return { context, calls, render, nodes, fail: () => { fail = true; } };
}

test('Viewer payload validates names, counts and dates without accepting malformed summaries', () => {
  const { context } = setup('angle');
  assert.equal(context.exports.readPostViewers(summary).viewers[0].display_name, 'Test Viewer');
  for (const value of [null, {}, { ...summary, guest_views: -1 }, { ...summary, viewers: [{ ...summary.viewers[0], last_viewed_at: 'bad' }] }]) {
    assert.throws(() => context.exports.readPostViewers(value), /invalid viewer details/);
  }
});

test('Both counts load viewers only on click, close accessibly, and expose failures with retry', async () => {
  for (const surface of ['angle', 'livewire']) {
    const app = setup(surface);
    assert.equal(app.calls.length, 0);
    app.nodes().find((node) => node.type === 'button').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    app.render();
    assert.equal(app.calls[0][0], 'admin_post_viewers');
    assert.equal(app.calls[0][1].post_surface, surface);
    assert.equal(app.nodes().find((node) => node.type === 'strong').props.children, 'Test Viewer');
    assert.equal(app.nodes().find((node) => node.type === 'button').props['aria-expanded'], true);
    app.nodes().find((node) => node.type === 'button').props.onClick();
    app.render();
    assert.equal(app.nodes().some((node) => node.type === 'section'), false);
    app.fail();
    app.nodes().find((node) => node.type === 'button').props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    app.render();
    assert.equal(app.nodes().some((node) => node.props?.role === 'alert'), true);
    assert.equal(app.nodes().some((node) => node.type === 'button' && node.props.children === 'Retry'), true);
  }
});
