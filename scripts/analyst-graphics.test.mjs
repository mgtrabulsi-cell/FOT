import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { angleSportRecords } from '../src/services/theAngle.ts';
import { isParlaySubject } from '../src/services/parlayGraphic.ts';
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
  assert.deepEqual(Array.from(sections, row => row.title), ['ALL STRAIGHTS', '#1 SPORT / NBA', '#2 SPORT / NHL', '#3 SPORT / NFL']);
  assert.equal(sections[0].wins, 19); assert.equal(sections[0].losses, 7);
  assert.equal(sections[1].hitRate, .8); assert.equal(sections[2].hitRate, .8);
});
test('Sport leaderboard needs at least five decisive settled straights; small sports still count in overall record', () => {
  const sections = recordSections([story('UCL', 1, 0), story('NFL', 4, 0), story('NBA', 4, 1), story('NHL', 5, 0)]);
  assert.deepEqual(Array.from(sections, row => row.title), ['ALL STRAIGHTS', '#1 SPORT / NHL', '#2 SPORT / NBA']);
  assert.equal(sections[0].wins, 14); assert.equal(sections[0].losses, 1);
});
test('Empty records show no invented top sports or win rate; Combo is not a sport leaderboard', () => {
  const sections = recordSections([story('NFL', 0, 0), story('COMBO', 2, 0)]);
  assert.equal(sections.length, 1); assert.equal(sections[0].wins, 2);
  assert.equal(recordSections([])[0].hitRate, null);
});
function renderer({ noBlob = false, imageError = false } = {}) {
  const texts = [], lines = [], images = [], crops = [], fills = [];
  const ctx = new Proxy({ measureText: text => ({ width: text.length * (parseFloat(ctx.font.split(' ')[1]) || 20) * .5 }),
    fillText: (text, x, y) => texts.push({ text, x, y }), moveTo: (...point) => lines.push(point),
    drawImage: (...args) => images.push(args), fillRect: (...args) => fills.push(args),
    createLinearGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: callback => callback(noBlob ? null : new Blob(['png'], { type: 'image/png' })) };
  const context = vm.createContext({ exports: {}, crypto, Blob, document: { createElement: () => canvas },
    require: name => name.endsWith('/parlayGraphic') ? { isParlaySubject } : name.endsWith('/parlayGraphicImage') ? {
      loadGraphicImage: async url => { if (imageError) throw new Error('Image could not load'); return { url, naturalWidth: 300, naturalHeight: 200 }; },
      drawGraphicPortrait: (...args) => crops.push(args),
    } : ({ loadGamewireGraphicAssets: async () => ({ naturalWidth: 1536, naturalHeight: 1024 }) }) });
  vm.runInContext(compile('../src/services/bestBetGraphic.ts'), context);
  return { ...context.exports, texts, lines, canvas, images, crops, fills };
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
const participant = { type: 'player', subject: { id: '1', name: 'Player', image: 'https://a.espncdn.com/player.png',
  teamId: '1', teamName: 'Team', teamLogo: 'https://a.espncdn.com/team.png', color: '123456' } };
test('Legacy drafts restore with images enabled; selected image snapshots are validated and preserved', () => {
  const r = renderer(), draft = r.newBestBetGraphic(); draft.entries[0].selection = 'Over 50 yards';
  delete draft.images; draft.entries[0].participant = participant;
  assert.equal(r.readBestBetGraphic(draft).images, true);
  assert.equal(r.readBestBetGraphic(draft).entries[0].participant.subject.name, 'Player');
  for (const invalid of [{ ...participant, type: 'other' }, { ...participant, subject: { ...participant.subject, image: 'javascript:bad' } }])
    assert.throws(() => r.readBestBetGraphic({ ...draft, entries: [{ ...draft.entries[0], participant: invalid }] }), /invalid/);
});
test('One to three straight exports shrink to their pick count with larger text, while every count stays in bounds', async () => {
  for (let count = 1; count <= 8; count++) {
    const r = renderer(), draft = { title: 'BEST BETS', subtitle: '', entries: Array.from({ length: count }, (_, i) => ({
      id: String(i), sport: 'NFL', selection: `Straight ${i} Over 60 receiving yards`, odds: '-110', result: 'pending',
    })) };
    await r.renderBestBetGraphic(draft);
    assert.equal(r.canvas.height, r.bestBetGraphicHeight(count) * 2);
    if (count <= 3) assert.ok(r.canvas.height < 2700);
    assert.ok(r.texts.every(row => row.y > 0 && row.y < r.canvas.height / 2));
    assert.equal(r.fills.filter(args => args[0] === 70 && args[2] === 940 && args[3] === 2).length, count - 1, 'Visible divider between every pair of straights');
  }
});
test('Player photos use the shared portrait crop, team logos stay contained, and image failures are explicit', async () => {
  const r = renderer(), draft = { title: 'BEST BETS', subtitle: '', entries: [
    { id: '1', sport: 'NFL', selection: 'Over 60 receiving yards', odds: '-110', result: 'pending', participant },
    { id: '2', sport: 'NFL', selection: 'Moneyline', odds: '+150', result: 'pending', participant: { ...participant, type: 'team' } },
  ] };
  await r.renderBestBetGraphic(draft);
  assert.equal(r.crops.length, 1);
  assert.equal(r.images.length, 3, 'Brand logo, team badge and contained team subject');
  assert.ok(r.texts.some(row => row.text.includes('Player / NFL')));
  await assert.rejects(renderer({ imageError: true }).renderBestBetGraphic(draft), /Image could not load/);
  const textOnly = renderer({ imageError: true });
  await textOnly.renderBestBetGraphic({ ...draft, images: false });
  assert.equal(textOnly.crops.length, 0); assert.equal(textOnly.images.length, 1);
});
test('Eight portrait rows keep two-line selections above their dividers and outside the result marks', async () => {
  const r = renderer(), draft = { title: 'BEST BETS', subtitle: '', entries: Array.from({ length: 8 }, (_, i) => ({
    id: String(i), sport: 'NFL', selection: `Pick${i} over receiving yards plus rushing yards against the opponent this week with exact line 125.5`,
    odds: '-110', result: 'pending', participant,
  })) };
  await r.renderBestBetGraphic(draft);
  for (let i = 0; i < 8; i++) {
    const first = r.texts.findIndex(row => row.text.includes(`Pick${i}`)), top = 318 + i * 97.5;
    const firstLine = r.texts[first], secondLine = r.texts[first + 1];
    assert.ok(firstLine.x >= 74 + 57.5 + 24);
    assert.ok(firstLine.y > top && firstLine.y < top + 77.5);
    assert.ok(secondLine.y > firstLine.y && secondLine.y < top + 77.5);
  }
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
    } : name.includes('bestBetGraphic') ? r : name.includes('BestBetSubjectPicker') ? { default: () => null } : {} });
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
  find(render(), node => typeof node.props?.onChoose === 'function').props.onChoose('NBA', participant);
  assert.equal(JSON.parse(saved.get('gamewire:best-bet-draft:v1:owner')).entries[0].participant.subject.image, participant.subject.image);
  assert.equal(JSON.parse(saved.get('gamewire:best-bet-draft:v1:owner')).entries[0].sport, 'NBA');
  assert.equal(saved.size, 1);
  saved.set('gamewire:best-bet-draft:v1:owner', 'invalid json');
  state.length = 0; tree = render();
  assert.equal(find(tree, node => node.type === 'fieldset').props.disabled, true);
  assert.equal(saved.get('gamewire:best-bet-draft:v1:owner'), 'invalid json', 'Invalid drafts are never silently overwritten');
});
test('Best Bet roster picker loads only on opening and stores verified player/team snapshots with explicit retry errors', async () => {
  const states = [], effects = [], dependencies = [], calls = [], selections = []; let index = 0, effectIndex = 0, failed = false;
  const team = { id: '1', name: 'Test Team', logo: participant.subject.teamLogo, color: '123456' };
  const player = { id: '2', name: 'Test Player', image: participant.subject.image, position: 'WR' };
  const source = ts.transpileModule(readFileSync(new URL('../src/BestBetSubjectPicker.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = vm.createContext({ exports: {}, AbortController, require: name => name === 'react/jsx-runtime' ? jsxRuntime : name === 'react' ? {
    useState: initial => { const i = index++; if (!(i in states)) states[i] = initial;
      return [states[i], next => states[i] = typeof next === 'function' ? next(states[i]) : next]; },
    useEffect: (callback, next) => { const i = effectIndex++;
      if (!dependencies[i] || next.some((value, index) => value !== dependencies[i][index])) effects.push(callback);
      dependencies[i] = next; },
  } : {
    loadParlayTeams: async league => { calls.push(['teams', league]); if (failed) throw new Error('Roster unavailable');
      return { data: { teams: [team], season: 2026 }, warning: 'Using a saved roster' }; },
    loadParlayPlayers: async (...args) => { calls.push(['players', ...args.slice(0, 3)]); return { data: { players: [player] }, warning: '' }; },
  } });
  vm.runInContext(source, context);
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const render = () => { index = 0; effectIndex = 0; effects.length = 0; return nodes(context.exports.default({
    sport: 'NFL', onChoose: (...args) => selections.push(args),
  })); };
  const flush = async () => { effects.splice(0).forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)); };
  let tree = render(); await flush(); assert.equal(calls.length, 0, 'Closed picker makes no network requests');
  tree.find(node => node.type === 'details').props.onToggle({ currentTarget: { open: true } });
  render(); await flush(); tree = render();
  assert.ok(tree.some(node => node.props?.className === 'parlay-warning'), 'Offline roster warning remains visible');
  tree.find(node => node.type === 'select' && node.props.value === '').props.onChange({ target: { value: '1' } });
  render(); await flush(); tree = render();
  tree.find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === 'Test Player').props.onClick();
  assert.equal(selections[0][0], 'NFL'); assert.equal(selections[0][1].type, 'player');
  assert.equal(selections[0][1].subject.image, player.image); assert.equal(selections[0][1].subject.teamLogo, team.logo);
  tree.find(node => node.type === 'select' && node.props.value === 'player').props.onChange({ target: { value: 'team' } });
  tree = render(); tree.find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === 'Use ').props.onClick();
  assert.equal(selections[1][1].type, 'team'); assert.equal(selections[1][1].subject.image, team.logo);
  failed = true; tree.find(node => node.type === 'select' && node.props.value === 'NFL').props.onChange({ target: { value: 'NBA' } });
  render(); await flush(); tree = render();
  assert.ok(tree.some(node => node.props?.role === 'alert'));
  assert.ok(tree.some(node => node.type === 'button' && node.props.children === 'Retry image search'));
});
