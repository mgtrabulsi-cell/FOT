import { loadGamewireGraphicAssets } from './gamewaireResultsGraphic';
import { teamMarkColor } from '../TeamAbbrMark';
import type { SimulationRecapSnapshot, RecapGrade } from './nflSimulationRecap';

export async function renderSimulationRecapGraphic(snapshot: SimulationRecapSnapshot,
  colors: { away?: string; home?: string } = {}): Promise<Blob> {
  if (!snapshot.rows.length || ![snapshot.home.score, snapshot.away.score].every(value => Number.isInteger(value) && value >= 0))
    throw new Error('Verified final scores and recap rows are required before exporting.');
  const [, stadium] = await Promise.all([loadGamewireGraphicAssets(), new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.src = ''; reject(new Error('Recap stadium artwork timed out. Reconnect and retry.')); }, 15000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('Recap stadium artwork could not load. Reconnect and retry.')); };
    image.src = `${import.meta.env.BASE_URL}simulation-recap-stadium.png`;
  })]);
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the NFL sim recap.');
  const white = '#eff5fc', cyan = '#19aff4', muted = '#b7d7ed';
  const wrap = (value: string, width: number, size: number, weight = 400) => {
    ctx.font = `${weight} ${size}px "DM Sans"`;
    const lines: string[] = [];
    for (const paragraph of value.split('\n')) {
      let line = '';
      for (let word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && ctx.measureText(`${line} ${word}`).width > width) { lines.push(line); line = ''; }
        while (ctx.measureText(word).width > width) {
          let length = word.length - 1;
          while (length > 1 && ctx.measureText(word.slice(0, length)).width > width) length--;
          lines.push(word.slice(0, length)); word = word.slice(length);
        }
        line = line ? `${line} ${word}` : word;
      }
      if (line) lines.push(line);
    }
    return lines;
  };
  const rows = snapshot.rows.map(row => {
    const title = wrap(row.title, 214, 20, 700), detail = wrap(row.detail, 384, 18);
    return { ...row, title, detail, height: Math.max(42, Math.max(title.length * 24, detail.length * 22) + 16) };
  });
  const tableHeight = Math.max(212, rows.reduce((sum, row) => sum + row.height, 0));
  const tableBottom = 442 + tableHeight, analysisTop = tableBottom + 16;
  const analysis = snapshot.analysis.map(paragraph => wrap(paragraph, 680, 19));
  const analysisHeight = Math.max(202, 66 + analysis.reduce((sum, lines) => sum + lines.length * 24 + 14, 0));
  const height = Math.max(960, analysisTop + analysisHeight + 86);
  canvas.width = 1080; canvas.height = Math.ceil(height * 1080 / 768);
  ctx.scale(1080 / 768, 1080 / 768);
  ctx.drawImage(stadium, 0, 0, 768, height);
  const label = (value: string, x: number, y: number, size: number, width: number, color = white, display = false, italic = false) => {
    ctx.font = `${italic ? 'italic ' : ''}700 ${size}px ${display ? 'Oswald' : '"DM Sans"'}`;
    while (ctx.measureText(value).width > width && size > 16) {
      size--; ctx.font = `${italic ? 'italic ' : ''}700 ${size}px ${display ? 'Oswald' : '"DM Sans"'}`;
    }
    if (ctx.measureText(value).width > width) throw new Error('A recap heading is too long to fit. Shorten the saved label and retry.');
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  const center = (value: string, y: number, size: number, color = white, italic = false) => {
    ctx.save(); ctx.textAlign = 'center'; label(value, 384, y, size, 720, color, true, italic); ctx.restore();
  };
  const line = (x: number, y: number, end: number, color = cyan, width = 3) => {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(end, y); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  const panel = (x: number, y: number, width: number, panelHeight: number, radius = 16) => {
    const fill = ctx.createLinearGradient(x, y, x + width, y + panelHeight);
    fill.addColorStop(0, '#193650f5'); fill.addColorStop(.4, '#091f36f8'); fill.addColorStop(1, '#021225fa');
    ctx.beginPath(); ctx.roundRect(x, y, width, panelHeight, radius); ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = cyan; ctx.lineWidth = 2.5; ctx.stroke();
  };
  const section = (value: string, y: number) => {
    line(26, y, 742, cyan, 5);
    ctx.font = 'italic 700 31px Oswald';
    const width = Math.min(680, ctx.measureText(value).width + 44);
    panel(384 - width / 2, y - 20, width, 40, 8);
    center(value, y + 11, 31, white, true);
  };
  line(28, 41, 207, cyan, 4); line(566, 41, 740, cyan, 4);
  ctx.font = 'italic 700 52px "DM Sans"';
  const parts = ['Gamew', 'AI', 're'], widths = parts.map(part => ctx.measureText(part).width);
  let brandX = (768 - widths.reduce((sum, width) => sum + width, 0)) / 2;
  for (const [index, part] of parts.entries()) {
    ctx.fillStyle = index === 1 ? '#ff3041' : white; ctx.fillText(part, brandX, 55); brandX += widths[index];
  }
  const title = ctx.createLinearGradient(0, 68, 0, 132);
  title.addColorStop(0, '#bdeaff'); title.addColorStop(.5, '#43b9f4'); title.addColorStop(1, '#d7f0ff');
  ctx.font = 'italic 700 78px Oswald'; ctx.textAlign = 'center'; ctx.fillStyle = title;
  ctx.fillText('NFL SIM RECAP', 384, 130); ctx.textAlign = 'left';
  panel(26, 144, 716, 46, 12);
  ctx.fillStyle = cyan;
  for (let index = 0; index < 3; index++) {
    const x = 43 + index * 12;
    ctx.beginPath(); ctx.moveTo(x, 151); ctx.lineTo(x + 9, 151); ctx.lineTo(x - 5, 181); ctx.lineTo(x - 14, 181); ctx.closePath(); ctx.fill();
  }
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(new Date(snapshot.kickoff)).toUpperCase();
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(snapshot.kickoff)));
  label(`${day}${hour >= 17 ? ' NIGHT' : ''} FOOTBALL`, 110, 175, 23, 306, white, true);
  line(427, 153, 427, cyan);
  ctx.beginPath(); ctx.moveTo(427, 153); ctx.lineTo(427, 181); ctx.stroke();
  label(`${snapshot.away.abbr} vs ${snapshot.home.abbr}`, 454, 175, 23, 270, muted);
  panel(24, 198, 720, 194);
  label('FINAL', 44, 289, 27, 150, cyan, true);
  const kickoffDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(snapshot.kickoff));
  label(kickoffDate.toUpperCase(), 44, 314, 15, 150, muted);
  [snapshot.away, snapshot.home].forEach((team, index) => {
    const y = 211 + index * 65, color = teamMarkColor(index ? colors.home : colors.away);
    const fill = ctx.createLinearGradient(244, y, 300, y + 56);
    fill.addColorStop(0, color); fill.addColorStop(1, '#07182d');
    ctx.beginPath(); ctx.roundRect(244, y, 56, 56, 13); ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = cyan; ctx.lineWidth = 1; ctx.stroke();
    ctx.save(); ctx.textAlign = 'center'; label(team.abbr, 272, y + 34, 20, 48); ctx.restore();
    label(team.name, 316, y + 25, 24, 348);
    label(`${team.abbr}${team.record ? `  |  ${team.record}` : index ? '  |  HOME' : '  |  AWAY'}`, 316, y + 51, 17, 348, muted);
    ctx.save(); ctx.textAlign = 'right'; label(String(team.score), 727, y + 43, 40, 64, white, true); ctx.restore();
  });
  line(40, 345, 728, '#27749f', 1);
  label(snapshot.venue || 'NFL FINAL', 44, 376, 21, 495, muted);
  label('FINAL BOX SCORE', 574, 376, 17, 154, cyan);
  section(snapshot.mode === 'admin' ? 'BET BREAKDOWN' : 'SIMULATION HIGHLIGHTS', 423);
  panel(20, 442, 728, tableHeight);
  const marker = (grade: RecapGrade, x: number, y: number) => {
    const color = grade === 'hit' ? '#00c958' : grade === 'miss' ? '#ff343c' : '#2cb9ff';
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.beginPath();
    if (grade === 'hit') { ctx.moveTo(x - 9, y); ctx.lineTo(x - 2, y + 7); ctx.lineTo(x + 10, y - 8); }
    else if (grade === 'miss') { ctx.moveTo(x - 8, y - 8); ctx.lineTo(x + 8, y + 8); ctx.moveTo(x + 8, y - 8); ctx.lineTo(x - 8, y + 8); }
    else if (grade === 'push') { ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); }
    else { ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 3); }
    ctx.stroke();
    if (grade === 'review') { ctx.beginPath(); ctx.arc(x, y + 9, 2, 0, Math.PI * 2); ctx.fillStyle = white; ctx.fill(); }
  };
  let y = 442;
  const padding = (tableHeight - rows.reduce((sum, row) => sum + row.height, 0)) / rows.length;
  for (const row of rows) {
    const rowHeight = row.height + padding;
    marker(row.grade, 61, y + rowHeight / 2);
    row.title.forEach((value, index) => label(value, 100, y + (rowHeight - row.title.length * 24) / 2 + 20 + index * 24, 20, 214));
    ctx.font = '400 18px "DM Sans"'; ctx.fillStyle = white;
    row.detail.forEach((value, index) => ctx.fillText(value, 348, y + (rowHeight - row.detail.length * 22) / 2 + 18 + index * 22));
    ctx.beginPath(); ctx.moveTo(326, y + 9); ctx.lineTo(326, y + rowHeight - 9); ctx.strokeStyle = cyan; ctx.lineWidth = 3; ctx.stroke();
    y += rowHeight;
    if (y < tableBottom - 1) line(36, y, 732, '#32617d', 1);
  }
  panel(20, analysisTop, 728, analysisHeight);
  section('GAMEWIRE ANALYSIS', analysisTop + 22);
  y = analysisTop + 64;
  ctx.font = '400 19px "DM Sans"'; ctx.fillStyle = white;
  for (const paragraph of analysis) {
    for (const value of paragraph) { ctx.fillText(value, 44, y); y += 24; }
    y += 14;
  }
  line(24, height - 50, 119, cyan, 4); line(649, height - 50, 744, cyan, 4);
  center('THE GAME. THE NUMBERS. THE RECAP.', height - 40, 29, '#68cfff', true);
  const captured = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(snapshot.capturedAt));
  center(`gamewire.us | ${captured} ET | Review states are not wins`, height - 13, 14, muted);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob)
    : reject(new Error('Your browser could not export the NFL sim recap PNG. Retry.')), 'image/png'));
}
