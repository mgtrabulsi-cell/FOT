import { loadGamewireGraphicAssets } from './gamewaireResultsGraphic';

export type BetGraphicRow = {
  label: string; name: string; selection: string; odds?: string;
  result?: 'pending' | 'hit' | 'miss'; photo?: HTMLImageElement | null;
};
export const betGraphicHeight = (count: number) => 440 + count * 150;

async function stadiumImage() {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.src = ''; reject(new Error('The stadium background timed out. Reconnect and retry.')); }, 15_000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('The stadium background could not load. Reconnect and retry.')); };
    image.src = `${import.meta.env.BASE_URL}bet-stadium-night.png`;
  });
}

async function loadNameFont() {
  const font = '600 35px "DM Sans"';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const faces = await Promise.race([
    document.fonts.load(font),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The graphic name font timed out. Reconnect and retry.')), 15_000);
    }),
  ]).finally(() => clearTimeout(timer));
  if (!faces.length || !document.fonts.check(font)) throw new Error('The graphic name font could not load. Reconnect and retry.');
}

export async function renderBetGraphic({ title, subtitle, rows, summary, note, scale = 1, typography = 'balanced' }: {
  title: string; subtitle: string; rows: BetGraphicRow[]; summary: string; note: string; scale?: number; typography?: 'balanced' | 'brand';
}): Promise<Blob> {
  const [logo, stadium] = await Promise.all([loadGamewireGraphicAssets(), stadiumImage(), loadNameFont()]);
  const height = betGraphicHeight(rows.length), width = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the graphic.');
  ctx.scale(scale, scale);
  const cyan = '#39bcff', white = '#f2f6fc', muted = '#b7c8db';
  const brandTypography = typography === 'brand';
  const text = (value: string, x: number, y: number, size: number, maxWidth: number, color: string | CanvasGradient = white, display = true, weight = display ? 700 : 400, italic = false, centered = false) => {
    const family = brandTypography || !display ? '"DM Sans"' : 'Oswald';
    const font = (size: number) => `${italic || brandTypography ? 'italic ' : ''}${brandTypography && !italic ? 600 : weight} ${size}px ${family}`;
    ctx.font = font(size);
    while (ctx.measureText(value).width > maxWidth && size > 16) {
      size--; ctx.font = font(size);
    }
    if (ctx.measureText(value).width > maxWidth) throw new Error('A graphic label is too long. Shorten it before exporting.');
    if (centered) {
      const bounds = ctx.measureText(value);
      x += ((bounds.actualBoundingBoxLeft ?? 0) - (bounds.actualBoundingBoxRight ?? 0)) / 2;
      y += ((bounds.actualBoundingBoxAscent ?? size * 0.75) - (bounds.actualBoundingBoxDescent ?? size * 0.2)) / 2;
    }
    if (brandTypography && color !== red && color !== '#6dff88' && color !== '#ff6573') {
      const metallic = ctx.createLinearGradient(0, y - size, 0, y + 3);
      metallic.addColorStop(0, '#ffffff'); metallic.addColorStop(0.45, '#eef3fa');
      metallic.addColorStop(0.58, '#c5d0df'); metallic.addColorStop(1, '#ffffff');
      ctx.fillStyle = metallic;
    } else ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  };
  const panel = (x: number, y: number, w: number, h: number, slant = 18, glow = false) => {
    ctx.beginPath(); ctx.moveTo(x + slant, y); ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - slant, y + h); ctx.lineTo(x, y + h); ctx.closePath();
    ctx.fillStyle = 'rgba(0, 7, 16, 0.88)'; ctx.fill();
    ctx.strokeStyle = cyan; ctx.lineWidth = glow ? 2.5 : 1;
    ctx.shadowColor = '#009dff'; ctx.shadowBlur = glow ? 14 : 4;
    ctx.stroke(); ctx.shadowBlur = 0;
  };
  const line = (x: number, y: number, endX: number, endY: number, glow = false) => {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(endX, endY);
    ctx.strokeStyle = cyan; ctx.lineWidth = 2;
    ctx.shadowColor = '#00aaff'; ctx.shadowBlur = glow ? 12 : 0; ctx.stroke(); ctx.shadowBlur = 0;
  };
  const shine = (x: number, y: number, span: number) => {
    ctx.save();
    const glow = ctx.createLinearGradient(x - span / 2, y, x + span / 2, y);
    glow.addColorStop(0, 'rgba(25, 166, 255, 0)');
    glow.addColorStop(0.35, '#29b8ff'); glow.addColorStop(0.5, '#ffffff');
    glow.addColorStop(0.65, '#29b8ff'); glow.addColorStop(1, 'rgba(25, 166, 255, 0)');
    ctx.strokeStyle = glow; ctx.lineWidth = 3;
    ctx.shadowColor = '#19aaff'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.moveTo(x - span / 2, y); ctx.lineTo(x + span / 2, y); ctx.stroke();
    ctx.translate(x, y); ctx.scale(1, 0.16);
    const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, span / 2);
    bloom.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    bloom.addColorStop(0.12, 'rgba(160, 224, 255, 0.8)');
    bloom.addColorStop(0.4, 'rgba(20, 153, 255, 0.3)');
    bloom.addColorStop(1, 'rgba(0, 100, 255, 0)');
    ctx.shadowBlur = 0; ctx.fillStyle = bloom;
    ctx.fillRect(-span / 2, -span / 2, span, span);
    ctx.restore();
  };
  const silver = ctx.createLinearGradient(0, 48, 0, 108);
  silver.addColorStop(0, '#ffffff'); silver.addColorStop(0.42, '#edf6ff');
  silver.addColorStop(0.55, '#a3b8ce'); silver.addColorStop(1, '#ffffff');
  const red = ctx.createLinearGradient(0, 48, 0, 108);
  red.addColorStop(0, '#ff7980'); red.addColorStop(0.45, '#ff3542'); red.addColorStop(1, '#9e0c18');
  ctx.drawImage(stadium, 0, 0, width, height);
  ctx.fillStyle = 'rgba(0, 5, 14, 0.20)'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(0, 5, 12, 0.86)'; ctx.fillRect(0, 0, width, 154);
  ctx.drawImage(logo, 10, 0, 230, 230 * logo.naturalHeight / logo.naturalWidth);
  line(240, 33, 240, 123);
  text('GAME', 270, 91, 52, 170, silver, false, 700, true);
  const brandSplit = 270 + ctx.measureText('GAME').width;
  text('WIRE', brandSplit, 91, 52, 160, red, false, 700, true);
  text('LIVE SCORES, FANTASY & MORE', 276, 119, 13, 310, muted, false);
  const banner = { x: 665, y: 40, width: 365, height: 88, slant: 32 };
  panel(banner.x, banner.y, banner.width, banner.height, banner.slant, true);
  ctx.textAlign = 'center';
  text(title.toUpperCase(), banner.x + banner.width / 2, banner.y + banner.height / 2,
    46, banner.width - banner.slant * 2 - 20, silver, false, 700, true, true);
  ctx.textAlign = 'left';
  shine(850, banner.y, 220); shine(850, banner.y + banner.height, 250);
  ctx.save(); ctx.strokeStyle = '#b7ecff'; ctx.lineWidth = 2;
  ctx.shadowColor = '#24baff'; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.moveTo(banner.x + banner.slant, banner.y);
  ctx.lineTo(banner.x, banner.y + banner.height); ctx.stroke(); ctx.restore();
  line(0, 154, width, 154, true);
  ctx.textAlign = 'center';
  text(subtitle || [...new Set(rows.map(row => row.label))].join(' / '), 540, 205, 24, 952, white, false, 400, false, true);
  ctx.textAlign = 'left';
  rows.forEach((row, index) => {
    const y = 250 + index * 150;
    panel(52, y, 976, 150, 16);
    line(220, y + 29, 220, y + 121);
    const labelParts = row.label.toUpperCase().split(/\s+/);
    ctx.textAlign = 'center';
    if (labelParts.length > 1) {
      const middle = Math.ceil(labelParts.length / 2);
      text(labelParts.slice(0, middle).join(' '), 140, y + 58, 24, 110, white, true, 700, false, true);
      text(labelParts.slice(middle).join(' '), 140, y + 92, 24, 110, white, true, 700, false, true);
    } else text(row.label.toUpperCase(), 140, y + 75, 39, 110, white, true, 700, false, true);
    ctx.textAlign = 'left';
    const hasOdds = !!row.odds, contentWidth = hasOdds ? 580 : 690;
    if (hasOdds) {
      line(874, y + 29, 874, y + 121);
      ctx.textAlign = 'right';
      text(row.odds!, 994, y + 85, 43, 102);
      ctx.textAlign = 'left';
    }
    let left = 252, available = contentWidth;
    if (row.photo) {
      const ratio = Math.min(78 / row.photo.naturalWidth, 100 / row.photo.naturalHeight);
      const w = row.photo.naturalWidth * ratio, h = row.photo.naturalHeight * ratio;
      ctx.drawImage(row.photo, left + (78 - w) / 2, y + (150 - h) / 2, w, h);
      left += 96; available -= 96;
    }
    if (row.name) text(row.name, left, y + 55, 35, available, white, false, 600);
    let selectionLines: string[] = [], selectionSize = row.name ? 30 : 35;
    for (; selectionSize >= 18; selectionSize--) {
      ctx.font = `${brandTypography ? 'italic 600' : '400'} ${selectionSize}px "DM Sans"`;
      const lines: string[] = [];
      let current = '';
      for (const word of row.selection.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (current && ctx.measureText(next).width > available) { lines.push(current); current = word; }
        else current = next;
      }
      if (current) lines.push(current);
      if (lines.length <= 2 && lines.every(value => ctx.measureText(value).width <= available)) { selectionLines = lines; break; }
    }
    if (!selectionLines.length) throw new Error('A selection is too long to fit. Shorten it before exporting.');
    const selectionY = row.name ? y + 93 : y + (selectionLines.length === 1 ? 87 : 65);
    selectionLines.forEach((value, i) => text(value, left, selectionY + i * selectionSize * 1.15, selectionSize, available, white, false));
    if (row.result && row.result !== 'pending') {
      text(row.result === 'hit' ? 'HIT' : 'MISS', left, y + 130, 16, available, row.result === 'hit' ? '#6dff88' : '#ff6573');
    }
  });
  const footer = 270 + rows.length * 150;
  panel(52, footer, 976, 83, 24, true);
  text(summary, 94, footer + 55, 34, 850, '#75ff8e');
  text(note, 64, height - 48, 16, 950, muted, false);
  text('GAMEWIRE.US  /  EDITORIAL SELECTIONS  /  NO GUARANTEED OUTCOMES', 64, height - 20, 13, 950, muted, false);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Your browser could not export the PNG. Retry.')), 'image/png'));
}
