import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { angleSportRecords } from '../src/services/theAngle.ts';
import * as jsxRuntime from 'react/jsx-runtime';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const recordContext = vm.createContext({ exports: {}, require: name => name.includes('theAngle') ? { angleSportRecords } : {} });
vm.runInContext(compile('../src/services/analystResultsGraphic.ts'), recordContext);
const recordSections = recordContext.exports.analystResultsSections;
const story = (sport, wins, losses, category = 'straight', status = 'published') => ({ game_id: `${sport}:0`, status, id: sport, pick: '',
  picks: [...Array.from({ length: wins }, (_, i) => ({ id: `win-${i}`, result: 'hit', category, text: 'Selection' })),
    ...Array.from({ length: losses }, (_, i) => ({ id: `loss-${i}`, result: 'miss', category, text: 'Selection' })),
    { id: 'pending', result: 'pending', category, text: 'Selection' }] });
test('Analyst graphic contains straights only and ranks three real sports by rate then settled wins', () => {
  const sections = recordSections([story('NFL', 6, 4), story('NBA', 8, 2), story('NHL', 4, 1), story('UFC', 1, 0),
    story('CFB', 100, 0, 'parlay'), story('UCL', 100, 0, 'sprinkle'), story('SOCCER', 100, 0, 'straight', 'draft')]);
  assert.deepEqual(Array.from(sections, row => row.title), ['ALL STRAIGHTS', '#1 SPORT / UFC', '#2 SPORT / NBA', '#3 SPORT / NHL']);
  assert.equal(sections[0].wins, 19); assert.equal(sections[0].losses, 7);
  assert.equal(sections[1].hitRate, 1); assert.equal(sections[2].hitRate, .8);
});
test('Empty records show no invented top sports or win rate; Combo is not a sport leaderboard', () => {
  const sections = recordSections([story('NFL', 0, 0), story('COMBO', 2, 0)]);
  assert.equal(sections.length, 1); assert.equal(sections[0].wins, 2);
  assert.equal(recordSections([])[0].hitRate, null);
});
function renderer({ noBlob = false } = {}) {
  const texts = [], lines = [];
  const ctx = new Proxy({ measureText: text => ({ width: text.length * (parseFloat(ctx.font.split(' ')[1]) || 20) * .5 }),
    fillText: (text, x, y) => texts.push({ text, x, y }), moveTo: (...point) => lines.push(point),
    createLinearGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: callback => callback(noBlob ? null : new Blob(['png'], { type: 'image/png' })) };
  const context = vm.createContext({ exports: {}, crypto, Blob, document: { createElement: () => canvas },
    require: () => ({ loadGamewireGraphicAssets: async () => ({ naturalWidth: 1536, naturalHeight: 1024 }) }) });
  vm.runInContext(compile('../src/services/bestBetGraphic.ts'), context);
  return { ...context.exports, texts, lines, canvas };
}
test('Manual Best Bet graphic validates draft shape, odds and required separate selections', () => {
  const r = renderer(), draft = r.newBestBetGraphic();
  assert.match(r.bestBetGraphicError(draft), /sport and selection/);
  draft.entries[0].selection = 'Player Over 60 receiving yards';
  assert.equal(r.bestBetGraphicError(draft), null);
  for (const odds of ['110', '-99', 'abc', '+000']) {
    draft.entries[0].odds = odds; assert.match(r.bestBetGraphicError(draft), /American odds/);
  }
  draft.entries[0].odds = '-110'; assert.equal(r.bestBetGraphicError(draft), null);
  for (const invalid of [{}, { ...draft, entries: [] }, { ...draft, entries: [...draft.entries, draft.entries[0]] }])
    assert.throws(() => r.readBestBetGraphic(invalid), /invalid/);
});
test('Best Bet export fits eight independent straights, distinguishes pending from settled and exports high resolution', async () => {
  const r = renderer(), draft = { title: 'NFL BEST BETS', subtitle: 'Week 9 / Sunday 1 PM ET',
    entries: Array.from({ length: 8 }, (_, i) => ({ id: String(i), sport: 'NFL', selection: `Player ${i} Over 60 receiving yards`, odds: '-110', result: i === 0 ? 'hit' : i === 1 ? 'miss' : 'pending' })) };
  assert.equal((await r.renderBestBetGraphic(draft)).type, 'image/png');
  assert.equal(r.canvas.width, 2160); assert.equal(r.canvas.height, 2700);
  assert.ok(r.texts.some(row => row.text === '1 / 2 STRAIGHTS HIT'));
  assert.ok(r.texts.every(row => row.y > 0 && row.y <= 1325));
  for (let i = 0; i < 8; i++) {
    const row = r.texts.find(row => row.text.includes(`Player ${i}`));
    assert.ok(row.y >= 318 + i * 97.5 && row.y < 318 + (i + 1) * 97.5 - 8);
  }
  assert.equal(r.lines.length, 3, 'Only settled rows draw result marks');
  const pending = renderer(); await pending.renderBestBetGraphic({ ...draft, entries: draft.entries.map(row => ({ ...row, result: 'pending' })) });
  assert.equal(pending.lines.length, 0);
  assert.ok(pending.texts.some(row => row.text === '8 BEST BETS'));
  assert.ok(!pending.texts.some(row => /STRAIGHTS HIT/.test(row.text)));
  await assert.rejects(renderer({ noBlob: true }).renderBestBetGraphic(draft), /could not export/);
});
test('Manual builder restores account-owned drafts and synchronously saves edits without touching another account', () => {
  const saved = new Map(), r = renderer(), value = r.newBestBetGraphic(); value.entries[0].selection = 'Saved selection';
  saved.set('gamewire:best-bet-draft:v1:owner', JSON.stringify(value));
  const state = []; let index = 0;
  const source = ts.transpileModule(readFileSync(new URL('../src/BestBetGraphicBuilder.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = vm.createContext({ exports: {}, localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    require: name => name === 'react/jsx-runtime' ? jsxRuntime : name === 'react' ? {
      useState: initial => { const i = index++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
        return [state[i], next => state[i] = typeof next === 'function' ? next(state[i]) : next]; },
      useRef: () => ({ current: '' }), useEffect() {},
    } : name.includes('bestBetGraphic') ? r : {} });
  vm.runInContext(source, context);
  const render = () => { index = 0; return context.exports.default({ userId: 'owner' }); };
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    for (const child of Array.isArray(node) ? node : [node.props?.children].flat()) { const found = find(child, predicate); if (found) return found; }
  };
  let tree = render();
  assert.equal(find(tree, node => node.type === 'textarea').props.value, 'Saved selection');
  find(tree, node => node.type === 'textarea').props.onChange({ target: { value: 'Edited independent straight' } });
  assert.equal(JSON.parse(saved.get('gamewire:best-bet-draft:v1:owner')).entries[0].selection, 'Edited independent straight');
  assert.equal(saved.size, 1);
  saved.set('gamewire:best-bet-draft:v1:owner', 'invalid json');
  state.length = 0; tree = render();
  assert.equal(find(tree, node => node.type === 'fieldset').props.disabled, true);
  assert.equal(saved.get('gamewire:best-bet-draft:v1:owner'), 'invalid json', 'Invalid drafts are never silently overwritten');
});
