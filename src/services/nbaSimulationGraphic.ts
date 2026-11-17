import { loadGamewireGraphicAssets } from './gamewaireResultsGraphic';

export type NBAGraphicRow = { title: string; detail: string; line: string; note: string };
export async function renderNBASimulationGraphic(title: string, subtitle: string, rows: NBAGraphicRow[]): Promise<Blob> {
  if (!rows.length) throw new Error('No verified NBA projections or results are available to export.');
  if (rows.length > 200) throw new Error('Choose a smaller NBA slate for this graphic.');
  await loadGamewireGraphicAssets();
  const canvas = document.createElement('canvas'), height = Math.max(1350, 420 + rows.length * 140);
  canvas.width = 1080; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the NBA simulation graphic.');
  ctx.fillStyle = '#061221'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const text = (value: string, x: number, y: number, size: number, color: string, width = 952) => {
    ctx.fillStyle = color;
    do { ctx.font = `700 ${size--}px "DM Sans"`; } while (ctx.measureText(value).width > width && size >= 12);
    if (ctx.measureText(value).width > width) throw new Error('An NBA graphic label is too long to fit. Shorten the slate selection.');
    ctx.fillText(value, x, y);
  };
  text('GamewAIre / NBA', 64, 86, 46, '#ff4663');
  text(title, 64, 146, 34, '#f2f6fc');
  text(subtitle, 64, 184, 20, '#a8bfdc');
  rows.forEach((row, i) => {
    const y = 222 + i * 140;
    ctx.fillStyle = '#10243a'; ctx.beginPath(); ctx.roundRect(48, y, 984, 124, 12); ctx.fill();
    ctx.fillStyle = '#36baff'; ctx.fillRect(48, y + 12, 4, 100);
    text(row.title, 72, y + 29, 25, '#f2f6fc', 928);
    text(row.detail, 72, y + 55, 17, '#a8bfdc', 928);
    text(row.line, 72, y + 84, 23, '#55d8a1', 928);
    text(row.note, 72, y + 109, 16, '#a8bfdc', 928);
  });
  const footer = height - 108;
  text('Experimental estimates, not guarantees or betting recommendations.', 64, footer, 18, '#a8bfdc');
  text('PRA = points + rebounds + assists. No player photos or provider logos.', 64, footer + 28, 17, '#a8bfdc');
  text('gamewire.us', 64, footer + 62, 24, '#f2f6fc');
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('NBA graphic export failed. Retry.')), 'image/png'));
}
