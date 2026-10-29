import type { StoredPick } from './gamewaire';
import { performance } from './gamewaire';

const labels = { win: 'HIT', loss: 'MISSED', pending: 'PENDING', push: 'PUSH', void: 'VOID' };
const markets: Record<string, string> = {
  totals: 'Total points', player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
  player_threes: 'Made threes', player_pass_yds: 'Passing yards', player_rush_yds: 'Rushing yards',
  player_reception_yds: 'Receiving yards', player_receptions: 'Receptions',
};
export function resultsGraphicSections(picks: StoredPick[]) {
  const unique = [...new Map(picks.filter((pick) => pick.is_top_pick || pick.is_game_lean).map((pick) => [pick.id, pick])).values()]
    .sort((a, b) => Date.parse(b.event_start) - Date.parse(a.event_start) || a.id.localeCompare(b.id));
  return ([['GAME LEANS', unique.filter((pick) => pick.is_game_lean)],
    ['TOP PICKS', unique.filter((pick) => pick.is_top_pick)], ['ALL PICKS', unique]] as const).map(([title, rows]) => {
    const record = performance(rows.map((pick) => ({ probability: pick.probability, pushProbability: pick.push_probability,
      american: pick.american, result: pick.result, withdrawn: pick.withdrawn })));
    return { title, wins: record.wins, losses: rows.filter((pick) => pick.result === 'loss').length,
      hitRate: record.winRate, pending: record.pending, pushes: rows.filter((pick) => pick.result === 'push').length,
      voids: rows.filter((pick) => pick.result === 'void').length, recent: rows.slice(0, 3) };
  });
}
function selection(pick: StoredPick) {
  if (pick.market === 'h2h') return `${pick.subject} ML`;
  if (pick.market === 'spreads') return `${pick.subject} ${pick.line === null ? '' : `${pick.line > 0 ? '+' : ''}${pick.line}`}`.trim();
  return `${pick.subject} / ${pick.side}${pick.line === null ? '' : ` ${pick.line}`} ${markets[pick.market] ?? pick.market.replace(/_/g, ' ')}`;
}
export async function renderResultsGraphic(picks: StoredPick[], now = new Date()): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1800;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the results graphic.');
  const ink = '#e5eaf3', muted = '#bcc8da', red = '#cc2633';
  const text = (value: string, x: number, y: number, size: number, color = ink, maxWidth = 960, weight = 700) => {
    let fitted = size;
    ctx.font = `${weight} ${fitted}px Arial, sans-serif`;
    while (ctx.measureText(value).width > maxWidth && fitted > 14) { fitted--; ctx.font = `${weight} ${fitted}px Arial, sans-serif`; }
    if (ctx.measureText(value).width > maxWidth) throw new Error('A results label is too long to fit the graphic.');
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  const wrapped = (value: string, x: number, y: number, maxWidth: number) => {
    for (let size = 27; size >= 14; size--) {
      ctx.font = `700 ${size}px Arial, sans-serif`;
      const words = value.split(/\s+/), lines: string[] = [];
      let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
      if (lines.length <= 2 && lines.every((part) => ctx.measureText(part).width <= maxWidth)) {
        lines.forEach((part, i) => text(part, x, y + i * 29, size, ink, maxWidth));
        return;
      }
    }
    throw new Error('A pick name is too long to fit the results graphic.');
  };
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1800);
  gradient.addColorStop(0, '#151f2e'); gradient.addColorStop(1, '#0b111c');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1800);
  ctx.fillStyle = red; ctx.fillRect(60, 55, 75, 7);
  text('GAMEWIRE', 60, 116, 46); text('GAMEwAIre', 60, 199, 72);
  text('THE RESULTS', 60, 251, 36, red);
  const generated = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(now);
  text(`ALL-TIME / NBA + NFL / AS OF ${generated.toUpperCase()} ET`, 60, 292, 20, muted);
  resultsGraphicSections(picks).forEach((section, index) => {
    const y = 325 + index * 456;
    ctx.beginPath(); ctx.roundRect(60, y, 960, 432, 14); ctx.fillStyle = '#151f2e'; ctx.fill();
    ctx.strokeStyle = '#303d52'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = red; ctx.fillRect(60, y + 22, 5, 68);
    text(section.title, 86, y + 45, 28);
    text(`${section.wins} HIT / ${section.losses} MISSED`, 86, y + 89, 34, ink, 620);
    text(section.hitRate === null ? 'N/A' : `${(section.hitRate * 100).toFixed(1)}%`, 768, y + 58, 42, ink, 220);
    text('HIT RATE', 768, y + 86, 18, muted, 220);
    text(`${section.pending} pending / ${section.pushes} push / ${section.voids} void`, 86, y + 121, 18, muted, 880, 400);
    text('3 MOST RECENT PICKS / NEWEST GAME FIRST', 86, y + 158, 16, muted);
    if (!section.recent.length) text('No published results yet.', 86, y + 225, 26, muted);
    section.recent.forEach((pick, row) => {
      const rowY = y + 183 + row * 77;
      ctx.strokeStyle = '#303d52'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(86, rowY - 10); ctx.lineTo(994, rowY - 10); ctx.stroke();
      wrapped(selection(pick), 86, rowY + 15, 700);
      const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(pick.event_start));
      text(`${pick.sport} / ${date}${pick.withdrawn ? ' / Withdrawn' : ''}`, 86, rowY + 62, 16, muted, 700, 400);
      text(labels[pick.result], 822, rowY + 28, 23, pick.result === 'win' ? '#86d9ad' : pick.result === 'loss' ? '#ff8b95' : muted, 172);
    });
  });
  text('Hit rate = Hit / (Hit + Missed). Pending, pushes and voids excluded.', 60, 1735, 19, muted);
  text('Admin-recorded outcomes / No guaranteed future results', 60, 1766, 18, muted);
  text('gamewire.us', 860, 1766, 19, ink, 160);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob)
    : reject(new Error('Your browser could not export the results PNG. Retry.')), 'image/png'));
}
