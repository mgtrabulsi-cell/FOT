import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { pickBlurb, probabilityGrade } from '../supabase/functions/_shared/gamewaire.ts';
import { bestBetLabels, instagramBestBets } from '../src/services/gamewaireOrder.ts';
import * as presentation from '../src/services/gamewairePresentation.ts';

function fixture({ noFonts = false, noContext = false, noBlob = false } = {}) {
  const source = readFileSync(new URL('../src/services/gamewairePickGraphic.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const canvases = [];
  const context = vm.createContext({ exports: {}, Intl, Date, File, Blob, setTimeout, clearTimeout,
    document: {
      fonts: { load: async () => noFonts ? [] : [{}], check: () => !noFonts },
      createElement() {
        const canvas = { width: 0, height: 0, texts: [], boxes: [], toBlob: (callback) => callback(noBlob ? null : new Blob(['png'], { type: 'image/png' })) };
        const ctx = new Proxy({ font: '', measureText(text) { return { width: text.length * Number(/(\d+)px/.exec(this.font)?.[1] ?? 26) * .5 }; },
          fillText: (text, x, y) => canvas.texts.push({ text, x, y }), roundRect: (...args) => canvas.boxes.push(args),
          createLinearGradient: () => ({ addColorStop() {} }),
        }, { get: (target, key) => key in target ? target[key] : () => {} });
        canvas.getContext = () => noContext ? null : ctx;
        canvases.push(canvas); return canvas;
      },
    },
    require(name) {
      if (name.includes('gamewairePresentation')) return presentation;
      if (name.includes('gamewaireOrder')) return { bestBetLabels };
      return { pickBlurb, probabilityGrade };
    },
  });
  vm.runInContext(code, context);
  return { render: context.exports.renderGamewairePickGraphics, canvases };
}
const picks = Array.from({ length: 5 }, (_, i) => ({ key: String(i), subject: `Player ${i}`, market: 'player_points',
  sport: 'NBA', side: 'Over', line: 20.5, american: -110, book: 'Saved book', start: '2026-10-30T00:00:00Z',
  away: 'Away', home: 'Home', probability: .65, samples: [{ date: '2026-10-28', value: 25, season: 2026 }],
  seasonAverage: 25, isGameLean: false, risks: ['PRIVATE'], stretch: true, ev: .1 }));
test('Five published picks become three PNG attachments with every pick and complete reasoning, without private metrics or labels', async () => {
  const f = fixture(), snapshot = JSON.stringify(picks);
  const files = await f.render(picks);
  assert.equal(files.length, 3);
  assert.ok(files.every((file) => file instanceof File && file.type === 'image/png' && file.size > 0));
  assert.equal(f.canvases.map((canvas) => canvas.boxes.length).join(','), '2,2,1');
  const texts = f.canvases.flatMap((canvas) => canvas.texts.map((row) => row.text));
  const combined = texts.join(' ');
  assert.match(combined, /BEST BET \/ #1 Top Pick/);
  for (const pick of picks) {
    assert.ok(combined.includes(presentation.gamewairePickTitle(pick)));
    assert.ok(combined.includes(pickBlurb(pick)), 'Full reasoning is drawn, never shortened to one sentence');
  }
  assert.doesNotMatch(combined, /Stretch|PRIVATE|ROI|EV|units/);
  assert.match(combined, /Saved analysis/);
  for (const canvas of f.canvases) {
    assert.equal(canvas.width, 1080);
    assert.ok(canvas.texts.every((row) => row.x >= 52 && row.x < 1028 && row.y > 0 && row.y < canvas.height));
    for (const box of canvas.boxes) assert.ok(box[1] + box[3] < canvas.height - 30);
  }
  assert.equal(JSON.stringify(picks), snapshot);
});
test('A Game Lean graphic keeps both reasoning paragraphs and category branding', async () => {
  const f = fixture();
  const lean = { ...picks[0], subject: 'Home', side: 'Home', market: 'spreads', line: 3.5, isGameLean: true };
  await f.render([lean]);
  const text = f.canvases[0].texts.map((row) => row.text).filter(Boolean).join(' ');
  assert.match(text, /BEST BET \/ #1 Game Lean/);
  for (const paragraph of pickBlurb(lean).split('\n\n')) assert.ok(text.includes(paragraph));
  assert.match(text, /We're taking Home \+3.5 to cover/);
});
test('Graphics fail explicitly for empty selections, missing fonts, missing canvas and failed PNG exports', async () => {
  await assert.rejects(fixture().render([]), /one to five/);
  await assert.rejects(fixture({ noFonts: true }).render(picks), /fonts could not load/);
  await assert.rejects(fixture({ noContext: true }).render(picks), /could not create/);
  await assert.rejects(fixture({ noBlob: true }).render(picks), /could not export/);
});
test('Instagram selects three per category, saved order, date and sport, deduplicating shared selections without mislabeling a fourth Top Pick', () => {
  const rows = [...Array.from({ length: 5 }, (_, i) => ({ ...picks[0], key: `top${i}`, isPublishedLean: i === 4 })),
    ...Array.from({ length: 4 }, (_, i) => ({ ...picks[0], key: `lean${i}`, isGameLean: true, isPublishedLean: true })),
    { ...picks[0], key: 'other-sport', sport: 'NFL' }, { ...picks[0], key: 'other-date', start: '2026-10-28T00:00:00Z' }];
  const order = [{ game_date: '2026-10-29', pick_keys: ['top1', 'top0', 'top2', 'top3', 'top4', 'lean2', 'lean0', 'lean1', 'lean3'], revision: 1 }];
  const chosen = instagramBestBets(rows, order, 'NBA', '2026-10-29');
  assert.deepEqual(chosen.map((row) => row.key), ['top1', 'top0', 'top2', 'top4', 'lean2', 'lean0']);
  assert.deepEqual(chosen.map((row) => row.instagramTopRank), [1, 2, 3, null, null, null]);
  assert.deepEqual(chosen.map((row) => row.instagramLeanRank), [null, null, null, 1, 2, 3]);
  const shared = instagramBestBets(rows.map((row) => ({ ...row, isPublishedLean: row.key === 'top1' || row.isPublishedLean })), order, 'NBA', '2026-10-29');
  assert.equal(shared.filter((row) => row.key === 'top1').length, 1);
  assert.equal(shared[0].instagramTopRank, 1); assert.equal(shared[0].instagramLeanRank, 1);
  assert.equal(instagramBestBets(rows, [], 'NFL', '2026-10-28').length, 0);
});
test('Instagram exports six dated sport-specific 4:5 slides with full reasoning, and continues long write-ups without clipping', async () => {
  const f = fixture();
  const six = [...picks, { ...picks[0], key: 'six', isGameLean: true, isPublishedLean: true, subject: 'Home', side: 'Home', market: 'spreads', line: 3.5,
    matchupForm: [{ team: 'Home', season: 2026, record: { wins: 3, losses: 3, ties: 0 },
      recent: [{ date: '2026-10-25', value: -20, opponent: 'A very long verified opponent team name '.repeat(20), pointsFor: 10, pointsAgainst: 30 }] }],
  }];
  const files = await f.render(six, { sport: 'NBA', date: '2026-10-29' });
  assert.ok(files.length > 6, 'Long reasoning continues on another slide');
  assert.ok(files.length <= 20);
  assert.ok(files.every((file, i) => file.name === `GamewAIre-Best-Bets-NBA-2026-10-29-${String(i + 1).padStart(2, '0')}.png`));
  assert.ok(f.canvases.every((canvas) => canvas.width === 1080 && canvas.height === 1350));
  const text = f.canvases.flatMap((canvas) => canvas.texts.map((row) => row.text)).join(' ');
  assert.match(text, /'s BEST BETS/); assert.match(text, /NBA \/ 10\/29 \/ 2026/);
  assert.match(text, /CONTINUED/);
  const reasoning = f.canvases.flatMap((canvas) => canvas.texts.filter((row) => row.x === 106).map((row) => row.text)).filter(Boolean).join(' ');
  for (const pick of six) for (const paragraph of pickBlurb(pick).split('\n\n'))
    assert.ok(reasoning.includes(paragraph), 'Every reasoning paragraph is retained across the slides');
  for (const canvas of f.canvases) {
    assert.ok(canvas.texts.every((row) => row.y > 0 && row.y < 1350));
    assert.ok(canvas.boxes.every((box) => box[1] + box[3] <= 1270));
  }
  await assert.rejects(f.render(six, { sport: 'NFL', date: '2026-10-29' }), /one sport/);
});
