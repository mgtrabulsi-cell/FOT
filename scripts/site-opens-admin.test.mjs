import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/OwnerUserActivity.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const row = { user_id: 'admin', email: 'admin@example.test', display_name: 'Test Admin',
  joined_at: '2026-10-19T12:00:00Z', last_sign_in_at: '2026-10-24T02:00:00Z',
  open_count: 12, last_opened_at: '2026-10-24T02:20:00Z', notification_devices: 2, score_alert_devices: 1 };

function setup(initialRole, options = {}) {
  let cursor = 0, changed = false, tree, role = initialRole;
  const slots = [], effects = [], calls = [];
  const props = { user: { id: initialRole === 'owner' ? 'owner' : 'admin' } };
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (next) => {
        const value = typeof next === 'function' ? next(slots[i]) : next;
        if (!Object.is(value, slots[i])) { slots[i] = value; changed = true; }
      }];
    },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !deps.every((value, j) => Object.is(value, slots[i].deps[j]))) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !deps.every((value, j) => Object.is(value, slots[i].deps[j]))) {
        effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, console: { error() {} }, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === './services/supabaseClient') return { supabase: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => options.roleError
        ? { error: new Error('Unavailable') } : { data: role ? { role } : null } }) }) }),
      rpc: async (name) => {
        calls.push(name);
        if (options.rpcError) return { error: new Error('Denied') };
        return { data: name === 'owner_user_activity' ? [row, { ...row, user_id: 'owner', display_name: 'Owner', open_count: 0, last_opened_at: null }]
          : [{ sessions: 4, total_opens: 8, active_week: 3, last_opened_at: row.last_opened_at }] };
      },
    } };
    return {};
  } });
  vm.runInContext(code, context);
  function render() {
    let count = 0;
    do {
      assert.ok(++count < 25);
      cursor = 0; changed = false; tree = context.exports.default(props);
      effects.splice(0).forEach((effect) => effect());
    } while (changed);
  }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap((value) => nodes(value));
    return !node || typeof node !== 'object' ? [] : [node, ...nodes(node.props?.children ?? null)];
  }
  function text(node = tree) {
    if (Array.isArray(node)) return node.map((value) => text(value)).join('');
    return node && typeof node === 'object' ? text(node.props?.children ?? null) : node == null || typeof node === 'boolean' ? '' : String(node);
  }
  async function settle() { for (let i = 0; i < 4; i++) { await new Promise((resolve) => setImmediate(resolve)); render(); } }
  render();
  return { calls, render, settle, nodes, text, options, changeUser(id, nextRole) { props.user = { id }; role = nextRole; render(); } };
}

test('admins and owners can list registered accounts, visits, last sign-in and guest totals', async () => {
  for (const role of ['admin', 'owner']) {
    const app = setup(role);
    await app.settle();
    assert.deepEqual(app.calls, ['owner_user_activity', 'owner_guest_activity']);
    assert.match(app.text(), /Test Admin/);
    assert.match(app.text(), /admin@example.test/);
    assert.match(app.text(), /Visible to admins and the owner/);
    assert.match(app.text(), /Last sign-in:/);
    assert.match(app.text(), /GUEST OPENS/);
    assert.match(app.text(), /not individual logins/);
    const ownCount = app.nodes().find((node) => node.props?.['aria-label'] === (role === 'owner' ? 'Your opens are excluded' : '12 opens'));
    assert.equal(ownCount.props.children, role === 'owner' ? 'Excluded' : '12');
  }
});

test('members and guests cannot render or request activity', async () => {
  for (const role of [null, 'member']) {
    const app = setup(role);
    await app.settle();
    assert.equal(app.nodes().length, 0);
    assert.equal(app.calls.length, 0);
  }
});

test('role failures are visible and retryable; denied data reads do not become empty success', async () => {
  const app = setup('admin', { roleError: true });
  await app.settle();
  assert.match(app.text(), /Could not check account activity access/);
  assert.equal(app.calls.length, 0);
  app.options.roleError = false;
  app.nodes().find((node) => node.type === 'button').props.onClick();
  app.render(); await app.settle();
  assert.match(app.text(), /Test Admin/);
  const denied = setup('admin', { rpcError: true });
  await denied.settle();
  assert.match(denied.text(), /Could not load registered users/);
  assert.match(denied.text(), /Could not load guest visits/);
});

test('changing from an admin account to a regular member immediately hides prior private rows', async () => {
  const app = setup('admin');
  await app.settle();
  app.changeUser('member', null);
  assert.equal(app.nodes().length, 0);
  await app.settle();
  assert.equal(app.nodes().length, 0);
  assert.equal(app.calls.length, 2);
});

test('install and upgrade SQL consistently enforce owner/admin access and revoke anonymous execution', () => {
  for (const file of ['site-opens.sql', 'owner-notification-status.sql', 'guest-site-opens.sql', 'admin-user-activity.sql']) {
    const source = readFileSync(new URL(`../supabase/${file}`, import.meta.url), 'utf8');
    assert.match(source, /if coalesce\(public.livewire_role\(\), ''\) not in \('owner', 'admin'\) then raise exception 'Admin access is required'/);
    assert.doesNotMatch(source, /Owner access is required/);
    for (const name of ['owner_user_activity', 'owner_guest_activity']) {
      if (!source.includes(`function public.${name}()`)) continue;
      assert.ok(source.includes(`revoke all on function public.${name}() from public, anon;`));
      assert.ok(source.includes(`grant execute on function public.${name}() to authenticated;`));
    }
  }
});
