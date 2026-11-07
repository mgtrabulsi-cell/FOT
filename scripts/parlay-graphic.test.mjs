import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { newManualParlayLeg, newParlayGraphic, readParlayGraphic, parlayGraphicError, parlayLegLabel, parlayPickText, withParlayPick, parlayMarkets } from '../src/services/parlayGraphic.ts';
import { angleWriteFields, readAngles } from '../src/services/theAngle.ts';
import { graphicImage } from '../supabase/functions/parlay-roster/graphicImage.ts';

const subject = { id: '1', name: 'Test Player', image: '', teamId: '2', teamName: 'Test Team', teamLogo: '', color: '167bcb' };
const leg = (patch = {}) => ({ id: crypto.randomUUID(), sport: 'NBA', type: 'player', subject, market: 'Points', side: 'At least', line: '20', ...patch });
const graphic = () => ({ ...newParlayGraphic(), legs: [leg(), leg({ sport: 'NFL', subject: { ...subject, id: '3', name: 'NFL Player' }, market: 'Receiving yards', line: '60' })] });
test('Parlays allow mixed leagues, games, players, moneylines, spreads and custom combinations without invented odds', () => {
  const g = graphic();
  g.legs.push(leg({ type: 'moneyline', line: '', market: '', subject: { ...subject, id: '5', name: 'Home Team' } }));
  g.legs.push(leg({ type: 'spread', line: '-4.5', market: '', subject: { ...subject, id: '6', name: 'Away Team' } }));
  g.legs.push(leg({ market: 'Points + rebounds + assists', side: 'Over', line: '30.5' }));
  assert.equal(parlayGraphicError(g), '');
  assert.equal(parlayLegLabel(g.legs[0]), '20+ Points');
  assert.equal(parlayLegLabel(g.legs[2]), 'Moneyline');
  assert.equal(parlayLegLabel(g.legs[3]), 'Spread -4.5');
  g.legs[3].line = '+4.5';
  assert.equal(parlayLegLabel(g.legs[3]), 'Spread +4.5');
  assert.ok(parlayMarkets.NFL.includes('Anytime touchdown'));
  assert.ok(parlayMarkets.NBA.includes('Points + rebounds + assists'));
  assert.doesNotMatch(parlayPickText(g), /\(\+/);
  g.odds = '+1360';
  assert.match(parlayPickText(g), /PARLAY \(\+1360\)/);
});
test('Validation requires 2–8 complete legs, sensible manual odds, no duplicate legs and a complete <=500-character tracked pick', () => {
  const g = graphic();
  assert.match(parlayGraphicError(newParlayGraphic()), /at least two/);
  for (const odds of ['foo', '+90', '0', '1.5', 'Infinity']) assert.match(parlayGraphicError({ ...g, odds }), /American sportsbook odds/);
  for (const odds of ['', '+100', '-110', '+1360']) assert.equal(parlayGraphicError({ ...g, odds }), '');
  assert.match(parlayGraphicError({ ...g, legs: [g.legs[0], { ...g.legs[0], id: crypto.randomUUID() }] }), /duplicates/);
  assert.match(parlayGraphicError({ ...g, legs: [leg({ line: 'NaN' }), g.legs[1]] }), /valid stat line/);
  assert.match(parlayGraphicError({ ...g, legs: [leg({ line: '-2' }), g.legs[1]] }), /valid stat line/);
  assert.equal(parlayGraphicError({ ...g, legs: [leg({ market: 'Anytime touchdown', line: '' }), g.legs[1]] }), '');
  assert.throws(() => readParlayGraphic({ ...g, legs: Array.from({ length: 9 }, () => leg()) }), /invalid/);
  assert.throws(() => readParlayGraphic({ ...g, legs: [leg({ subject: { ...subject, image: 'javascript:alert(1)' } })] }), /invalid/);
  assert.match(parlayGraphicError({ ...g, legs: Array.from({ length: 8 }, (_, i) => leg({ subject: { ...subject, id: String(i), name: 'N'.repeat(80) } })) }), /500 characters/);
});
test('Saving creates exactly one parlay, retains other picks, preserves unchanged results, and resets changed selections', () => {
  const g = graphic(), straight = { id: crypto.randomUUID(), text: 'Separate pick', result: 'hit', category: 'straight' };
  const picks = withParlayPick([straight], g);
  assert.equal(picks.length, 2);
  assert.equal(picks[1].category, 'parlay');
  assert.equal(picks[1].result, 'pending');
  const settled = [{ ...picks[1], result: 'hit' }, straight];
  assert.equal(withParlayPick(settled, g).at(-1).result, 'hit');
  assert.equal(withParlayPick(settled, { ...g, odds: '+400' }).at(-1).result, 'pending');
  assert.equal(withParlayPick(picks, g).length, 2);
});
test('Manual legs support any sport, free-text selections, draft restoration and duplicate validation', () => {
  const manual = newManualParlayLeg();
  assert.deepEqual(readParlayGraphic({ ...newParlayGraphic(), legs: [manual] }).legs[0], manual);
  const g = graphic();
  for (const [sport, name, market] of [
    ['NHL', 'Oilers', 'Moneyline'], ['Soccer', 'Arsenal', 'Over 1.5 goals'],
    ['UFC', 'Test Fighter', 'Win by KO'], ['College Football', 'Ohio State', 'Spread -6.5'],
    ['Tennis', 'Test Player', 'Win first set'],
  ]) {
    g.legs.push({ ...newManualParlayLeg(), sport, subject: { ...manual.subject, name }, market });
  }
  assert.equal(parlayGraphicError(g), '');
  assert.deepEqual(readParlayGraphic(JSON.parse(JSON.stringify(g))), g);
  assert.equal(parlayLegLabel(g.legs[4]), 'Win by KO');
  assert.match(parlayPickText(g), /Ohio State Spread -6.5/);
  assert.equal(withParlayPick([], g).length, 1);
  const custom = g.legs[2];
  assert.match(parlayGraphicError({ ...g, legs: [...g.legs, { ...custom, id: crypto.randomUUID(), subject: { ...custom.subject, id: crypto.randomUUID(), name: ' OILERS ' } }] }), /duplicates/);
  assert.match(parlayGraphicError({ ...g, legs: [g.legs[0], { ...custom, sport: ' ' }] }), /sport or league/);
  assert.match(parlayGraphicError({ ...g, legs: [g.legs[0], { ...custom, market: '' }] }), /selection for manual leg/);
  assert.throws(() => readParlayGraphic({ ...g, legs: [{ ...custom, sport: 'x'.repeat(33) }] }), /invalid/);
  assert.throws(() => readParlayGraphic({ ...g, legs: [{ ...custom, type: 'player' }] }), /invalid/);
});
test('Manual selections render with sport labels and exact selection text', async () => {
  const r = renderer(), manual = newManualParlayLeg();
  const g = { ...newParlayGraphic(), legs: [
    { ...manual, sport: 'College Football', subject: { ...manual.subject, name: 'Ohio State', teamName: 'vs Michigan' }, market: 'Spread -6.5' },
    { ...newManualParlayLeg(), sport: 'UFC', subject: { ...manual.subject, name: 'Test Fighter' }, market: 'Win by submission' },
  ] };
  await r.render(g);
  for (const text of ['COLLEGE', 'FOOTBALL', 'UFC', 'Ohio State', 'Spread -6.5', 'Win by submission']) assert.ok(r.texts.includes(text), text);
});
test('Angle serialization retains the editable template and generated attachment pointer', () => {
  const g = { ...graphic(), image_path: 'author/parlay.png' };
  const manual = newManualParlayLeg();
  g.legs.push({ ...manual, sport: 'Soccer', subject: { ...manual.subject, name: 'Arsenal' }, market: 'Moneyline' });
  const story = { id: crypto.randomUUID(), season: 2026, week: 7, revision: 1, game_id: 'COMBO:0', matchup: 'NBA + NFL',
    kind: 'team', subject: '', category: 'Other', title: 'Parlay', narrative: 'My analysis', evidence: '', counterpoint: '', pick: '',
    source_url: '', source_label: '', reviewed: true, status: 'draft', picks: withParlayPick([], g), parlay_graphic: g, image_paths: [g.image_path] };
  assert.deepEqual(readAngles([story])[0].parlay_graphic, g);
  assert.deepEqual(angleWriteFields(story, 'published').parlay_graphic, g);
  assert.throws(() => readAngles([{ ...story, parlay_graphic: { ...g, version: 9 } }]), /invalid/);
});
function renderer() {
  const source = readFileSync(new URL('../src/services/parlayGraphicImage.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const texts = [], typography = [];
  const ctx = new Proxy({ measureText: (text) => ({ width: text.length * (Number(/([\d.]+)px/.exec(ctx.font)?.[1]) || 24) * .5 }), fillText: (text) => {
    texts.push(text); typography.push({ text, font: ctx.font, ink: ctx.fillStyle });
  },
    createLinearGradient: () => ({ stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (callback) => callback(new Blob(['png'], { type: 'image/png' })) };
  let style;
  const context = vm.createContext({ exports: {}, Blob, Map, Promise, setTimeout, clearTimeout,
    document: { createElement: () => canvas, fonts: { load: async () => [{}], check: () => true } }, Image: class { naturalWidth = 1024; naturalHeight = 1536; set src(value) { if (value) this.onload(); } },
    require: name => name.endsWith('/betGraphicStyle') ? style : ({ parlayGraphicError, parlayLegLabel, loadGamewireGraphicAssets: async () => ({ naturalWidth: 1536, naturalHeight: 1024 }) }) });
  const styleSource = readFileSync(new URL('../src/services/betGraphicStyle.ts', import.meta.url), 'utf8').replaceAll('import.meta.env.BASE_URL', JSON.stringify('/'));
  vm.runInContext(ts.transpileModule(styleSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  style = context.exports;
  vm.runInContext(code, context);
  return { render: context.exports.renderParlayGraphic, crop: context.exports.parlayPortraitCrop, canvas, texts, typography };
}
test('Parlay matches Best Bet with lighter slanted text and bright metallic white, preserving the red WIRE brand', async () => {
  const r = renderer();
  await r.render({ ...graphic(), images: false });
  assert.ok(r.typography.length > 10);
  for (const row of r.typography) {
    const heading = ['GAME', 'WIRE', 'PARLAY'].includes(row.text);
    assert.match(row.font, heading ? /^italic 700 .*"DM Sans"/ : /^italic 600 .*"DM Sans"/, row.text);
    const colors = row.ink.stops.map(([, color]) => color);
    assert.ok(colors.includes(row.text === 'WIRE' ? '#9e0c18' : '#ffffff'), row.text);
    if (row.text !== 'WIRE') assert.ok(colors.includes('#c5d0df'), row.text);
  }
});
test('Portrait framing trims transparent padding and fills the circle with a square head-and-shoulders crop', () => {
  const { crop } = renderer();
  for (const [width, height, bounds] of [[350, 254, [70, 30, 280, 250]], [600, 436, [100, 60, 500, 430]]]) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const [left, top, right, bottom] = bounds;
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) pixels[(y * width + x) * 4 + 3] = 255;
    pixels[3] = 10;
    const result = crop(pixels, width, height);
    assert.equal(result.y, top, 'Hairline stays at the top rather than being center-cropped away');
    assert.equal(result.x + result.size / 2, (left + right + 1) / 2);
    assert.ok(result.size < Math.min(right - left + 1, bottom - top + 1), 'Portrait zooms inside the visible image, not its transparent canvas');
    assert.ok(result.x >= left && result.x + result.size <= right + 1);
    assert.ok(result.y + result.size <= bottom + 1);
  }
  assert.throws(() => crop(new Uint8ClampedArray(16), 2, 2), /portrait is empty/);
});
test('Name-only renderer works offline, expands for eight legs and prints every leg without fabricating odds', async () => {
  for (const count of [2, 3, 8]) {
    const r = renderer(), g = { ...graphic(), images: false };
    g.legs = Array.from({ length: count }, (_, i) => leg({ subject: { ...subject, id: String(i), name: `Player ${i}` } }));
    await r.render(g);
    assert.equal(r.canvas.width, 1080);
    assert.equal(r.canvas.height, 440 + count * 150);
    for (let i = 0; i < count; i++) assert.ok(r.texts.includes(`Player ${i}`));
    assert.ok(r.texts.includes('20+ Points'));
    assert.ok(!r.texts.some((t) => /^\+\d+$/.test(t)));
  }
});
function endpoint() {
  const source = readFileSync(new URL('../supabase/functions/parlay-roster/index.ts', import.meta.url), 'utf8').replace(/if \(import\.meta\.main\)[\s\S]*$/, '');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ exports: {}, Response, URL, AbortSignal, console, require: () => ({ graphicImage }) });
  vm.runInContext(code, context);
  return context.exports.handleParlayRoster;
}
test('Roster endpoint supports NBA/NFL/NHL, including six-digit NHL IDs, rejects unsafe paths and surfaces upstream errors', async () => {
  const handle = endpoint(), urls = [];
  const fetcher = async (url) => { urls.push(url); return Response.json({ athletes: [{ items: [{ id: '1', displayName: 'Player', position: { abbreviation: 'WR' }, headshot: { href: 'https://example.test/player.png' } }] }] }); };
  for (const sport of ['NBA', 'NFL', 'NHL', 'CFB']) {
    const result = await handle(new Request(`https://test/?sport=${sport}&team=${sport === 'NHL' ? '129764' : '2'}&season=2026`), fetcher);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).players[0].name, 'Player');
  }
  assert.ok(urls[0].includes('basketball/nba'));
  assert.ok(urls[1].includes('football/nfl'));
  assert.ok(urls[2].includes('hockey/nhl/teams/129764/roster'));
  assert.ok(urls[3].includes('football/college-football/teams/2/roster'));
  for (const query of ['sport=OTHER', 'sport=NBA&team=99&season=2026', 'sport=NHL&team=1234567&season=2026', 'sport=NFL&team=../secrets&season=2026', 'sport=NFL&team=1&season=no', 'sport=UCL&team=359&season=2026', 'sport=Soccer&league=../secrets', 'sport=Soccer&team=359&season=2026', 'sport=CFB&team=../secrets&season=2026']) {
    assert.equal((await handle(new Request(`https://test/?${query}`), fetcher)).status, 400);
  }
  assert.equal(urls.length, 4);
  assert.equal((await handle(new Request('https://test/?sport=NBA'), async () => new Response('', { status: 503 }))).status, 502);
});
test('CFB directory does not stop at 100 teams and Soccer routes all six allowlisted leagues', async () => {
  const handle = endpoint();
  for (const [sport, league] of [['CFB', ''], ...['eng.1','esp.1','ita.1','ger.1','fra.1','usa.1'].map(league => ['Soccer', league])]) {
    const response = await handle(new Request(`https://test/?sport=${sport}&league=${league}`), async url => {
      assert.ok(url.endsWith(sport === 'CFB' ? '/football/college-football/teams?limit=1000' : `/soccer/${league}/teams?limit=100`));
      return Response.json({ sports: [{ leagues: [{ season: { year: 2026 }, teams: [{ team: { id: '1', displayName: 'Team', abbreviation: 'ABC', color: '123abc' } }] }] }] });
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).teams[0].name, 'Team');
  }
});
test('Champions League returns its full team directory with soccer crests, not unsupported player rosters', async () => {
  const handle = endpoint();
  const response = await handle(new Request('https://test/?sport=UCL'), async url => {
    assert.ok(url.endsWith('soccer/uefa.champions/teams?limit=100'));
    return Response.json({ sports: [{ leagues: [{ season: { year: 2026 }, teams: Array.from({ length: 36 }, (_, i) =>
      ({ team: { id: String(100 + i), displayName: `Club ${i}`, abbreviation: `C${i}`,
        logos: [{ href: `https://a.espncdn.com/i/teamlogos/soccer/500/${100 + i}.png` }] } })) }] }] });
  });
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.teams.length, 36); assert.equal(data.season, 2026);
  assert.equal(data.teams[35].logo, 'https://a.espncdn.com/i/teamlogos/soccer/500/135.png');
});
