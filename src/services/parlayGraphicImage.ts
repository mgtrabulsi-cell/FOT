import { parlayGraphicError, parlayLegLabel } from './parlayGraphic';
import type { ParlayGraphic } from './parlayGraphic';

const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function parlayPortraitCrop(pixels: Uint8ClampedArray, width: number, height: number) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] < 24) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error('A player portrait is empty. Choose another player or turn off portraits.');
  // Trim ESPN's transparent padding, then frame the head and upper shoulders.
  const size = Math.min(right - left + 1, bottom - top + 1) * 0.86;
  return { x: left + (right - left + 1 - size) / 2, y: top, size };
}
function portrait(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, size: number) {
  const source = document.createElement('canvas');
  source.width = img.naturalWidth; source.height = img.naturalHeight;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error('Your browser could not prepare the player portrait.');
  sourceCtx.drawImage(img, 0, 0);
  const crop = parlayPortraitCrop(sourceCtx.getImageData(0, 0, source.width, source.height).data, source.width, source.height);
  ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, x, y, size, size);
}
function image(url: string) {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const request = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { img.src = ''; reject(new Error('A parlay portrait timed out. Retry, or turn off portraits/logos to render offline.')); }, 12_000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('A parlay portrait could not load. Retry, or turn off portraits/logos to use a name-only graphic.')); };
    img.src = url;
  });
  imageCache.set(url, request);
  void request.catch(() => imageCache.delete(url));
  return request;
}
export async function renderParlayGraphic(graphic: ParlayGraphic): Promise<Blob> {
  const error = parlayGraphicError(graphic);
  if (error) throw new Error(error);
  const photos = await Promise.all(graphic.legs.map(async (leg) => ({
    photo: graphic.images && leg.subject.image ? await image(leg.subject.image) : null,
    logo: graphic.images && leg.subject.teamLogo && leg.type === 'player' ? await image(leg.subject.teamLogo) : null,
  })));
  const width = 1080, height = Math.max(1350, 480 + graphic.legs.length * 220 + 100);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser does not support parlay graphics.');
  const accent = '#cc2633', white = '#e5eaf3', muted = '#bcc8da';
  const text = (value: string, x: number, y: number, size: number, color = white, weight = 700, maxWidth?: number) => {
    let fitted = size; ctx.font = `${weight} ${fitted}px Arial, sans-serif`;
    while (maxWidth && ctx.measureText(value).width > maxWidth && fitted > 16) { fitted--; ctx.font = `${weight} ${fitted}px Arial, sans-serif`; }
    if (maxWidth && ctx.measureText(value).width > maxWidth) throw new Error('Text is too long to fit the parlay graphic. Shorten the slate or custom stat label.');
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#151f2e'); gradient.addColorStop(0.5, '#0b111c'); gradient.addColorStop(1, '#131b2a');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  const stripe = (x: number, y: number, direction: number) => {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 190 * direction, y); ctx.lineTo(x, y + 190 * direction); ctx.closePath();
    ctx.fillStyle = '#62212b'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 30 * direction, y); ctx.lineTo(x + 55 * direction, y);
    ctx.lineTo(x, y + 55 * direction); ctx.lineTo(x, y + 30 * direction); ctx.closePath(); ctx.fillStyle = accent; ctx.fill();
  };
  stripe(0, 0, 1); stripe(width, height, -1);
  ctx.font = '700 84px Arial, sans-serif';
  const gameWidth = ctx.measureText('Game').width, wireWidth = ctx.measureText('wire').width;
  const brandLeft = (width - gameWidth - wireWidth - 105) / 2;
  text('Game', brandLeft, 124, 84); text('wire', brandLeft + gameWidth, 124, 84, accent);
  const pulseLeft = brandLeft + gameWidth + wireWidth + 5;
  ctx.strokeStyle = accent; ctx.lineWidth = 5; ctx.beginPath();
  [[0, 105], [28, 105], [37, 82], [47, 124], [58, 101], [100, 101]].forEach(([x, y], i) => i ? ctx.lineTo(pulseLeft + x, y) : ctx.moveTo(pulseLeft + x, y)); ctx.stroke();
  ctx.textAlign = 'center'; text('LIVE SCORES  /  FANTASY  /  ANALYSIS', 540, 168, 19, muted, 600);
  ctx.textAlign = 'left';
  const prefix = graphic.title === 'SAME GAME PARLAY' ? 'SAME GAME' : graphic.title === 'CROSS GAME PARLAY' ? 'CROSS GAME' : 'THE ANGLE';
  text(prefix, 66, 270, 61, white, 800, graphic.odds.trim() ? 580 : 940);
  text('PARLAY', 66, 351, 78, accent, 800);
  if (graphic.odds.trim()) {
    ctx.strokeStyle = '#303d52'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(678, 218); ctx.lineTo(678, 355); ctx.stroke();
    text(`${Number(graphic.odds) > 0 ? '+' : ''}${Number(graphic.odds)}`, 710, 316, 72, white, 800, 300);
  }
  ctx.beginPath(); ctx.roundRect(66, 386, 948, 70, 10); ctx.fillStyle = '#151f2e'; ctx.fill(); ctx.strokeStyle = '#303d52'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = accent; ctx.fillRect(66, 399, 4, 44);
  const sports = [...new Set(graphic.legs.map((leg) => leg.sport))].join(' + ');
  text(graphic.subtitle.trim() || `${sports}  /  ${graphic.legs.length} LEGS`, 88, 431, 28, white, 700, 904);
  const rowHeight = (height - 555) / graphic.legs.length;
  const contain = (img: HTMLImageElement, x: number, y: number, size: number) => {
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
  };
  ctx.strokeStyle = '#303d52'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(94, 493); ctx.lineTo(94, 480 + rowHeight * graphic.legs.length - 12); ctx.stroke();
  graphic.legs.forEach((leg, index) => {
    const y = 480 + index * rowHeight, cy = y + rowHeight / 2;
    ctx.beginPath(); ctx.arc(94, cy, 15, 0, Math.PI * 2); ctx.fillStyle = '#0b111c'; ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(225, cy, 78, 0, Math.PI * 2); ctx.fillStyle = '#151f2e'; ctx.fill();
    ctx.save(); ctx.clip();
    if (photos[index].photo) {
      if (leg.type === 'player') portrait(ctx, photos[index].photo, 147, cy - 78, 156);
      else contain(photos[index].photo, 157, cy - 68, 136);
    }
    else { ctx.textAlign = 'center'; text(leg.type === 'player' || leg.type === 'custom' ? leg.subject.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('') : leg.sport, 225, cy + 14, 43); ctx.textAlign = 'left'; }
    ctx.restore(); ctx.strokeStyle = '#8198bd'; ctx.lineWidth = 3; ctx.stroke();
    if (photos[index].logo) {
      ctx.beginPath(); ctx.arc(285, cy + 51, 26, 0, Math.PI * 2); ctx.fillStyle = '#151f2e'; ctx.fill(); ctx.stroke();
      contain(photos[index].logo, 263, cy + 29, 44);
    }
    text(leg.subject.name, 342, cy - 14, 48, white, 800, 665);
    text(parlayLegLabel(leg).toUpperCase(), 342, cy + 35, 29, muted, 600, 665);
    text(`${leg.sport}  /  ${leg.type === 'custom' ? leg.subject.teamName.trim() || 'MANUAL SELECTION' : leg.type === 'player' ? leg.subject.teamName : 'TEAM PICK'}`, 342, cy + 67, 17, muted, 500, 665);
    if (index < graphic.legs.length - 1) {
      ctx.strokeStyle = '#303d52'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(145, y + rowHeight); ctx.lineTo(1014, y + rowHeight); ctx.stroke();
    }
  });
  text('gamewire.us', 66, height - 38, 21, muted, 600);
  ctx.textAlign = 'right'; text('EDITORIAL PICK  /  NO GUARANTEED OUTCOME', 1014, height - 38, 15, muted, 500);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The parlay PNG could not be generated.')), 'image/png'));
}
