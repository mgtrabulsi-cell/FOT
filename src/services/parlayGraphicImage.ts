import { parlayGraphicError, parlayLegLabel } from './parlayGraphic';
import type { ParlayGraphic } from './parlayGraphic';

const imageCache = new Map<string, Promise<HTMLImageElement>>();
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
  const blue = '#159bff', white = '#f4f7fc', muted = '#b7c5df';
  const text = (value: string, x: number, y: number, size: number, color = white, weight = 700, maxWidth?: number) => {
    let fitted = size; ctx.font = `${weight} ${fitted}px Arial, sans-serif`;
    while (maxWidth && ctx.measureText(value).width > maxWidth && fitted > 16) { fitted--; ctx.font = `${weight} ${fitted}px Arial, sans-serif`; }
    if (maxWidth && ctx.measureText(value).width > maxWidth) throw new Error('Text is too long to fit the parlay graphic. Shorten the slate or custom stat label.');
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0c203b'); gradient.addColorStop(0.5, '#060e18'); gradient.addColorStop(1, '#091c36');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  const stripe = (x: number, y: number, direction: number) => {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 190 * direction, y); ctx.lineTo(x, y + 190 * direction); ctx.closePath();
    ctx.fillStyle = '#075dc4'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 30 * direction, y); ctx.lineTo(x + 55 * direction, y);
    ctx.lineTo(x, y + 55 * direction); ctx.lineTo(x, y + 30 * direction); ctx.closePath(); ctx.fillStyle = blue; ctx.fill();
  };
  stripe(0, 0, 1); stripe(width, height, -1);
  ctx.font = '700 84px Arial, sans-serif';
  const gameWidth = ctx.measureText('Game').width, wireWidth = ctx.measureText('wire').width;
  const brandLeft = (width - gameWidth - wireWidth - 105) / 2;
  text('Game', brandLeft, 124, 84); text('wire', brandLeft + gameWidth, 124, 84, '#ef2947');
  const pulseLeft = brandLeft + gameWidth + wireWidth + 5;
  ctx.strokeStyle = '#ef2947'; ctx.lineWidth = 5; ctx.beginPath();
  [[0, 105], [28, 105], [37, 82], [47, 124], [58, 101], [100, 101]].forEach(([x, y], i) => i ? ctx.lineTo(pulseLeft + x, y) : ctx.moveTo(pulseLeft + x, y)); ctx.stroke();
  ctx.textAlign = 'center'; text('LIVE SCORES  /  FANTASY  /  ANALYSIS', 540, 168, 19, muted, 600);
  ctx.textAlign = 'left';
  const prefix = graphic.title === 'SAME GAME PARLAY' ? 'SAME GAME' : graphic.title === 'CROSS GAME PARLAY' ? 'CROSS GAME' : 'THE ANGLE';
  text(prefix, 66, 270, 61, white, 800, graphic.odds.trim() ? 580 : 940);
  text('PARLAY', 66, 351, 78, blue, 800);
  if (graphic.odds.trim()) {
    ctx.strokeStyle = '#227fc0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(678, 218); ctx.lineTo(678, 355); ctx.stroke();
    text(`${Number(graphic.odds) > 0 ? '+' : ''}${Number(graphic.odds)}`, 710, 316, 72, blue, 800, 300);
  }
  ctx.beginPath(); ctx.roundRect(66, 386, 948, 70, 10); ctx.fillStyle = '#0a1728'; ctx.fill(); ctx.strokeStyle = blue; ctx.lineWidth = 1.5; ctx.stroke();
  const sports = [...new Set(graphic.legs.map((leg) => leg.sport))].join(' + ');
  text(graphic.subtitle.trim() || `${sports}  /  ${graphic.legs.length} LEGS`, 88, 431, 28, white, 700, 904);
  const rowHeight = (height - 555) / graphic.legs.length;
  const contain = (img: HTMLImageElement, x: number, y: number, size: number) => {
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
  };
  ctx.strokeStyle = '#1875c0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(94, 493); ctx.lineTo(94, 480 + rowHeight * graphic.legs.length - 12); ctx.stroke();
  graphic.legs.forEach((leg, index) => {
    const y = 480 + index * rowHeight, cy = y + rowHeight / 2;
    ctx.beginPath(); ctx.arc(94, cy, 15, 0, Math.PI * 2); ctx.fillStyle = '#081423'; ctx.fill(); ctx.strokeStyle = blue; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(225, cy, 78, 0, Math.PI * 2); ctx.fillStyle = `#${leg.subject.color}`; ctx.fill();
    ctx.save(); ctx.clip();
    if (photos[index].photo) contain(photos[index].photo, 147, cy - 78, 156);
    else { ctx.textAlign = 'center'; text(leg.type === 'player' ? leg.subject.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('') : leg.sport, 225, cy + 14, 43); ctx.textAlign = 'left'; }
    ctx.restore(); ctx.strokeStyle = blue; ctx.lineWidth = 3; ctx.stroke();
    if (photos[index].logo) {
      ctx.beginPath(); ctx.arc(285, cy + 51, 26, 0, Math.PI * 2); ctx.fillStyle = '#0a1728'; ctx.fill(); ctx.stroke();
      contain(photos[index].logo, 263, cy + 29, 44);
    }
    text(leg.subject.name, 342, cy - 14, 48, blue, 800, 665);
    text(parlayLegLabel(leg).toUpperCase(), 342, cy + 35, 29, white, 600, 665);
    text(`${leg.sport}  /  ${leg.type === 'player' ? leg.subject.teamName : 'TEAM PICK'}`, 342, cy + 67, 17, muted, 500, 665);
    if (index < graphic.legs.length - 1) {
      ctx.strokeStyle = '#254469'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(145, y + rowHeight); ctx.lineTo(1014, y + rowHeight); ctx.stroke();
    }
  });
  text('gamewire.us', 66, height - 38, 21, muted, 600);
  ctx.textAlign = 'right'; text('EDITORIAL PICK  /  NO GUARANTEED OUTCOME', 1014, height - 38, 15, muted, 500);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The parlay PNG could not be generated.')), 'image/png'));
}
