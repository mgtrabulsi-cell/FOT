import type { StoredPick } from './gamewaire';
import { performance } from './gamewaire';

export function resultsGraphicSections(picks: StoredPick[]) {
  const unique = [...new Map(picks.filter((pick) => pick.is_top_pick || pick.is_game_lean).map((pick) => [pick.id, pick])).values()];
  return ([['TOP PICKS', unique.filter((pick) => pick.is_top_pick)],
    ['GAME LEANS', unique.filter((pick) => pick.is_game_lean)], ['ALL PICKS', unique]] as const).map(([title, rows]) => {
    const record = performance(rows.map((pick) => ({ probability: pick.probability, pushProbability: pick.push_probability,
      american: pick.american, result: pick.result, withdrawn: pick.withdrawn })));
    return { title, wins: record.wins, losses: rows.filter((pick) => pick.result === 'loss').length,
      hitRate: record.winRate, pending: record.pending, pushes: rows.filter((pick) => pick.result === 'push').length,
      voids: rows.filter((pick) => pick.result === 'void').length };
  });
}
export async function renderResultsGraphic(picks: StoredPick[], now = new Date()): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the results graphic.');
  const ink = '#e5eaf3', muted = '#b6c6db', red = '#ff5965', green = '#86d9ad';
  const text = (value: string, x: number, y: number, size: number, color = ink, maxWidth = 960, weight = 700) => {
    let fitted = size;
    ctx.font = `${weight} ${fitted}px Arial, sans-serif`;
    while (ctx.measureText(value).width > maxWidth && fitted > 14) { fitted--; ctx.font = `${weight} ${fitted}px Arial, sans-serif`; }
    if (ctx.measureText(value).width > maxWidth) throw new Error('A results label is too long to fit the graphic.');
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, '#151f2e'); gradient.addColorStop(1, '#0c1523');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = red; ctx.fillRect(60, 55, 75, 7);
  text('GAMEWIRE', 60, 116, 36);
  text('Gamew', 60, 211, 76);
  const aiX = 60 + ctx.measureText('Gamew').width;
  text('AI', aiX, 211, 76, red);
  text('re', aiX + ctx.measureText('AI').width, 211, 76);
  text('THE RECORD', 60, 270, 30, red);
  const generated = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(now);
  text(`ALL TIME / NBA + NFL / AS OF ${generated.toUpperCase()} ET`, 60, 310, 22, muted);
  resultsGraphicSections(picks).forEach((section, index) => {
    const y = 362 + index * 264;
    text(section.title, 60, y + 28, 26, muted);
    const stats = [
      { label: 'RECORD', value: `${section.wins} W / ${section.losses} L`, width: 364 },
      { label: 'PENDING', value: String(section.pending), width: 244 },
      { label: 'HIT RATE', value: section.hitRate === null ? 'N/A' : `${(section.hitRate * 100).toFixed(1)}%`, width: 320 },
    ];
    let x = 60;
    stats.forEach((stat) => {
      ctx.beginPath(); ctx.roundRect(x, y + 50, stat.width, 162, 8); ctx.fillStyle = '#101b2c'; ctx.fill();
      ctx.strokeStyle = '#263b55'; ctx.lineWidth = 2; ctx.stroke();
      text(stat.label, x + 24, y + 91, 21, muted, stat.width - 48);
      text(stat.value, x + 24, y + 163, 50, stat.label === 'HIT RATE' && section.hitRate !== null && section.hitRate > 0.5 ? green : ink, stat.width - 48);
      x += stat.width + 16;
    });
    text(`${section.pushes} push / ${section.voids} void`, 60, y + 243, 19, muted, 960, 400);
  });
  text('Hit rate = Wins / (Wins + Losses). Pending, pushes and voids excluded.', 60, 1222, 20, muted);
  text('Admin-recorded outcomes / No guaranteed future results', 60, 1260, 19, muted);
  text('gamewire.us', 60, 1305, 24, ink);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob)
    : reject(new Error('Your browser could not export the results PNG. Retry.')), 'image/png'));
}
