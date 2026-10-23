import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import * as graphics from '../src/services/fantasyGraphics.ts';
import * as drafts from '../src/services/fantasyGraphicDrafts.ts';
import * as offline from '../src/services/fantasyGraphicOffline.ts';

const records = new Map();
let storageFailure = false;
globalThis.localStorage = {
  getItem(key) { if (storageFailure) throw new Error('Storage unavailable'); return records.get(key) ?? null; },
  setItem(key, value) { if (storageFailure) throw new Error('Quota exceeded'); records.set(key, value); },
  removeItem(key) { if (storageFailure) throw new Error('Storage unavailable'); records.delete(key); },
};
const draft = () => ({ form: graphics.emptyFantasyGraphic(), editing: null, dirty: true, queries: ['Jordan', '', '', ''] });
const row = (form, revision = 3) => ({
  id: 'shared-id', season: 2026, week: 7, revision, updated_at: '2026-10-23T12:00:00Z',
  content: form, published_content: null,
});

test('Immediate writes preserve unfinished reasoning, players, searches, edit identity and revision', () => {
  const value = draft();
  value.form.slots[0] = { reason: 'Still writing on my phone', player: {
    id: '4036378', name: 'Jordan Love', position: 'QB', teamId: '9', teamAbbr: 'GB',
    headshot: '', opponent: '', opponentLogo: '', matchup: 'TBD',
  } };
  value.editing = row(graphics.emptyFantasyGraphic());
  drafts.saveFantasyGraphicDraft('author', 2026, 7, value);
  assert.deepEqual(drafts.loadFantasyGraphicDraft('author', 2026, 7), value);
  value.form.slots[0].reason += ' with the latest words';
  drafts.saveFantasyGraphicDraft('author', 2026, 7, value);
  assert.equal(drafts.loadFantasyGraphicDraft('author', 2026, 7).form.slots[0].reason, value.form.slots[0].reason);
  assert.equal(drafts.loadFantasyGraphicDraft('other', 2026, 7), undefined);
  assert.equal(drafts.loadFantasyGraphicDraft('author', 2026, 8), undefined);
  assert.equal(drafts.loadFantasyGraphicDraft('author', 2025, 7), undefined);
  drafts.clearFantasyGraphicDraft('author', 2026, 7);
  assert.equal(drafts.loadFantasyGraphicDraft('author', 2026, 7), undefined);
});

test('Invalid data and storage failures are explicit and do not remove recoverable copies', () => {
  const key = 'gamewire-fantasy-graphic-draft:invalid:2026:7';
  records.set(key, '{"version":1,"form":"recoverable text"}');
  assert.throws(() => drafts.loadFantasyGraphicDraft('invalid', 2026, 7), /invalid/);
  assert.equal(JSON.parse(records.get(key)).form, 'recoverable text');
  assert.throws(() => drafts.saveFantasyGraphicDraft('invalid', 2026, 7, { ...draft(), editing: { ...row(draft().form), week: 8 } }), /different week/);
  assert.equal(JSON.parse(records.get(key)).form, 'recoverable text');
  storageFailure = true;
  try {
    assert.throws(() => drafts.loadFantasyGraphicDraft('author', 2026, 7), /unavailable/);
    assert.throws(() => drafts.saveFantasyGraphicDraft('author', 2026, 7, draft()), /Quota/);
    assert.throws(() => drafts.clearFantasyGraphicDraft('author', 2026, 7), /unavailable/);
  } finally { storageFailure = false; }
});

test('Offline caches validate player identity and week/account boundaries and report damaged storage', () => {
  const player = { id: '101', name: 'Saved QB', position: 'QB', teamId: '9', teamAbbr: 'GB',
    headshot: '', opponent: '', opponentLogo: '', matchup: 'TBD' };
  offline.saveFantasyRoster(2025, [player]);
  assert.deepEqual(offline.loadFantasyRoster(2025), [player]);
  offline.saveFantasySharedDrafts('cache-owner', 2025, 7, [{ ...row(graphics.emptyFantasyGraphic()), season: 2025 }]);
  assert.equal(offline.loadFantasySharedDrafts('cache-owner', 2025, 7).length, 1);
  assert.deepEqual(offline.loadFantasySharedDrafts('cache-owner', 2025, 8), []);
  assert.deepEqual(offline.loadFantasySharedDrafts('someone-else', 2025, 7), []);
  records.set('gamewire-fantasy-offline:workspace:bad', '{"admin":true,"season":"2026","week":7}');
  assert.throws(() => offline.loadFantasyWorkspace('bad'), /invalid/);
  records.set('gamewire-fantasy-offline:roster:2025', JSON.stringify([{ ...player, headshot: 'javascript:alert(1)' }]));
  assert.throws(() => offline.loadFantasyRoster(2025), /invalid player/);
  storageFailure = true;
  try {
    assert.throws(() => offline.saveFantasyWorkspace('cache-owner', { admin: true, season: 2025, week: 7 }), /Quota/);
    assert.throws(() => offline.loadFantasySharedDrafts('cache-owner', 2025, 7), /unavailable/);
  } finally { storageFailure = false; }
});

const source = readFileSync(new URL('../src/FantasyStartSit.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('FantasyStartSit.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'FantasyStartSit');
const compiled = ts.transpileModule(component.getText(parsed).replace('export default ', ''), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(userId, options = {}) {
  const hooks = [];
  let cursor = 0, changed = false, effects = [], tree;
  const props = { active: true, user: { id: userId }, season: 2026, week: 7, games: [] };
  const requests = [];
  const uploads = [];
  const removals = [];
  const listeners = new Map();
  const network = { onLine: options.online !== false };
  const rosterCalls = [];
  const roleCalls = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const context = vm.createContext({
    exports: {}, require: () => ({
      Fragment,
      jsx: (type, props, key) => { assert.ok(type, 'JSX element type exists'); return jsx(type, props, key); },
      jsxs: (type, props, key) => { assert.ok(type, 'JSX element type exists'); return jsxs(type, props, key); },
    }), ...graphics, ...drafts, ...offline,
    navigator: network,
    useOnlineStatus: () => network.onLine,
    console, AbortController, crypto: webcrypto, clearTimeout() {},
    message: (error) => error.message,
    window: { setTimeout() { return 1; },
      addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
      removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
      confirm: () => options.confirm !== false },
    GraphicPreview: 'graphic-preview', GraphicDownload: 'graphic-download', Plus: 'plus', RefreshCw: 'refresh',
    XPublishingStatus: 'x-publishing-status',
    OfflineImage: 'offline-image',
    fetchFantasyGraphicRoster: async () => {
      rosterCalls.push(true);
      if (options.rosterFailure) throw new Error('Roster feed unavailable');
      return { players: options.players ?? [], warning: '' };
    },
    renderFantasyGraphic: async () => {
      if (options.renderFailure) throw new Error('Graphic render failed');
      return new Blob(['png fixture'], { type: 'image/png' });
    },
    supabase: {
      storage: { from: (bucket) => ({
        upload: async (path, png, settings) => { uploads.push({ bucket, path, png, settings }); return { error: options.uploadFailure ? new Error('Upload failed') : null }; },
        remove: async (paths) => { removals.push(...paths); return { error: null }; },
      }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
        roleCalls.push(true);
        return options.roleFailure ? { error: new Error('Access feed unavailable') } : { data: { role: options.role ?? 'admin' } };
      } }) }) }),
      rpc(name, args) {
        if (name === 'list_fantasy_graphics') return { abortSignal: async () => options.feedFailure ? { error: new Error('Feed issue') } : { data: options.rows ?? [] } };
        return new Promise((resolve) => requests.push({ args, resolve }));
      },
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], (next) => {
        const value = typeof next === 'function' ? next(hooks[index]) : next;
        if (!Object.is(value, hooks[index])) { hooks[index] = value; changed = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!equal(hooks[index]?.deps, deps)) effects.push(() => {
        hooks[index]?.cleanup?.();
        hooks[index] = { deps, cleanup: effect() };
      });
    },
  });
  vm.runInContext(compiled, context);
  function render() {
    let passes = 0;
    do {
      assert.ok(++passes < 20, 'Effects settle without a render loop');
      changed = false; cursor = 0; effects = [];
      tree = context.FantasyStartSit(props);
      effects.forEach((effect) => effect());
    } while (changed);
    return tree;
  }
  function find(predicate, node = tree) {
    if (Array.isArray(node)) return node.flatMap((child) => find(predicate, child ?? null));
    if (!node || typeof node !== 'object' || !node.props) return [];
    return [...(predicate(node) ? [node] : []), ...find(predicate, node.props.children ?? null)];
  }
  async function settle() {
    for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); }
  }
  render();
  return {
    requests, uploads, removals, rosterCalls, roleCalls, settle, render, props, find,
    button(label) { return find((node) => node.type === 'button' && node.props.children === label)[0]; },
    create() { find((node) => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('Create graphic'))[0].props.onClick(); render(); },
    reason(index = 0) { return find((node) => node.type === 'textarea')[index]; },
    search() { return find((node) => node.type === 'input' && node.props.type === 'search')[0]; },
    checkbox() { return find((node) => node.type === 'input' && node.props.type === 'checkbox')[0]; },
    submit() { find((node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); render(); },
    alerts() { return find((node) => node.props.role === 'alert'); },
    switchWeek(week) { props.week = week; render(); },
    network(online) {
      network.onLine = online;
      listeners.get(online ? 'online' : 'offline')?.forEach((callback) => callback());
      render();
    },
    unmount() { hooks.forEach((hook) => hook?.cleanup?.()); },
  };
}

test('A phone page restart restores the latest keystroke before any effects or leave-page warning', async () => {
  const app = setup('phone');
  await app.settle();
  app.create();
  app.reason().props.onChange({ target: { value: 'Last keystroke before suspension' } });
  // Simulate termination before React can render again or run persistence effects.
  app.unmount();
  const restarted = setup('phone');
  await restarted.settle();
  assert.equal(restarted.reason().props.value, 'Last keystroke before suspension');
  restarted.search().props.onChange({ target: { value: 'Jordan' } });
  restarted.unmount();
  const again = setup('phone');
  await again.settle();
  assert.equal(again.search().props.value, 'Jordan');
  assert.equal(again.requests.length, 0, 'Local recovery must not publish or save remotely');
  again.props.active = false; again.render();
  again.props.active = true; again.render();
  assert.equal(again.reason().props.value, 'Last keystroke before suspension');
  again.unmount();
});

test('X opt-in is unchecked by default, persists per draft and survives a page restart', async () => {
  const app = setup('x-opt-in');
  await app.settle(); app.create();
  assert.equal(app.checkbox().props.checked, false);
  app.checkbox().props.onChange({ target: { checked: true } }); app.render();
  app.reason().props.onChange({ target: { value: 'Preserve opt-in while writing' } }); app.render();
  app.unmount();
  const restarted = setup('x-opt-in');
  await restarted.settle();
  assert.equal(restarted.checkbox().props.checked, true);
  restarted.button('Save shared draft').props.onClick(); restarted.render();
  assert.equal(restarted.requests[0].args.post_to_x, true);
  assert.equal(restarted.requests[0].args.graphic_image_path, null);
  restarted.requests[0].resolve({ data: [row(restarted.requests[0].args.graphic_content)] });
  await restarted.settle(); restarted.unmount();
});

function completeDraft() {
  return { ...draft(), postToX: true, form: { kind: 'start', position: 'QB', slots: [1,2,3,4].map((id) => ({
    reason: `Reason ${id}`, player: { id: String(id), name: `Player ${id}`, position: 'QB', teamId: '9',
      teamAbbr: 'GB', headshot: `https://a.espncdn.com/${id}.png`, opponent: '', opponentLogo: '', matchup: 'TBD' },
  })) } };
}

test('Publishing uploads the exact rendered PNG and sends it with the X choice in one publication RPC', async () => {
  drafts.saveFantasyGraphicDraft('publisher', 2026, 7, completeDraft());
  const app = setup('publisher');
  await app.settle(); app.submit(); await app.settle();
  assert.equal(app.uploads.length, 1);
  assert.equal(app.uploads[0].bucket, 'livewire-photos');
  assert.equal(app.uploads[0].png.type, 'image/png');
  assert.equal(app.uploads[0].settings.upsert, false);
  assert.equal(app.requests[0].args.graphic_image_path, app.uploads[0].path);
  assert.equal(app.requests[0].args.graphic_action, 'publish');
  assert.equal(app.requests[0].args.post_to_x, true);
  app.requests[0].resolve({ data: [{ ...row(app.requests[0].args.graphic_content), published_content: app.requests[0].args.graphic_content }] });
  await app.settle();
  assert.deepEqual(drafts.loadFantasyGraphicDraft('publisher', 2026, 7).form, graphics.emptyFantasyGraphic());
  assert.equal(drafts.loadFantasyGraphicDraft('publisher', 2026, 7).editing, null);
  assert.equal(app.reason().props.value, '');
  assert.equal(app.checkbox().props.checked, false);
  assert.equal(offline.loadFantasySharedDrafts('publisher', 2026, 7)[0].published_content.slots[0].reason, 'Reason 1');
  app.unmount();
  const restarted = setup('publisher');
  await restarted.settle();
  assert.equal(restarted.reason().props.value, '');
  assert.equal(restarted.checkbox().props.checked, false);
  restarted.reason().props.onChange({ target: { value: 'A new graphic after publishing' } }); restarted.render();
  restarted.button('Save shared draft').props.onClick(); restarted.render();
  assert.equal(restarted.requests[0].args.graphic_id, null, 'The next template must not overwrite the just-published graphic');
  assert.equal(restarted.requests[0].args.expected_revision, 0);
  restarted.requests[0].resolve({ data: [row(restarted.requests[0].args.graphic_content)] });
  await restarted.settle();
  restarted.unmount();
});

test('A late successful publish resets only its original week, not a different working template', async () => {
  drafts.saveFantasyGraphicDraft('late-publisher', 2026, 7, completeDraft());
  const app = setup('late-publisher');
  await app.settle(); app.submit(); await app.settle();
  app.switchWeek(8); await app.settle();
  drafts.saveFantasyGraphicDraft('late-publisher', 2026, 8, { ...draft(), form: {
    ...graphics.emptyFantasyGraphic(), slots: [{ player: null, reason: 'Other week draft' }, ...graphics.emptyFantasyGraphic().slots.slice(1)],
  } });
  app.requests[0].resolve({ data: [{ ...row(app.requests[0].args.graphic_content), published_content: app.requests[0].args.graphic_content }] });
  await app.settle();
  assert.equal(drafts.loadFantasyGraphicDraft('late-publisher', 2026, 7).form.slots[0].reason, '');
  assert.equal(drafts.loadFantasyGraphicDraft('late-publisher', 2026, 8).form.slots[0].reason, 'Other week draft');
  assert.equal(offline.loadFantasySharedDrafts('late-publisher', 2026, 7)[0].id, 'shared-id');
  app.unmount();
});

test('Cached editing access never bypasses server revocation and private cached rows stay account-scoped', async () => {
  offline.saveFantasyWorkspace('revoked', { admin: true, season: 2026, week: 7 });
  offline.saveFantasySharedDrafts('revoked', 2026, 7, [row(completeDraft().form)]);
  drafts.saveFantasyGraphicDraft('revoked', 2026, 7, completeDraft());
  const app = setup('revoked', { role: 'reader' });
  await app.settle();
  assert.equal(app.reason().props.value, 'Reason 1', 'Local edits remain recoverable after a role change');
  assert.equal(app.button('Publish graphic').props.disabled, true);
  assert.equal(app.button('Save shared draft').props.disabled, true);
  assert.equal(offline.loadFantasyWorkspace('revoked').admin, false);
  assert.deepEqual(offline.loadFantasySharedDrafts('different-account', 2026, 7), []);
  app.unmount();
});

test('Offline reopening can create, search saved players and edit without any feed/access request', async () => {
  const savedPlayer = completeDraft().form.slots[0].player;
  const app = setup('offline-author', { players: [savedPlayer] });
  await app.settle(); app.create(); await app.settle();
  assert.equal(app.rosterCalls.length, 1, 'Opening an online editor loads its roster');
  assert.equal(offline.loadFantasyRoster(2026).length, 1, `Roster is saved before going offline: ${JSON.stringify(app.alerts().map((node) => node.props.children))}`);
  app.reason().props.onChange({ target: { value: 'Original online reasoning' } }); app.render();
  app.unmount();
  const offlineApp = setup('offline-author', { online: false, roleFailure: true, feedFailure: true, rosterFailure: true });
  await offlineApp.settle();
  assert.equal(offlineApp.roleCalls.length, 0);
  assert.equal(offlineApp.rosterCalls.length, 0);
  assert.equal(offlineApp.reason().props.value, 'Original online reasoning');
  offlineApp.reason().props.onChange({ target: { value: 'Words written offline' } }); offlineApp.render();
  assert.equal(drafts.loadFantasyGraphicDraft('offline-author', 2026, 7).form.slots[0].reason, 'Words written offline');
  offlineApp.search().props.onChange({ target: { value: 'Player' } }); offlineApp.render();
  const result = offlineApp.find((node) => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes(savedPlayer.name))[0];
  assert.ok(result, 'Cached roster remains searchable without a network');
  result.props.onClick(); offlineApp.render();
  assert.equal(drafts.loadFantasyGraphicDraft('offline-author', 2026, 7).form.slots[0].player.id, savedPlayer.id);
  assert.equal(offlineApp.button('Save shared draft').props.disabled, true);
  assert.equal(offlineApp.button('Publish graphic').props.disabled, true);
  offlineApp.button('Close editor').props.onClick(); offlineApp.render();
  offlineApp.create();
  assert.equal(offlineApp.reason().props.value, '');
  offlineApp.reason().props.onChange({ target: { value: 'Created entirely offline' } }); offlineApp.render();
  assert.equal(offlineApp.requests.length, 0);
  offlineApp.unmount();
});

test('Feed/access failures, refresh and reconnect never hide or reset the working graphic', async () => {
  const options = { players: [] };
  const app = setup('feed-survivor', options);
  await app.settle(); app.create();
  app.reason().props.onChange({ target: { value: 'Keep this visible through all feed failures' } }); app.render();
  options.roleFailure = true; options.feedFailure = true; options.rosterFailure = true;
  app.find((node) => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('Refresh graphics'))[0].props.onClick();
  app.render();
  assert.equal(app.reason().props.value, 'Keep this visible through all feed failures', 'Access refresh must not temporarily unmount the editor');
  await app.settle();
  assert.equal(app.reason().props.value, 'Keep this visible through all feed failures');
  app.network(false); await app.settle();
  app.props.week = null; app.props.season = null; app.props.games = []; app.render();
  assert.equal(app.reason().props.value, 'Keep this visible through all feed failures', 'Missing live week must not switch draft scope');
  app.network(true); await app.settle();
  assert.equal(app.reason().props.value, 'Keep this visible through all feed failures');
  assert.equal(app.requests.length, 0, 'Reconnect must not automatically publish or save remotely');
  app.unmount();
});

test('An offline restart with no scoreboard restores the last editing week and cached shared graphics', async () => {
  offline.saveFantasyWorkspace('saved-workspace', { admin: true, season: 2026, week: 7 });
  const shared = row(completeDraft().form, 5);
  offline.saveFantasySharedDrafts('saved-workspace', 2026, 7, [shared]);
  const app = setup('saved-workspace', { online: false });
  app.props.week = null; app.props.season = null; app.render(); await app.settle();
  const sharedButton = app.find((node) => node.type === 'button' && node.props.className === undefined
    && Array.isArray(node.props.children) && node.props.children.includes('QB'))[0];
  assert.ok(sharedButton, 'Previously loaded shared graphics remain available offline');
  sharedButton.props.onClick(); app.render();
  assert.equal(app.reason().props.value, 'Reason 1');
  assert.equal(drafts.loadFantasyGraphicDraft('saved-workspace', 2026, 7).editing.revision, 5);
  app.unmount();
});

test('Rendering/upload failures never publish, and a confirmed rejection cleans the unused image without losing the draft', async () => {
  for (const failure of ['renderFailure', 'uploadFailure']) {
    drafts.saveFantasyGraphicDraft(failure, 2026, 7, completeDraft());
    const app = setup(failure, { [failure]: true });
    await app.settle(); app.submit(); await app.settle();
    assert.equal(app.requests.length, 0);
    assert.ok(app.alerts().length);
    assert.equal(app.reason().props.value, 'Reason 1');
    app.unmount();
  }
  drafts.saveFantasyGraphicDraft('rejected', 2026, 7, completeDraft());
  const app = setup('rejected');
  await app.settle(); app.submit(); await app.settle();
  app.requests[0].resolve({ error: { code: 'P0001', message: 'Revision conflict' } });
  await app.settle();
  assert.deepEqual(app.removals, [app.uploads[0].path]);
  assert.equal(app.reason().props.value, 'Reason 1');
  assert.ok(drafts.loadFantasyGraphicDraft('rejected', 2026, 7).dirty);
  app.unmount();
});

test('Multiple weeks and accounts keep independent open drafts and explicit closing removes recovery', async () => {
  const app = setup('weeks');
  await app.settle();
  app.create();
  app.reason().props.onChange({ target: { value: 'Week seven' } }); app.render();
  app.switchWeek(8); await app.settle();
  assert.equal(app.reason(), undefined);
  app.create();
  app.reason().props.onChange({ target: { value: 'Week eight' } }); app.render();
  app.switchWeek(7); await app.settle();
  assert.equal(app.reason().props.value, 'Week seven');
  app.props.user = { id: 'different-account' }; app.render(); await app.settle();
  assert.equal(app.reason(), undefined);
  app.props.user = { id: 'weeks' }; app.render(); await app.settle();
  assert.equal(app.reason().props.value, 'Week seven');
  app.button('Close editor').props.onClick(); app.render();
  assert.equal(drafts.loadFantasyGraphicDraft('weeks', 2026, 7), undefined);
  assert.equal(drafts.loadFantasyGraphicDraft('weeks', 2026, 8).form.slots[0].reason, 'Week eight');
  app.unmount();
});

test('Storage errors keep the editor visible, expose retry, and do not falsely claim successful recovery', async () => {
  const app = setup('failure');
  await app.settle(); app.create();
  storageFailure = true;
  try {
    app.reason().props.onChange({ target: { value: 'Not yet persisted' } }); app.render();
    assert.equal(app.reason().props.value, 'Not yet persisted');
    assert.ok(app.alerts().some((node) => JSON.stringify(node.props.children).includes('saving failed')));
    app.button('Close editor').props.onClick(); app.render();
    assert.ok(app.reason(), 'Failed clearing must not dismiss the editor');
    app.switchWeek(8); await app.settle();
    app.switchWeek(7); await app.settle();
    assert.equal(app.reason().props.value, 'Not yet persisted', 'Storage failure must not lose the in-memory draft on week changes');
    assert.ok(app.alerts().length, 'Returning to an unprotected draft must retain the warning');
  } finally { storageFailure = false; }
  app.button('Retry on-device draft').props.onClick(); app.render();
  assert.equal(app.alerts().filter((node) => JSON.stringify(node.props.children).includes('On-device draft saving failed')).length, 0);
  assert.equal(drafts.loadFantasyGraphicDraft('failure', 2026, 7).form.slots[0].reason, 'Not yet persisted');
  app.unmount();
});

test('Canceled discard/replacement and failed restoration preserve the recoverable draft', async () => {
  const app = setup('cancel', { confirm: false });
  await app.settle(); app.create();
  app.reason().props.onChange({ target: { value: 'Keep my words' } }); app.render();
  app.button('Close editor').props.onClick(); app.render();
  app.create();
  assert.equal(app.reason().props.value, 'Keep my words');
  app.unmount();
  const key = 'gamewire-fantasy-graphic-draft:corrupt:2026:7';
  const raw = '{"version":1,"form":"text for recovery"}';
  records.set(key, raw);
  const corrupt = setup('corrupt', { confirm: false });
  await corrupt.settle();
  assert.ok(corrupt.alerts().length);
  corrupt.create();
  assert.equal(corrupt.reason(), undefined);
  assert.equal(records.get(key), raw);
  corrupt.unmount();
});

test('Shared saves retain revision across reload and a week change while the request is pending', async () => {
  const app = setup('save');
  await app.settle(); app.create();
  app.reason().props.onChange({ target: { value: 'Shared work' } }); app.render();
  app.button('Save shared draft').props.onClick(); app.render();
  assert.equal(app.requests[0].args.graphic_id, null);
  app.switchWeek(8); await app.settle();
  app.requests[0].resolve({ data: [row(app.requests[0].args.graphic_content, 4)] });
  await app.settle();
  app.switchWeek(7); await app.settle();
  assert.equal(app.reason().props.value, 'Shared work');
  app.unmount();
  const restarted = setup('save');
  await restarted.settle();
  restarted.button('Save shared draft').props.onClick(); restarted.render();
  assert.equal(restarted.requests[0].args.graphic_id, 'shared-id');
  assert.equal(restarted.requests[0].args.expected_revision, 4);
  restarted.requests[0].resolve({ error: new Error('Revision conflict') });
  await restarted.settle();
  assert.equal(restarted.reason().props.value, 'Shared work');
  assert.ok(restarted.alerts().some((node) => node.props.children === 'Revision conflict'));
  restarted.unmount();
});
