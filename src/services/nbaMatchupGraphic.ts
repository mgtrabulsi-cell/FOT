import type { NBAActuals, NBAGameSimulation } from '../../supabase/functions/_shared/nbaSimulation';
import { loadGamewireGraphicAssets } from './gamewaireResultsGraphic';
import { teamMarkAbbr, teamMarkColor } from '../TeamAbbrMark';

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
export async function renderNBAMatchupGraphic(forecast: NBAGameSimulation, actuals?: NBAActuals, colors: Record<string, string | undefined> = {}): Promise<Blob> {
  const teams = nbaMatchupGraphicData(forecast, actuals);
  const logo = await loadGamewireGraphicAssets();
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('NBA graphic canvas is unavailable.');
  const white = '#edf4ff', muted = '#a8bdd5', blue = '#39bcff';
  const background = ctx.createLinearGradient(0, 0, 1080, 1350);
  background.addColorStop(0, '#11283f'); background.addColorStop(.55, '#031020'); background.addColorStop(1, '#122b43');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1080, 1350);
  const text = (value: string, x: number, y: number, size: number, width: number, color = white, heading = false) => {
    ctx.fillStyle = color;
    let fitted = size;
    do { ctx.font = `700 ${fitted}px ${heading ? 'Oswald' : '"DM Sans"'}`; if (ctx.measureText(value).width <= width || fitted <= 22) break; fitted--; } while (true);
    while (ctx.measureText(value).width > width && value.length > 1) value = value.slice(0, -2) + '\u2026';
    ctx.fillText(value, x, y);
  };
  const panel = (x: number, y: number, width: number, height: number, color: string) => {
    ctx.fillStyle = '#061629'; ctx.strokeStyle = '#344f6d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, width, height, 12); ctx.fill(); ctx.stroke();
    const shine = ctx.createLinearGradient(x, y, x + width, y);
    shine.addColorStop(0, color); shine.addColorStop(.6, '#8ba9c0'); shine.addColorStop(1, '#253b55');
    ctx.fillStyle = shine; ctx.fillRect(x + 12, y, width - 24, 4);
  };
  ctx.drawImage(logo, 30, 18, 135, 135 * logo.naturalHeight / logo.naturalWidth);
  text('GamewAIre', 335, 92, 70, 650, white, true);
  text(actuals ? 'NBA / SIMULATION RESULTS' : 'NBA / SIMULATION PREVIEW', 335, 132, 25, 690, blue, true);
  panel(30, 170, 1020, 202, blue);
  text(actuals ? 'VERIFIED FINAL' : 'PROJECTED FINAL', 405, 207, 27, 320, muted, true);
  text('VS', 518, 290, 28, 60, muted, true);
  teams.forEach((team, index) => {
    const x = index ? 560 : 50, color = teamMarkColor(colors[team.id]);
    text(teamMarkAbbr(team.abbr), x + 12, 277, 59, 200, color, true);
    text(String(team.finalScore ?? Math.round(team.score.mean)), x + 236, 294, 90, 218, white, true);
    text(team.name, x + 12, 324, 23, 446, white);
    text(actuals ? `SIM ${Math.round(team.score.mean)}` : `${Math.round(team.winProbability * 100)}% simulated win share`, x + 12, 353, 22, 440, muted);
    panel(x - 10, 394, 490, 842, color);
    text(`${team.abbr} / TOP ${team.players.length} PROJECTED PRA`, x + 8, 433, 27, 454, white, true);
    team.players.forEach((player, rank) => {
      const y = 477 + rank * 150;
      if (rank) { ctx.strokeStyle = '#29435e'; ctx.beginPath(); ctx.moveTo(x + 8, y - 28); ctx.lineTo(x + 452, y - 28); ctx.stroke(); }
      text(`${rank + 1}. ${player.name}`, x + 8, y, 30, 454, white, true);
      const stats = player.stats, n = (value: number | undefined) => value === undefined ? 'N/A' : String(Math.round(value));
      text(`SIM ${n(stats.points.mean)} PTS / ${n(stats.rebounds.mean)} REB / ${n(stats.assists.mean)} AST`, x + 8, y + 32, 23, 454, muted);
      text(`${n(stats.pra.mean)} PRA / ${n(stats.threePointers?.mean)} 3PM`, x + 8, y + 61, 25, 454, blue);
      if (actuals) {
        const actual = player.actual;
        text(actual ? `FINAL ${actual.points} PTS / ${actual.rebounds} REB / ${actual.assists} AST` : 'FINAL / No verified player line', x + 8, y + 90, 23, 454, actual ? '#bde8cc' : muted);
        if (actual) text(`${actual.points + actual.rebounds + actual.assists} PRA / ${n(actual.threePointers)} 3PM`, x + 8, y + 119, 23, 454, '#bde8cc');
      } else {
        text(`${player.position} / ${player.limited ? 'Limited sample' : `${player.games} sampled games`}`, x + 8, y + 95, 22, 454, muted);
      }
    });
    if (!team.players.length) text('No supported player projections', x + 8, 482, 24, 454, muted);
  });
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(forecast.kickoff));
  text(`${date} / Top five per team ranked by saved projected PRA`, 40, 1272, 23, 1000, white);
  text('Estimates conditional on playing / Not confirmed starters / N/A = unavailable', 40, 1305, 22, 1000, muted);
  text('GAMEWIRE / Not betting recommendations', 40, 1334, 22, 1000, muted);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('NBA matchup graphic could not be created.')), 'image/png'));
}
