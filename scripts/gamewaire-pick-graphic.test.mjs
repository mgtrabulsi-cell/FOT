import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { pickBlurb, probabilityGrade } from '../supabase/functions/_shared/gamewaire.ts';
import { bestBetLabels } from '../src/services/gamewaireOrder.ts';
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
