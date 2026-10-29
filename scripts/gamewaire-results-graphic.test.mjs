import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { performance } from '../supabase/functions/_shared/gamewaire.ts';

function fixture({ noContext = false, noBlob = false } = {}) {
  const source = readFileSync(new URL('../src/services/gamewaireResultsGraphic.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const texts = [];
  const ctx = new Proxy({ measureText: (text) => ({ width: text.length * 13 }), fillText: (text, x, y) => texts.push({ text, x, y }),
    createLinearGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { width: 0, height: 0, getContext: () => noContext ? null : ctx,
    toBlob: (callback) => callback(noBlob ? null : new Blob(['png'], { type: 'image/png' })) };
  const context = vm.createContext({ exports: {}, Intl, Date, Blob, Map,
    document: { createElement: () => canvas }, require: () => ({ performance }) });
  vm.runInContext(code, context);
  return { ...context.exports, texts, canvas };
}
const pick = (id, result, patch = {}) => ({ id, result, sport: 'NBA', event_start: `2026-10-${String(20 + id).padStart(2, '0')}T23:00:00Z`,
  is_top_pick: true, is_game_lean: false, probability: 0.6, push_probability: 0, american: -110, withdrawn: false,
  subject: `Player ${id}`, market: 'player_points', side: 'Over', line: 20.5, ...patch });
const rows = [
  pick(1, 'win', { is_game_lean: true }), pick(2, 'loss'), pick(3, 'pending'),
  pick(4, 'push', { is_top_pick: false, is_game_lean: true }), pick(5, 'void', { is_top_pick: false, is_game_lean: true }),
  pick(6, 'win', { is_game_lean: true, withdrawn: true }),
];
test('Results graphic has exactly three sections, accurate all-time records and latest three picks without double-counting shared picks', () => {
  const { resultsGraphicSections } = fixture();
  const sections = resultsGraphicSections([...rows, rows[0], pick(7, 'win', { is_top_pick: false })]);
  assert.equal(sections.length, 3);
  assert.deepEqual(Array.from(sections, (s) => s.title), ['GAME LEANS', 'TOP PICKS', 'ALL PICKS']);
  const [leans, top, all] = sections;
  assert.equal(leans.wins, 2); assert.equal(leans.losses, 0); assert.equal(leans.hitRate, 1);
  assert.equal(top.wins, 2); assert.equal(top.losses, 1); assert.equal(top.hitRate, 2 / 3);
  assert.equal(all.wins, 2); assert.equal(all.losses, 1); assert.equal(all.hitRate, 2 / 3);
  assert.equal(all.pending, 1); assert.equal(all.pushes, 1); assert.equal(all.voids, 1);
  assert.deepEqual(Array.from(all.recent, (p) => p.id), [6, 5, 4]);
  const reset = resultsGraphicSections(rows.map((p) => p.id === 6 ? { ...p, result: 'pending' } : p))[2];
  assert.equal(reset.hitRate, 0.5); assert.equal(reset.pending, 2);
});
test('Renderer exports a fixed portrait PNG with result labels and percentages, without private financial/Stretch data or network requests', async () => {
  const r = fixture();
  const blob = await r.renderResultsGraphic(rows, new Date('2026-10-29T13:00:00Z'));
  assert.equal(blob.type, 'image/png');
  assert.equal(r.canvas.width, 1080); assert.equal(r.canvas.height, 1800);
  const text = r.texts.map((row) => row.text).join('\n');
  for (const expected of ['GAME LEANS', 'TOP PICKS', 'ALL PICKS', '66.7%', '100.0%', 'HIT', 'PENDING', 'PUSH', 'VOID', 'Withdrawn']) assert.ok(text.includes(expected), expected);
  assert.doesNotMatch(text, /ROI|profit|units|Stretch|settlement_note|closing/i);
  assert.ok(r.texts.every((row) => row.y > 0 && row.y < 1800));
});
test('Empty and pending-only sections do not invent a hit rate, and rendering failures are explicit', async () => {
  const r = fixture();
  await r.renderResultsGraphic([]);
  assert.equal(r.texts.filter((row) => row.text === 'N/A').length, 3);
  assert.equal(r.texts.filter((row) => row.text === 'No published results yet.').length, 3);
  assert.equal(r.resultsGraphicSections([pick(1, 'pending')])[2].hitRate, null);
  await assert.rejects(fixture({ noContext: true }).renderResultsGraphic(rows), /could not create/);
  await assert.rejects(fixture({ noBlob: true }).renderResultsGraphic(rows), /could not export/);
});
test('Recent rows include exact spread and moneyline selections with explicit outcomes', async () => {
  const r = fixture();
  await r.renderResultsGraphic([pick(1, 'loss', { market: 'spreads', subject: 'Team A', line: 3.5 }),
    pick(2, 'win', { market: 'h2h', subject: 'Team B' })]);
  const texts = r.texts.map((row) => row.text);
  assert.ok(texts.includes('Team A +3.5')); assert.ok(texts.includes('Team B ML')); assert.ok(texts.includes('MISSED'));
});
