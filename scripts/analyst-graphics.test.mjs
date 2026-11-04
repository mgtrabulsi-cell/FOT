import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { angleSportRecords } from '../src/services/theAngle.ts';
import { isParlaySubject } from '../src/services/parlayGraphic.ts';
import * as jsxRuntime from 'react/jsx-runtime';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('import.meta.env.BASE_URL', JSON.stringify('/')),
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
function renderer({ noBlob = false, imageError = false, stadiumError = false } = {}) {
  const texts = [], lines = [], images = [], crops = [], fills = [];
  const ctx = new Proxy({ measureText: text => {
    const size = Number(/([\d.]+)px/.exec(ctx.font)?.[1]) || 20, width = text.length * size * .5;
    return { width, actualBoundingBoxLeft: ctx.textAlign === 'center' ? width / 2 : 0,
      actualBoundingBoxRight: ctx.textAlign === 'center' ? width / 2 : width,
      actualBoundingBoxAscent: size * .75, actualBoundingBoxDescent: size * .2 };
  },
    fillText: (text, x, y) => texts.push({ text, x, y, font: ctx.font, bounds: ctx.measureText(text) }), moveTo: (...point) => lines.push(point),
    drawImage: (...args) => images.push(args), fillRect: (...args) => fills.push(args),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: callback => callback(noBlob ? null : new Blob(['png'], { type: 'image/png' })) };
  let style;
  const context = vm.createContext({ exports: {}, crypto, Blob, Error, setTimeout, clearTimeout,
    Image: class { naturalWidth = 1024; naturalHeight = 1536; set src(value) { if (value) { if (stadiumError) this.onerror(); else this.onload(); } } },
    document: { createElement: () => canvas, fonts: { load: async () => [{}], check: () => true } },
    require: name => name.endsWith('/betGraphicStyle') ? style : name.endsWith('/parlayGraphic') ? { isParlaySubject } : name.endsWith('/parlayGraphicImage') ? {
      loadGraphicImage: async url => { if (imageError) throw new Error('Image could not load'); return { url, naturalWidth: 300, naturalHeight: 200 }; },
      drawGraphicPortrait: (...args) => crops.push(args),
    } : ({ loadGamewireGraphicAssets: async () => ({ naturalWidth: 1536, naturalHeight: 1024 }) }) });
  vm.runInContext(compile('../src/services/betGraphicStyle.ts'), context);
  style = context.exports;
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
test('One to eight straight exports use identical 150px rows and count-sized canvases without clipping', async () => {
  for (let count = 1; count <= 8; count++) {
    const r = renderer(), draft = { title: 'BEST BETS', subtitle: '', entries: Array.from({ length: count }, (_, i) => ({
      id: String(i), sport: 'NFL', selection: `Straight ${i} Over 60 receiving yards`, odds: '-110', result: 'pending',
    })) };
    await r.renderBestBetGraphic(draft);
    assert.equal(r.canvas.height, r.bestBetGraphicHeight(count) * 2);
    if (count <= 3) assert.ok(r.canvas.height < 2700);
    assert.ok(r.texts.every(row => row.y > 0 && row.y < r.canvas.height / 2));
    assert.equal(r.texts.filter(row => row.text.startsWith('Straight ')).length, count);
    for (let i = 0; i < count; i++) {
      const selection = r.texts.find(row => row.text.startsWith(`Straight ${i}`));
      assert.equal(selection.x, 252);
      assert.equal(selection.y, 315 + i * 150);
      const odds = r.texts.filter(row => row.text === '-110')[i];
      assert.equal(odds.x, 994);
      assert.equal(odds.y, 335 + i * 150);
    }
  }
});
test('Missing stadium art blocks export explicitly and the original background is precached for offline graphics', async () => {
  const r = renderer({ stadiumError: true }), draft = r.newBestBetGraphic();
  draft.entries[0].selection = 'Over 50 yards';
  await assert.rejects(r.renderBestBetGraphic(draft), /stadium background could not load/);
  assert.match(readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8'), /'bet-stadium-night\.png'/);
});
test('Best Bet exports never load player photos or team logos, including legacy drafts', async () => {
  const r = renderer(), draft = { title: 'BEST BETS', subtitle: '', entries: [
    { id: '1', sport: 'NFL', selection: 'Over 60 receiving yards', odds: '-110', result: 'pending', participant },
    { id: '2', sport: 'NFL', selection: 'Moneyline', odds: '+150', result: 'pending', participant: { ...participant, type: 'team' } },
  ] };
  await r.renderBestBetGraphic(draft);
  assert.equal(r.crops.length, 0);
  assert.equal(r.images.length, 2, 'Only the stadium background and GameWire brand are drawn');
  assert.ok(r.texts.some(row => row.text === 'Player'));
  await renderer({ imageError: true }).renderBestBetGraphic(draft);
  const textOnly = renderer({ imageError: true });
  await textOnly.renderBestBetGraphic({ ...draft, images: false });
  assert.equal(textOnly.crops.length, 0); assert.equal(textOnly.images.length, 2);
});
test('Best Bet matches the brand-style font with lighter medium-bold names and selections', async () => {
  const r = renderer();
  await r.renderBestBetGraphic({ title: 'BEST BETS', subtitle: 'Tonight', entries: [
    { id: '1', sport: 'NBA', selection: 'Over 25.5 points', odds: '-110', result: 'pending', participant },
  ] });
  assert.match(r.texts.find(row => row.text === 'BEST BETS').font, /^italic 700 .*"DM Sans"/);
  assert.match(r.texts.find(row => row.text === 'GAME').font, /^italic 700 .*"DM Sans"/);
  assert.match(r.texts.find(row => row.text === 'Player').font, /^italic 600 .*"DM Sans"/);
  assert.match(r.texts.find(row => row.text === 'Over 25.5 points').font, /^italic 600 .*"DM Sans"/);
  assert.match(r.texts.find(row => row.text === 'Tonight').font, /^italic 600 .*"DM Sans"/);
});
test('Both banner titles are optically centered inside the same compact inset frame', async () => {
  for (const title of ['BEST BETS', 'PARLAY']) {
    const r = renderer(), draft = r.newBestBetGraphic();
    draft.title = title; draft.entries[0].selection = 'Over 25.5 points';
    await r.renderBestBetGraphic(draft);
    const label = r.texts.find(row => row.text === title), bounds = label.bounds;
    const left = label.x - bounds.actualBoundingBoxLeft, right = label.x + bounds.actualBoundingBoxRight;
    const top = label.y - bounds.actualBoundingBoxAscent, bottom = label.y + bounds.actualBoundingBoxDescent;
    assert.equal((left + right) / 2, 847.5);
    assert.ok(Math.abs((top + bottom) / 2 - 84) < .001);
    assert.ok(left > 697 && right < 998, 'Lettering stays within the angled frame');
    assert.ok(top > 40 && bottom < 128);
  }
});
test('League captions and row sport labels are centered; default caption contains only leagues', async () => {
  const r = renderer(), draft = r.newBestBetGraphic();
  draft.entries = ['NBA', 'NFL'].map((sport, index) => ({
    id: String(index), sport, selection: 'Over 25.5 points', odds: '', result: 'pending',
  }));
  await r.renderBestBetGraphic(draft);
  const caption = r.texts.find(row => row.text === 'NBA / NFL');
  assert.equal(caption.x, 540);
  assert.ok(Math.abs(caption.y + (caption.bounds.actualBoundingBoxDescent - caption.bounds.actualBoundingBoxAscent) / 2 - 205) < .001);
  for (let index = 0; index < 2; index++) {
    const label = r.texts.find(row => row.text === draft.entries[index].sport);
    assert.equal(label.x, 140);
    assert.ok(Math.abs(label.y + (label.bounds.actualBoundingBoxDescent - label.bounds.actualBoundingBoxAscent) / 2 - (325 + 150 * index)) < .001);
  }
  assert.ok(!r.texts.some(row => /demonstration picks/i.test(row.text)));
});
test('Eight name-only rows keep two-line selections above their dividers and outside result marks', async () => {
  const r = renderer(), draft = { title: 'BEST BETS', subtitle: '', entries: Array.from({ length: 8 }, (_, i) => ({
    id: String(i), sport: 'NFL', selection: `Pick${i} over receiving yards plus rushing yards against the opponent this week with exact line 125.5`,
    odds: '-110', result: 'pending', participant,
  })) };
  await r.renderBestBetGraphic(draft);
  for (let i = 0; i < 8; i++) {
    const first = r.texts.findIndex(row => row.text.includes(`Pick${i}`)), top = 250 + i * 150;
    const firstLine = r.texts[first], secondLine = r.texts[first + 1];
    assert.equal(firstLine.x, 252);
    assert.ok(firstLine.y > top + 55 && firstLine.y < top + 130);
    assert.ok(secondLine.y > firstLine.y && secondLine.y < top + 130);
  }
});
test('Best Bet export fits eight independent straights, distinguishes pending from settled and exports high resolution', async () => {
  const r = renderer(), draft = { title: 'NFL BEST BETS', subtitle: 'Week 9 / Sunday 1 PM ET',
    entries: Array.from({ length: 8 }, (_, i) => ({ id: String(i), sport: 'NFL', selection: `Player ${i} Over 60 receiving yards`, odds: '-110', result: i === 0 ? 'hit' : i === 1 ? 'miss' : 'pending' })) };
  assert.equal((await r.renderBestBetGraphic(draft)).type, 'image/png');
  assert.equal(r.canvas.width, 2160); assert.equal(r.canvas.height, 3280);
  assert.ok(r.texts.some(row => row.text === '1 / 2 STRAIGHTS HIT'));
  assert.ok(r.texts.every(row => row.y > 0 && row.y < 1640));
  for (let i = 0; i < 8; i++) {
    const row = r.texts.find(row => row.text.includes(`Player ${i}`));
    assert.ok(row.y >= 250 + i * 150 && row.y < 250 + (i + 1) * 150);
  }
  const pending = renderer(); await pending.renderBestBetGraphic({ ...draft, entries: draft.entries.map(row => ({ ...row, result: 'pending' })) });
  assert.equal(r.texts.filter(row => row.text === 'HIT' || row.text === 'MISS').length, 2);
  assert.equal(pending.texts.filter(row => row.text === 'HIT' || row.text === 'MISS').length, 0);
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
  tree = render();
  const picker = find(tree, node => typeof node.props?.onChoose === 'function');
  const bet = find(picker.props.children, node => node.type === 'textarea');
  assert.equal(bet.props.value, 'Edited independent straight', 'Choosing a player retains the bet in that player card');
  assert.equal(find(picker.props.children, node => node.type === 'label' && Array.isArray(node.props?.children)
    && node.props.children[0] === 'Bet for Player').props.children[0], 'Bet for Player');
  bet.props.onChange({ target: { value: 'Over 65.5 receiving yards' } });
  assert.equal(JSON.parse(saved.get('gamewire:best-bet-draft:v1:owner')).entries[0].selection, 'Over 65.5 receiving yards');
  assert.equal(saved.size, 1);
  saved.set('gamewire:best-bet-draft:v1:owner', 'invalid json');
  state.length = 0; tree = render();
  assert.equal(find(tree, node => node.type === 'fieldset').props.disabled, true);
  assert.equal(saved.get('gamewire:best-bet-draft:v1:owner'), 'invalid json', 'Invalid drafts are never silently overwritten');
  assert.doesNotMatch(readFileSync(new URL('../src/BestBetGraphicBuilder.tsx', import.meta.url), 'utf8'), /<label>Sport/);
  assert.doesNotMatch(readFileSync(new URL('../src/ParlayGraphicBuilder.tsx', import.meta.url), 'utf8'), /Entry method|NBA \/ NFL roster picker/);
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
    isRosterSport: value => ['NBA', 'NFL', 'NHL', 'UCL'].includes(value),
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
  assert.equal(selections[0][1].subject.image, ''); assert.equal(selections[0][1].subject.teamLogo, '');
  assert.equal(render().find(node => node.type === 'details').props.open, false, 'Selection closes the picker so bet fields are easy to reach');
  tree.find(node => node.type === 'select' && node.props.value === 'player').props.onChange({ target: { value: 'team' } });
  tree = render(); tree.find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === 'Use ').props.onClick();
  assert.equal(selections[1][1].type, 'team'); assert.equal(selections[1][1].subject.image, '');
  tree.find(node => node.type === 'select' && node.props.value === 'NFL').props.onChange({ target: { value: 'NHL' } });
  tree.find(node => node.type === 'details').props.onToggle({ currentTarget: { open: true } });
  render(); await flush(); tree = render();
  tree.find(node => node.type === 'select' && node.props.value === '').props.onChange({ target: { value: '1' } });
  tree.find(node => node.type === 'select' && node.props.value === 'team').props.onChange({ target: { value: 'player' } });
  render(); await flush(); tree = render();
  tree.find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === 'Test Player').props.onClick();
  assert.equal(selections[2][0], 'NHL'); assert.equal(selections[2][1].type, 'player');
  tree = render();
  tree.find(node => node.type === 'select' && node.props.value === 'NHL').props.onChange({ target: { value: 'UCL' } });
  tree.find(node => node.type === 'details').props.onToggle({ currentTarget: { open: true } });
  render(); await flush(); tree = render();
  assert.equal(tree.find(node => node.type === 'select' && node.props.value === 'team').props.disabled, true);
  const playerCalls = calls.filter(row => row[0] === 'players').length;
  tree.find(node => node.type === 'select' && node.props.value === '').props.onChange({ target: { value: '1' } });
  render(); await flush(); tree = render();
  assert.equal(calls.filter(row => row[0] === 'players').length, playerCalls, 'UCL never requests a player roster');
  tree.find(node => node.type === 'button' && Array.isArray(node.props.children) && node.props.children[0] === 'Use ').props.onClick();
  assert.equal(selections[3][0], 'UCL'); assert.equal(selections[3][1].type, 'team');
  tree = render();
  failed = true; tree.find(node => node.type === 'select' && node.props.value === 'UCL').props.onChange({ target: { value: 'NBA' } });
  tree.find(node => node.type === 'details').props.onToggle({ currentTarget: { open: true } });
  render(); await flush(); tree = render();
  assert.ok(tree.some(node => node.props?.role === 'alert'));
  assert.ok(tree.some(node => node.type === 'button' && node.props.children === 'Retry name search'));
});
