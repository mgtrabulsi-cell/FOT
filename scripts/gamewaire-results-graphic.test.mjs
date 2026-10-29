import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { performance } from '../supabase/functions/_shared/gamewaire.ts';

function fixture({ noContext = false, noBlob = false, noFonts = false, noLogo = false } = {}) {
  const source = readFileSync(new URL('../src/services/gamewaireResultsGraphic.ts', import.meta.url), 'utf8').replace('import.meta.env.BASE_URL', "'/app/'");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const texts = [], fontLoads = [], boxes = [], images = [];
  const ctx = new Proxy({ measureText: (text) => ({ width: text.length * 13 }), fillText: (text, x, y) => texts.push({ text, x, y, color: ctx.fillStyle, font: ctx.font }),
    roundRect: (...args) => boxes.push(args),
    drawImage: (...args) => images.push(args),
    createLinearGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { width: 0, height: 0, getContext: () => noContext ? null : ctx,
    toBlob: (callback) => callback(noBlob ? null : new Blob(['png'], { type: 'image/png' })) };
  class Image {
    naturalWidth = 1536; naturalHeight = 1024;
    set src(value) { this.url = value; queueMicrotask(() => noLogo ? this.onerror?.() : this.onload?.()); }
  }
  const context = vm.createContext({ exports: {}, Intl, Date, Blob, Map, Image, setTimeout, clearTimeout,
    document: { createElement: () => canvas, fonts: { load: async (font) => { fontLoads.push(font); return noFonts ? [] : [{}]; }, check: () => !noFonts } },
    require: () => ({ performance }) });
  vm.runInContext(code, context);
  return { ...context.exports, texts, canvas, fontLoads, boxes, images };
}
const pick = (id, result, patch = {}) => ({ id, result, sport: 'NBA', event_start: `2026-10-${String(20 + id).padStart(2, '0')}T23:00:00Z`,
  is_top_pick: true, is_game_lean: false, probability: 0.6, push_probability: 0, american: -110, withdrawn: false,
  subject: `Player ${id}`, market: 'player_points', side: 'Over', line: 20.5, ...patch });
const rows = [
  pick(1, 'win', { is_game_lean: true }), pick(2, 'loss'), pick(3, 'pending'),
  pick(4, 'push', { is_top_pick: false, is_game_lean: true }), pick(5, 'void', { is_top_pick: false, is_game_lean: true }),
  pick(6, 'win', { is_game_lean: true, withdrawn: true }),
];
test('Results graphic has exactly three record-only sections without double-counting shared picks', () => {
  const { resultsGraphicSections } = fixture();
  const sections = resultsGraphicSections([...rows, rows[0], pick(7, 'win', { is_top_pick: false })]);
  assert.equal(sections.length, 3);
  assert.deepEqual(Array.from(sections, (s) => s.title), ['TOP PICKS', 'GAME LEANS', 'ALL PICKS']);
  const [top, leans, all] = sections;
  assert.equal(leans.wins, 2); assert.equal(leans.losses, 0); assert.equal(leans.hitRate, 1);
  assert.equal(top.wins, 2); assert.equal(top.losses, 1); assert.equal(top.hitRate, 2 / 3);
  assert.equal(all.wins, 2); assert.equal(all.losses, 1); assert.equal(all.hitRate, 2 / 3);
  assert.equal(all.pending, 1); assert.equal(all.pushes, 1); assert.equal(all.voids, 1);
  assert.ok(sections.every((section) => !('recent' in section)));
  const reset = resultsGraphicSections(rows.map((p) => p.id === 6 ? { ...p, result: 'pending' } : p))[2];
  assert.equal(reset.hitRate, 0.5); assert.equal(reset.pending, 2);
});
test('Renderer exports an Instagram 4:5 portrait PNG with record cards and no picks or private financial/Stretch data', async () => {
  const r = fixture();
  const blob = await r.renderResultsGraphic(rows, new Date('2026-10-29T13:00:00Z'));
  assert.equal(blob.type, 'image/png');
  assert.equal(r.canvas.width, 1080); assert.equal(r.canvas.height, 1350);
  const text = r.texts.map((row) => row.text).join('\n');
  for (const expected of ['GAME LEANS', 'TOP PICKS', 'ALL PICKS', '66.7%', '100.0%', 'Win rate', 'Record', ' W · ', ' L']) assert.ok(text.includes(expected), expected);
  assert.ok(!r.texts.some((row) => row.text === 'Pending'), 'No pending box is drawn');
  assert.doesNotMatch(text, /ROI|profit|units|Stretch|settlement_note|closing|Player \d|recent|Withdrawn/i);
  assert.ok(r.texts.every((row) => row.y > 0 && row.y < 1350 && row.x >= 60 && row.x < 1020));
  assert.ok(r.texts.filter((row) => /^(66.7|100.0)%$/.test(row.text)).every((row) => row.color === '#86d9ad'));
  assert.ok(r.fontLoads.includes('700 48px Oswald'));
  assert.ok(r.fontLoads.includes('400 22px "DM Sans"'));
  assert.ok(r.texts.filter((row) => /^(66.7|100.0)%$/.test(row.text)).every((row) => row.font === '700 48px Oswald'));
  assert.ok(r.texts.filter((row) => row.text === 'Record').every((row) => row.font === '400 22px "DM Sans"'));
  assert.equal(r.boxes.length, 6);
  assert.ok(r.boxes.every((box) => box[2] === (960 - 16) / 2 && box[3] === 162 && box[4] === 12));
  assert.equal(r.images.length, 1);
  const [logo, x, y, width, height] = r.images[0];
  assert.equal(logo.url, '/app/gamewire-mark-transparent.png');
  const asset = readFileSync(new URL('../public/gamewire-mark-transparent.png', import.meta.url));
  assert.equal(asset.readUInt32BE(16), 1536);
  assert.equal(asset.readUInt32BE(20), 1024);
  assert.equal(asset[25], 6, 'Logo is an RGBA PNG with transparency, not an opaque rectangular background');
  assert.equal(width / height, 1.5, 'Logo retains its original aspect ratio');
  assert.ok(x >= 680 && x + width <= 1020 && y + height < 310, 'Logo stays inside header without overlapping cards');
});
test('Empty and pending-only sections do not invent a hit rate, and rendering failures are explicit', async () => {
  const r = fixture();
  await r.renderResultsGraphic([]);
  assert.equal(r.texts.filter((row) => row.text === 'Unavailable').length, 3);
  assert.equal(r.resultsGraphicSections([pick(1, 'pending')])[2].hitRate, null);
  await assert.rejects(fixture({ noContext: true }).renderResultsGraphic(rows), /could not create/);
  await assert.rejects(fixture({ noBlob: true }).renderResultsGraphic(rows), /could not export/);
  await assert.rejects(fixture({ noFonts: true }).renderResultsGraphic(rows), /fonts could not load/);
  await assert.rejects(fixture({ noLogo: true }).renderResultsGraphic(rows), /logo could not load/);
});
test('Only hit rates strictly above 50 percent are green; exactly 50, below and unavailable stay neutral', async () => {
  for (const [results, expected] of [[['win', 'loss'], '50.0%'], [['win', 'loss', 'loss'], '33.3%'], [['pending'], 'Unavailable']]) {
    const r = fixture();
    await r.renderResultsGraphic(results.map((result, index) => pick(index + 1, result)));
    const rates = r.texts.filter((row) => row.text === expected);
    assert.ok(rates.length >= 2);
    assert.ok(rates.every((row) => row.color === '#e5eaf3'));
  }
});
