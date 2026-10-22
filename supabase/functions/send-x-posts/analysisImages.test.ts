import { analysisImages, wrapAnalysis } from './analysisImages.ts';
import type { XPostSource } from '../_shared/xPosting.ts';

function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}
const source: XPostSource = { title: 'NBA Opening Night', subject: 'SGA', analysis: 'Full analysis with <markup> & special characters.\n\nSecond paragraph.', gameId: 'NBA:123', picks: [] };
const mono = { charToGlyphIndex: () => 1, getAdvanceWidth: (text: string, size: number) => [...text].length * size };

Deno.test('Wrapping preserves all text, paragraph boundaries and long unbroken words within measured width', () => {
  for (const text of ['A short paragraph.\n\nSecond paragraph.', 'Longword'.repeat(40), 'NBA 🏀 and café']) {
    const lines = wrapAnalysis(text, 1, 20, [mono]);
    assert(lines.every(line => [...line].length <= 20), 'Every line fits');
    assert(lines.join('').replace(/\s/g, '') === text.replace(/\s/g, ''), 'Every non-whitespace character preserved');
  }
});

Deno.test('Analysis PNG pages are real bounded PNGs, support emoji, and never cut off overflowing analysis', async () => {
  const start = performance.now();
  const one = await analysisImages({ ...source, analysis: `${source.analysis}\nSports 🏀 🏈 ⚽ 🏒 ✅ ❌` });
  assert(one.length === 1 && one[0].png.length > 1000, 'Short analysis makes one real PNG');
  assert([...one[0].png.slice(0, 8)].join(',') === '137,80,78,71,13,10,26,10', 'PNG signature');
  const dimensions = new DataView(one[0].png.buffer, one[0].png.byteOffset);
  assert(dimensions.getUint32(16) === 1200 && dimensions.getUint32(20) >= 680 && dimensions.getUint32(20) <= 1500, 'Required readable dimensions without excessive blank space');
  assert(one[0].alt.includes('<markup> & special characters.'), 'Image text escaped for SVG, not lost');
  const four = await analysisImages({ ...source, analysis: Array.from({ length: 90 }, (_, i) => `Analysis line ${i + 1}`).join('\n') });
  assert(four.length === 4, 'Full analysis splits into exactly four pages');
  assert(four.map(image => image.alt).join('\n').includes('Analysis line 90'), 'Last line included on last page');
  for (const analysis of ['', Array.from({ length: 130 }, () => 'Too many lines').join('\n'), 'Unsupported \u{10FFFF}']) {
    let failed = false;
    try { await analysisImages({ ...source, analysis }); } catch { failed = true; }
    assert(failed, 'Empty, overflow or unsupported glyph rejected explicitly');
  }
  console.log(`PNG rendering validation took ${Math.round(performance.now() - start)} ms including cold initialization and five rendered pages.`);
});

Deno.test('Analysis branding bundles the actual site logo and Oswald wordmark at high resolution', async () => {
  const brand = await Deno.readFile(new URL('./assets/gamewire-site-brand.png', import.meta.url));
  assert([...brand.slice(0, 8)].join(',') === '137,80,78,71,13,10,26,10', 'Site brand is a real PNG');
  const dimensions = new DataView(brand.buffer, brand.byteOffset);
  assert(dimensions.getUint32(16) === 640 && dimensions.getUint32(20) === 196, 'Brand exported at 4x actual desktop lockup dimensions (160×49 CSS pixels)');
  const renderer = await Deno.readTextFile(new URL('./analysisImages.ts', import.meta.url));
  assert(renderer.includes('href="${brandUri}"') && renderer.includes('<image x="64" y="0"') && renderer.includes('height="104"'), 'Canonical branding placed at upper left with original-sized wordmark');
  assert(!renderer.includes('>GAME<tspan'), 'Approximate text wordmark removed');
});
