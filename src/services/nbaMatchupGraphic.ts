import type { NBAActuals, NBAGameSimulation } from '../../supabase/functions/_shared/nbaSimulation';
import { loadGamewireGraphicAssets } from './gamewaireResultsGraphic';
import { teamMarkAbbr } from '../TeamAbbrMark';

export function nbaMatchupGraphicData(forecast: NBAGameSimulation, actuals?: NBAActuals) {
  if (forecast.status !== 'ready' || !forecast.away || !forecast.home || !forecast.forecastAt)
    throw new Error('A ready, saved NBA forecast is required for this matchup graphic.');
  if (actuals && (actuals.home.id !== forecast.home.id || actuals.away.id !== forecast.away.id))
    throw new Error('Verified final scores do not match the saved NBA forecast.');
  return [forecast.away, forecast.home].map(team => {
    const actual = actuals ? actuals.home.id === team.id ? actuals.home : actuals.away : undefined;
    return { ...team, finalScore: actual?.score,
      players: [...team.players].filter(player => !player.excluded && Number.isFinite(player.stats.pra.mean))
        .sort((a, b) => b.stats.pra.mean - a.stats.pra.mean || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .slice(0, 5).map(player => ({ ...player, actual: actual?.players[player.id] })) };
  });
}
export async function renderNBAMatchupGraphic(forecast: NBAGameSimulation, actuals?: NBAActuals, _colors: Record<string, string | undefined> = {}): Promise<Blob> {
  const teams = nbaMatchupGraphicData(forecast, actuals);
  const [, arena] = await Promise.all([loadGamewireGraphicAssets(), new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.src = ''; reject(new Error('NBA arena artwork timed out. Reconnect and retry the graphic.')); }, 15_000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('NBA arena artwork could not load. Reconnect and retry the graphic.')); };
    image.src = `${import.meta.env.BASE_URL}simulation-recap-stadium.png`;
  })]);
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('NBA graphic canvas is unavailable.');
  const white = '#f6f7fa', muted = '#b7c5d5', blue = '#008bff', red = '#ed002e';
  ctx.drawImage(arena, 0, 0, 1080, 1350);
  ctx.fillStyle = '#01040b45'; ctx.fillRect(0, 0, 1080, 1350);
  const floor = ctx.createLinearGradient(0, 590, 0, 1350);
  floor.addColorStop(0, '#674d3390'); floor.addColorStop(.5, '#263144b0'); floor.addColorStop(1, '#020812');
  ctx.fillStyle = floor; ctx.fillRect(0, 610, 1080, 740);
  ctx.strokeStyle = '#d7c3a330'; ctx.lineWidth = 2;
  for (let x = -800; x <= 1900; x += 90) {
    ctx.beginPath(); ctx.moveTo(540 + (x - 540) * .18, 610); ctx.lineTo(x, 1350); ctx.stroke();
  }
  for (let row = 1; row < 15; row++) {
    const y = 610 + (row / 14) ** 2 * 740;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1080, y); ctx.stroke();
  }
  ctx.strokeStyle = '#b7d3ed80'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(540, 658, 165, 28, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(507, 532, 66, 42); ctx.strokeRect(531, 550, 20, 15);
  ctx.strokeStyle = '#e87239'; ctx.beginPath(); ctx.ellipse(541, 573, 20, 5, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#bed1e980'; ctx.beginPath(); ctx.moveTo(541, 579); ctx.lineTo(541, 616); ctx.stroke();
  for (const [x, color] of [[180, '#008bff50'], [900, '#ed002e50']] as const) {
    const reflection = ctx.createRadialGradient(x, 670, 0, x, 670, 310);
    reflection.addColorStop(0, color); reflection.addColorStop(1, '#00000000');
    ctx.fillStyle = reflection; ctx.fillRect(0, 610, 1080, 740);
  }
  const text = (value: string, x: number, y: number, size: number, width: number, color = white, heading = false) => {
    ctx.fillStyle = color;
    let fitted = size;
    do { ctx.font = `${heading ? 'italic ' : ''}700 ${fitted}px ${heading ? 'Oswald' : '"DM Sans"'}`; if (ctx.measureText(value).width <= width || fitted <= 20) break; fitted--; } while (true);
    while (ctx.measureText(value).width > width && value.length > 1) value = value.slice(0, -2) + '\u2026';
    ctx.fillText(value, x, y);
  };
  const plate = (x: number, y: number, width: number, height: number, color: string, slant = 30) => {
    const fill = ctx.createLinearGradient(x, y, x, y + height);
    fill.addColorStop(0, '#101925e8'); fill.addColorStop(.45, '#02050aec'); fill.addColorStop(1, '#09111de8');
    ctx.fillStyle = fill; ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(x + slant, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width - slant, y + height); ctx.lineTo(x, y + height); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
  };
  ctx.font = 'italic 700 154px "DM Sans"';
  const brandX = (1080 - ctx.measureText('GamewAIre').width) / 2;
  let brandCursor = brandX;
  for (const [part, color] of [['Gamew', white], ['AI', red], ['re', white]]) {
    ctx.fillStyle = color; ctx.fillText(part, brandCursor, 158); brandCursor += ctx.measureText(part).width;
  }
  ctx.fillStyle = red; ctx.fillRect(0, 111, Math.max(0, brandX - 18), 4); ctx.fillRect(brandCursor + 18, 111, Math.max(0, 1080 - brandCursor - 18), 4);
  text('N B A   S I M U L A T I O N', 290, 205, 36, 600, white, true);
  text(actuals ? 'VERIFIED FINAL' : 'PROJECTED FINAL', 414, 318, 26, 260, muted, true);
  plate(425, 410, 230, 88, '#acb9c9', 18);
  text(actuals ? 'FINAL' : 'SIM', 471, 471, 50, 165, white, true);
  teams.forEach((team, index) => {
    const x = index ? 554 : 24, color = index ? red : blue, scoreX = index ? 655 : 25;
    text(`${teamMarkAbbr(team.abbr)} / ${team.name}`, scoreX + 25, 351, 28, 355, white, true);
    plate(scoreX, 372, 400, 204, color, 38);
    text(String(team.finalScore ?? Math.round(team.score.mean)), scoreX + 70, 546, 176, 310, white, true);
    text(actuals ? `SIM ${Math.round(team.score.mean)}` : 'PROJECTED SCORE', scoreX + 65, 614, 27, 335, muted, true);
    ctx.fillStyle = '#010710ed'; ctx.fillRect(x, 700, 502, 560);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(x, 700, 502, 560);
    const heading = ctx.createLinearGradient(x, 700, x + 502, 752);
    heading.addColorStop(0, index ? '#8a0027' : '#004399'); heading.addColorStop(.5, index ? '#c90030' : '#0069e5'); heading.addColorStop(1, '#07101e');
    ctx.fillStyle = heading; ctx.fillRect(x, 700, 502, 52);
    text(`TOP ${team.players.length} - ${team.abbr}`, x + 120, 738, 33, 370, white, true);
    team.players.forEach((player, rank) => {
      const y = 786 + rank * 94;
      if (rank) { ctx.strokeStyle = '#60738c70'; ctx.beginPath(); ctx.moveTo(x + 12, y - 28); ctx.lineTo(x + 490, y - 28); ctx.stroke(); }
      text(String(rank + 1), x + 16, y, 32, 35, color, true);
      text(player.name, x + 56, y, 29, 428, white, true);
      const stats = player.stats, n = (value: number | undefined) => value === undefined ? 'N/A' : String(Math.round(value));
      const simulated = `${n(stats.points.mean)} PTS / ${n(stats.rebounds.mean)} REB / ${n(stats.assists.mean)} AST / ${n(stats.threePointers?.mean)} 3PM`;
      text(`${actuals ? 'SIM ' : ''}${simulated}`, x + 56, y + 27, 23, 428, muted, true);
      if (actuals) {
        const actual = player.actual;
        text(actual ? `FINAL ${actual.points} PTS / ${actual.rebounds} REB / ${actual.assists} AST / ${n(actual.threePointers)} 3PM` : 'FINAL / Player line unavailable', x + 56, y + 51, 23, 428, white, true);
        text(`PRA ${n(stats.pra.mean)} SIM / ${actual ? actual.points + actual.rebounds + actual.assists : 'N/A'} FINAL`, x + 56, y + 74, 21, 428, muted, true);
      } else {
        text(`${n(stats.pra.mean)} PRA`, x + 56, y + 56, 23, 428, white, true);
      }
    });
    if (!team.players.length) text('No supported player projections', x + 20, 797, 26, 460, muted);
  });
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(forecast.kickoff));
  ctx.fillStyle = red; ctx.fillRect(0, 1294, 118, 3); ctx.fillRect(962, 1294, 118, 3);
  text('G A M E W A I R E   N B A   S I M U L A T I O N', 150, 1304, 24, 800, white, true);
  text(`${date} / Ranked by saved projected PRA / Conditional on playing / N/A = unavailable`, 60, 1336, 21, 960, muted, true);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('NBA matchup graphic could not be created.')), 'image/png'));
}
