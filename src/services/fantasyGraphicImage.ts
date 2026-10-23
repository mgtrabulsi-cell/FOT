import { fantasyGraphicPublishError, graphicPositionLabels, graphicPositions } from './fantasyGraphics';
import type { FantasyGraphic } from './fantasyGraphics';

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string) {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const request = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => { img.src = ''; reject(new Error('An image timed out. Retry the preview.')); }, 15_000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('A player photo or team logo could not load. Retry the preview or choose another player.')); };
    img.src = url;
  });
  imageCache.set(url, request);
  void request.catch(() => imageCache.delete(url));
  return request;
}
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (ctx.measureText(word).width > width) throw new Error('A word in the reasoning is too long to fit. Shorten it before publishing.');
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; }
      else line = next;
    }
    lines.push(line);
  }
  return lines;
}
export async function renderFantasyGraphic(graphic: FantasyGraphic, complete = false): Promise<Blob> {
  if (complete) {
    const error = fantasyGraphicPublishError(graphic);
    if (error) throw new Error(error);
  }
  const fonts = ['600 70px Oswald', '500 22px Oswald', '400 21px "DM Sans"', '500 13px "DM Mono"'];
  let fontTimeout: ReturnType<typeof setTimeout> | undefined;
  const loadedFonts = await Promise.race([Promise.all(fonts.map((font) => document.fonts.load(font))), new Promise<never>((_, reject) => {
    fontTimeout = setTimeout(() => reject(new Error('GameWire fonts timed out. Reconnect and retry the preview.')), 15_000);
  })]).finally(() => clearTimeout(fontTimeout));
  if (loadedFonts.some((faces) => !faces.length) || fonts.some((font) => !document.fonts.check(font))) {
    throw new Error('GameWire fonts could not load. Reconnect and retry the preview.');
  }
  const mark = await loadImage(`${import.meta.env.BASE_URL}gamewire-mark.png`);
  const images = await Promise.all(graphic.slots.map(async ({ player }) => ({
    photo: player?.headshot ? await loadImage(player.headshot) : null,
    logo: player?.opponentLogo ? await loadImage(player.opponentLogo) : null,
  })));
  const canvas = document.createElement('canvas');
  canvas.width = 2160; canvas.height = 2700;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser does not support graphic rendering.');
  ctx.scale(2, 2);
  const text = (value: string, x: number, y: number, font: string, color = '#e5eaf3', spacing = 0) => {
    ctx.font = font; ctx.fillStyle = color;
    if (!spacing) { ctx.fillText(value, x, y); return; }
    const width = ctx.measureText(value).width + Math.max(0, value.length - 1) * spacing;
    let left = ctx.textAlign === 'right' ? x - width : x;
    const align = ctx.textAlign; ctx.textAlign = 'left';
    for (const character of value) { ctx.fillText(character, left, y); left += ctx.measureText(character).width + spacing; }
    ctx.textAlign = align;
  };
  const contain = (img: HTMLImageElement, x: number, y: number, width: number, height: number) => {
    const ratio = Math.min(width / img.naturalWidth, height / img.naturalHeight);
    const w = img.naturalWidth * ratio, h = img.naturalHeight * ratio;
    ctx.drawImage(img, x + (width - w) / 2, y + (height - h) / 2, w, h);
  };
  ctx.fillStyle = '#0b111c'; ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = '#cc2633'; ctx.fillRect(0, 0, 10, 1350);
  ctx.globalCompositeOperation = 'lighten'; contain(mark, 46, 27, 112, 75); ctx.globalCompositeOperation = 'source-over';
  text('GAMEWIRE', 173, 75, '600 26px Oswald', '#f5f7fb', 1.6);
  ctx.textAlign = 'right'; text('FANTASY / START-SIT', 1034, 70, '500 14px "DM Mono"', '#bcc8da', 2); ctx.textAlign = 'left';
  const heading = graphic.kind === 'sit' ? 'MUST SIT' : 'MUST START';
  text(heading, 46, 181, '600 70px Oswald', '#e5eaf3', 1);
  const headingWidth = ctx.measureText(heading).width + heading.length - 1;
  text(graphicPositionLabels[graphic.position], 46 + headingWidth + 24, 181, '500 22px Oswald', '#bcc8da', 2);
  ctx.fillStyle = '#303d52'; ctx.fillRect(46, 212, 988, 3);
  ctx.fillStyle = '#cc2633'; ctx.fillRect(46, 212, 96, 3);
  for (const [index, slot] of graphic.slots.entries()) {
    const y = 216 + index * 257;
    ctx.beginPath(); ctx.roundRect(46, y, 988, 241, 9);
    ctx.fillStyle = '#151f2e'; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = '#111b2b'; ctx.fillRect(46, y, 236, 241); ctx.restore();
    ctx.strokeStyle = '#303d52'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(282, y); ctx.lineTo(282, y + 241); ctx.stroke();
    const { photo, logo } = images[index];
    if (photo) contain(photo, 71, y + 8, 186, 136);
    else { ctx.textAlign = 'center'; text('SELECT PLAYER', 164, y + 90, '500 16px "DM Mono"', '#8198bd'); ctx.textAlign = 'left'; }
    const name = slot.player?.name.toUpperCase() ?? 'PLAYER NAME';
    let nameSize = 25;
    ctx.font = `600 ${nameSize}px Oswald`;
    while (ctx.measureText(name).width > 212 && nameSize > 12) { nameSize -= 1; ctx.font = `600 ${nameSize}px Oswald`; }
    if (ctx.measureText(name).width > 212) throw new Error(`Player ${index + 1}'s name is too long to fit the graphic.`);
    ctx.textAlign = 'center'; text(name, 164, y + 173, `600 ${nameSize}px Oswald`); ctx.textAlign = 'left';
    text(slot.player?.matchup ?? 'TBD', 112, y + 207, '500 12px "DM Mono"', '#bcc8da');
    if (logo) contain(logo, 145, y + 182, 42, 32);
    text(slot.player?.opponent ?? '', 198, y + 207, '500 12px "DM Mono"', '#bcc8da');
    ctx.font = '400 21px "DM Sans"';
    const lines = wrap(ctx, slot.reason || 'Add your reasoning for this player.', 700);
    if (lines.length > 6) throw new Error(`Player ${index + 1}'s reasoning is too long for the template. Shorten it to six lines or fewer.`);
    const top = y + (241 - (25 + lines.length * 30.45)) / 2;
    ctx.beginPath(); ctx.arc(311, top + 5, 3, 0, Math.PI * 2); ctx.fillStyle = '#cc2633'; ctx.fill();
    text('THE GAMEWIRE TAKE', 322, top + 9, '500 11px "DM Mono"', '#8198bd', 1.7);
    lines.forEach((line, lineIndex) => text(line, 308, top + 44 + lineIndex * 30.45, '400 21px "DM Sans"'));
  }
  text('gamewire.us / Live Scores, Fantasy & more', 46, 1277, '500 13px "DM Mono"', '#bcc8da');
  graphicPositions.forEach((position, index) => {
    const x = 821 + index * 55, selected = position === graphic.position;
    ctx.beginPath(); ctx.roundRect(x, 1255, 48, 32, 4);
    ctx.fillStyle = selected ? '#cc2633' : '#0b111c'; ctx.fill();
    ctx.strokeStyle = selected ? '#cc2633' : '#303d52'; ctx.stroke();
    ctx.textAlign = 'center'; text(position, x + 24, 1277, '500 13px Oswald', selected ? '#fff' : '#8198bd'); ctx.textAlign = 'left';
  });
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob); else reject(new Error('The PNG could not be generated.'));
  }, 'image/png'));
}
