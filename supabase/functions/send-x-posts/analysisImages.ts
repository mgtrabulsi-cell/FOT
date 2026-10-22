import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';
import { parse } from 'npm:opentype.js@1.3.4';
import type { XPostSource } from '../_shared/xPosting.ts';

type Font = { charToGlyphIndex(character: string): number; getAdvanceWidth(text: string, size: number): number };
type Assets = { buffers: Uint8Array[]; fonts: Font[] };
let assets: Promise<Assets> | undefined;
function loadAssets(): Promise<Assets> {
  return assets ??= (async () => {
    const [wasm, normal, emoji] = await Promise.all(['resvg.wasm', 'NotoSans-Regular.ttf', 'NotoEmoji.ttf']
      .map(async name => {
        const file = await Deno.readFile(new URL(`./assets/${name}.gz`, import.meta.url));
        const stream = new Blob([file]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }));
    await initWasm(wasm);
    return { buffers: [normal, emoji], fonts: [parse(normal.buffer), parse(emoji.buffer)] };
  })();
}
const xml = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);

function fontFor(character: string, fonts: Font[]): number {
  if (character === '\u200d' || /[\ufe0e\ufe0f]/u.test(character)) return 1;
  const index = fonts.findIndex(font => font.charToGlyphIndex(character) !== 0);
  if (index < 0) throw new Error(`Analysis image cannot render character U+${character.codePointAt(0)!.toString(16).toUpperCase()}. Edit this character or post manually.`);
  return index;
}
function width(text: string, size: number, fonts: Font[]): number {
  return [...text].reduce((sum, character) => sum + fonts[fontFor(character, fonts)].getAdvanceWidth(character, size), 0);
}
export function wrapAnalysis(text: string, size: number, maxWidth: number, fonts: Font[], maxLines = Infinity): string[] {
  const lines: string[] = [];
  const push = (line: string) => {
    lines.push(line);
    if (lines.length > maxLines) throw new Error('Full analysis exceeds X’s four-image limit. Shorten the analysis or post manually; no tweet was sent.');
  };
  const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/u).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (width(candidate, size, fonts) <= maxWidth) { line = candidate; continue; }
      if (line) { push(line); line = ''; }
      if (width(word, size, fonts) <= maxWidth) { line = word; continue; }
      for (const { segment } of graphemes.segment(word)) {
        if (width(segment, size, fonts) > maxWidth) throw new Error('Analysis contains a character wider than the image.');
        if (width(line + segment, size, fonts) > maxWidth) { push(line); line = ''; }
        line += segment;
      }
    }
    push(line);
  }
  return lines;
}
function svgText(text: string, y: number, size: number, fonts: Font[], color: string): string {
  let runs = '';
  let current = '';
  let index = 0;
  for (const character of text) {
    const next = fontFor(character, fonts);
    if (next !== index && current) { runs += `<tspan font-family="${index ? 'Noto Emoji' : 'Noto Sans'}">${xml(current)}</tspan>`; current = ''; }
    index = next;
    current += character;
  }
  if (current) runs += `<tspan font-family="${index ? 'Noto Emoji' : 'Noto Sans'}">${xml(current)}</tspan>`;
  return `<text x="64" y="${y}" font-size="${size}" fill="${color}" xml:space="preserve">${runs}</text>`;
}
export async function analysisImages(source: XPostSource): Promise<Array<{ png: Uint8Array; alt: string }>> {
  if (!source.analysis.trim()) throw new Error('Cannot attach an empty analysis image.');
  const { buffers, fonts } = await loadAssets();
  const heading = wrapAnalysis(source.title, 42, 1072, fonts);
  if (heading.length > 3) throw new Error('Headline is too long for a readable analysis image.');
  const start = 180 + heading.length * 56;
  const perPage = Math.floor((1390 - start) / 44);
  const lines = wrapAnalysis(source.analysis, 30, 1072, fonts, perPage * 4);
  const count = Math.ceil(lines.length / perPage);
  if (count > 4) throw new Error('Full analysis exceeds X’s four-image limit. Shorten the analysis or post manually; no tweet was sent.');
  const images = [];
  for (let page = 0; page < count; page++) {
    const pageLines = lines.slice(page * perPage, (page + 1) * perPage);
    const height = Math.max(680, start + (pageLines.length - 1) * 44 + 150);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}">
      <rect width="1200" height="${height}" fill="#101b2b"/><rect x="0" width="8" height="${height}" fill="#f43f54"/>
      <text x="64" y="78" font-family="Noto Sans" font-size="35" fill="#f1f5f9">GAME<tspan fill="#f43f54">WIRE</tspan></text>
      <text x="1136" y="76" text-anchor="end" font-family="Noto Sans" font-size="20" fill="#a7b7cd">ANALYSIS · ${page + 1}/${count}</text>
      <path d="M64 110H1136" stroke="#314159"/>
      ${heading.map((line, index) => svgText(line, 177 + index * 56, 42, fonts, '#f1f5f9')).join('')}
      ${pageLines.map((line, index) => svgText(line, start + index * 44, 30, fonts, '#d7e2ef')).join('')}
      <path d="M64 ${height - 80}H1136" stroke="#314159"/>
      <text x="64" y="${height - 38}" font-family="Noto Sans" font-size="22" fill="#a7b7cd">gamewire.us · Admin analysis / Opinion</text></svg>`;
    const renderer = new Resvg(svg, { font: { fontBuffers: buffers, defaultFontFamily: 'Noto Sans' } });
    try {
      const rendered = renderer.render();
      try {
        const png = rendered.asPng().slice();
        if (png.length > 5_000_000) throw new Error('Analysis PNG exceeds X’s image upload size limit.');
        const description = `${source.title} — analysis ${page + 1}/${count}\n${pageLines.join('\n')}`;
        const alt = [...description].length <= 1000 ? description : `${[...description].slice(0, 940).join('')}… Full text is in the linked GameWire post.`;
        images.push({ png, alt });
      } finally { rendered.free(); }
    } finally { renderer.free(); }
  }
  return images;
}
