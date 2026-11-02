import { loadGamewireGraphicAssets } from './gamewaireResultsGraphic';
import { isParlaySubject } from './parlayGraphic';
import type { ParlaySubject } from './parlayGraphic';
import { drawGraphicPortrait, loadGraphicImage } from './parlayGraphicImage';
export type BestBetSubject = { type: 'player' | 'team'; subject: ParlaySubject };
export type BestBetEntry = { id: string; sport: string; selection: string; odds: string; result: 'pending' | 'hit' | 'miss'; participant?: BestBetSubject };
export type BestBetGraphic = { title: string; subtitle: string; entries: BestBetEntry[]; images?: boolean };
export const newBestBetEntry = (): BestBetEntry => ({ id: crypto.randomUUID(), sport: 'NFL', selection: '', odds: '', result: 'pending' });
export const newBestBetGraphic = (): BestBetGraphic => ({ title: 'BEST BETS', subtitle: '', entries: [newBestBetEntry()], images: true });
export function readBestBetGraphic(value: unknown): BestBetGraphic {
  if (!value || typeof value !== 'object' || !('title' in value) || typeof value.title !== 'string' || value.title.length > 48
    || !('subtitle' in value) || typeof value.subtitle !== 'string' || value.subtitle.length > 100
    || ('images' in value && typeof value.images !== 'boolean')
    || !('entries' in value) || !Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 8
    || !value.entries.every(row => row && typeof row.id === 'string' && typeof row.sport === 'string' && row.sport.length <= 20
      && typeof row.selection === 'string' && row.selection.length <= 200 && typeof row.odds === 'string' && row.odds.length <= 12
      && ['pending', 'hit', 'miss'].includes(row.result)
      && (row.participant === undefined || (row.participant && ['player', 'team'].includes(row.participant.type)
        && isParlaySubject(row.participant.subject))))
    || new Set(value.entries.map(row => row.id)).size !== value.entries.length) throw new Error('The saved Best Bet draft is invalid. It was not overwritten.');
  return { title: value.title, subtitle: value.subtitle, entries: value.entries, images: !('images' in value) || value.images === true };
}
export function bestBetGraphicError(value: BestBetGraphic): string | null {
  readBestBetGraphic(value);
  if (!value.title.trim()) return 'Enter a graphic title.';
  if (value.entries.some(row => !row.sport.trim() || !row.selection.trim())) return 'Enter a sport and selection for every straight bet.';
  if (value.entries.some(row => row.odds && (!/^[+-]\d{3,5}$/.test(row.odds) || Math.abs(Number(row.odds)) < 100))) return 'Use American odds such as -110 or +150, or leave odds blank.';
  return null;
}
export function bestBetGraphicHeight(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('Choose one to eight straight bets.');
  return count <= 3 ? 558 + count * 230 : 1350;
}
export async function renderBestBetGraphic(value: BestBetGraphic): Promise<Blob> {
  const error = bestBetGraphicError(value);
  if (error) throw new Error(error);
  const logo = await loadGamewireGraphicAssets();
  const photos = await Promise.all(value.entries.map(async (row, index) => {
    try {
      return {
        photo: value.images !== false && row.participant?.subject.image ? await loadGraphicImage(row.participant.subject.image) : null,
        logo: value.images !== false && row.participant?.type === 'player' && row.participant.subject.teamLogo
          ? await loadGraphicImage(row.participant.subject.teamLogo) : null,
      };
    } catch (cause) {
      throw new Error(`Straight ${index + 1}${row.participant ? ` / ${row.participant.subject.name}` : ''}: ${cause instanceof Error ? cause.message : 'The selected image could not load. Retry.'}`);
    }
  }));
  const canvas = document.createElement('canvas'), graphicHeight = bestBetGraphicHeight(value.entries.length);
  canvas.width = 2160; canvas.height = graphicHeight * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the Best Bet graphic.');
  ctx.scale(2, 2);
  const text = (value: string, x: number, y: number, size: number, width: number, color = '#e5eaf3', family = '"DM Sans"') => {
    ctx.font = `700 ${size}px ${family}`;
    while (ctx.measureText(value).width > width && size > 16) { size--; ctx.font = `700 ${size}px ${family}`; }
    if (ctx.measureText(value).width > width) throw new Error('A label is too long to fit. Shorten it before downloading.');
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  const background = ctx.createLinearGradient(0, 0, 1080, graphicHeight);
  background.addColorStop(0, '#101e30'); background.addColorStop(1, '#060f1c');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1080, graphicHeight);
  ctx.fillStyle = '#18344b';
  for (let x = 24; x < 1080; x += 32) for (let y = 24; y < graphicHeight; y += 32) ctx.fillRect(x, y, 2, 2);
  ctx.fillStyle = '#cc2633'; ctx.fillRect(0, 0, 10, graphicHeight);
  ctx.fillStyle = '#32bafa'; ctx.fillRect(0, 0, 1080, 7);
  ctx.drawImage(logo, 805, 40, 225, 225 * logo.naturalHeight / logo.naturalWidth);
  text('GAMEWIRE / ANALYST DESK', 50, 87, 24, 720, '#bcc8da', 'Oswald');
  text(value.title.toUpperCase(), 50, 195, 76, 720, '#e5eaf3', 'Oswald');
  text('INDEPENDENT STRAIGHT PICKS', 50, 237, 22, 980, '#ff5965');
  if (value.subtitle.trim()) text(value.subtitle.trim(), 50, 284, 25, 980, '#b6c6db');
  const top = 318, available = value.entries.length <= 3 ? value.entries.length * 230 : 780;
  const stride = available / value.entries.length, height = stride - 20;
  const wrap = (value: string, width: number, size: number) => {
    for (; size >= 18; size--) {
      ctx.font = `700 ${size}px "DM Sans"`;
      const lines: string[] = []; let line = '', tooWide = false;
      for (const word of value.split(/\s+/)) {
        if (ctx.measureText(word).width > width) { tooWide = true; break; }
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
      if (!tooWide && lines.length <= 2) return { lines, size };
    }
    throw new Error('A selection is too long to fit. Shorten it before downloading.');
  };
  const contain = (img: HTMLImageElement, x: number, y: number, size: number) => {
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
  };
  value.entries.forEach((row, index) => {
    const y = top + index * stride, left = 50;
    ctx.beginPath(); ctx.roundRect(left, y, 980, height, 14); ctx.fillStyle = '#0d1c2d'; ctx.fill();
    ctx.strokeStyle = '#267da8'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#cc2633'; ctx.fillRect(left, y + 16, 5, height - 32);
    const photoSize = Math.min(150, height - 20), hasPhoto = !!photos[index].photo;
    const textLeft = hasPhoto ? 74 + photoSize + 24 : 74, textWidth = 910 - textLeft;
    if (hasPhoto) {
      const photo = photos[index].photo!;
      const py = y + (height - photoSize) / 2;
      ctx.beginPath(); ctx.arc(74 + photoSize / 2, py + photoSize / 2, photoSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#152c44'; ctx.fill(); ctx.save(); ctx.clip();
      if (row.participant?.type === 'player') drawGraphicPortrait(ctx, photo, 74, py, photoSize);
      else contain(photo, 80, py + 6, photoSize - 12);
      ctx.restore(); ctx.strokeStyle = '#489bcc'; ctx.lineWidth = 2; ctx.stroke();
      if (photos[index].logo) contain(photos[index].logo!, 74 + photoSize - 30, py + photoSize - 30, 34);
    }
    const kicker = row.participant ? `${row.participant.subject.name} / ${row.sport.toUpperCase()}` : row.sport.toUpperCase();
    text(`${kicker}${row.odds ? ` / ${row.odds}` : ''}`, textLeft, y + 26, 18, textWidth, '#8bc9ea');
    const selection = wrap(row.selection.trim(), textWidth, Math.max(18, Math.min(value.entries.length <= 3 ? 48 : 36, (height - 40) / 2.15)));
    const firstBaseline = y + 38 + (height - 38 - selection.lines.length * selection.size * 1.15) / 2 + selection.size;
    selection.lines.forEach((line, i) => text(line, textLeft, firstBaseline + selection.size * 1.15 * i, selection.size, textWidth));
    if (index < value.entries.length - 1) {
      ctx.fillStyle = '#4a9dc4'; ctx.fillRect(70, y + height + 9, 940, 2);
    }
    const cx = 974, cy = y + height / 2;
    ctx.lineWidth = 6; ctx.lineCap = 'round';
    if (row.result === 'hit') {
      ctx.strokeStyle = '#65da9d'; ctx.beginPath(); ctx.moveTo(cx - 17, cy); ctx.lineTo(cx - 5, cy + 12); ctx.lineTo(cx + 18, cy - 14); ctx.stroke();
    } else if (row.result === 'miss') {
      ctx.strokeStyle = '#ff5965'; ctx.beginPath(); ctx.moveTo(cx - 13, cy - 13); ctx.lineTo(cx + 13, cy + 13); ctx.moveTo(cx + 13, cy - 13); ctx.lineTo(cx - 13, cy + 13); ctx.stroke();
    }
  });
  const footerTop = graphicHeight - 210;
  ctx.beginPath(); ctx.roundRect(50, footerTop, 980, 100, 14); ctx.fillStyle = '#112337'; ctx.fill(); ctx.strokeStyle = '#32bafa'; ctx.stroke();
  const settled = value.entries.filter(row => row.result !== 'pending'), wins = settled.filter(row => row.result === 'hit').length;
  text(settled.length ? `${wins} / ${settled.length} STRAIGHTS HIT` : `${value.entries.length} BEST BET${value.entries.length === 1 ? '' : 'S'}`, 80, footerTop + 65, 44, 600, '#e5eaf3', 'Oswald');
  text('GAMEWIRE', 730, footerTop + 63, 34, 270, '#e5eaf3', 'Oswald');
  text(settled.length ? 'Results manually entered / Pending excluded from hit total' : 'Separate straight selections / Not a parlay', 50, graphicHeight - 65, 19, 980, '#b6c6db');
  text('Editorial opinions / No guaranteed outcomes / gamewire.us', 50, graphicHeight - 25, 19, 980, '#b6c6db');
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Your browser could not export the Best Bet PNG. Retry.')), 'image/png'));
}
