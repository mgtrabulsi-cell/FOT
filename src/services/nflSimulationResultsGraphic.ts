import { loadGamewireGraphicAssets } from './gamewaireResultsGraphic';
import { featuredSimulationMinimums, isFeaturedSimulationPlayer, simulationAccuracyStats } from '../../supabase/functions/_shared/nflSimulationAccuracy';
import type { SimulationAccuracyGame, SimulationAccuracyReport } from '../../supabase/functions/_shared/nflSimulationAccuracy';
import type { SimulationStat } from '../../supabase/functions/_shared/nflSimulation';
import type { Game } from './sportsData';

export type SimulationResultsGraphicKind = 'games' | 'players';
export type SimulationWinnerRecord = { wins: number; losses: number; ties: number; noWinner: number };
export type SimulationResultsGraphicSnapshot = {
  kind: SimulationResultsGraphicKind; capturedAt: string; slate: string; statistic: string; minimum?: number;
  record: SimulationWinnerRecord; verified: number; pending: number; excluded: number;
  rows: Array<{ title: string; context: string; simulated: string; actual: string; difference: string }>;
};

export function simulationWinnerRecord(games: SimulationAccuracyGame[]): SimulationWinnerRecord {
  const record = { wins: 0, losses: 0, ties: 0, noWinner: 0 };
  for (const game of games) {
    const scores = [game.home.projected, game.away.projected, game.home.actual, game.away.actual];
    if (!scores.every(Number.isFinite)) throw new Error('Verified scores are required to calculate the simulation winner record.');
    const predicted = Math.sign(Math.round(game.home.projected) - Math.round(game.away.projected));
    const actual = Math.sign(game.home.actual - game.away.actual);
    if (!predicted) record.noWinner++;
    else if (!actual) record.ties++;
    else if (predicted === actual) record.wins++;
    else record.losses++;
  }
  return record;
}

export function simulationResultsGraphicSnapshot(report: SimulationAccuracyReport, games: Game[],
  kind: SimulationResultsGraphicKind, stat: keyof SimulationStat, now = Date.now()): SimulationResultsGraphicSnapshot {
  if (!games.length || !Number.isFinite(now) || games.some(game => !Number.isFinite(Date.parse(game.date))))
    throw new Error('Choose a valid NFL slate before downloading simulation results.');
  const dates = games.map(game => Date.parse(game.date)).sort((a, b) => a - b);
  const date = (value: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).format(value);
  const slate = dates[0] === dates[dates.length - 1] ? `${date(dates[0])} ET` : `${date(dates[0])} - ${date(dates[dates.length - 1])} ET`;
  const rows = kind === 'games'
    ? [...report.games].sort((a, b) => a.error - b.error || a.eventId.localeCompare(b.eventId)).slice(0, 3).map(game => ({
      title: `${game.away.abbr} at ${game.home.abbr}`, context: `${game.away.name} / ${game.home.name}`,
      simulated: `${Math.round(game.away.projected)} - ${Math.round(game.home.projected)}`,
      actual: `${game.away.actual} - ${game.home.actual}`, difference: `${game.error.toFixed(1)} average points missed`,
    }))
    : report.games.flatMap(game => game.players.filter(player => player.stat === stat && isFeaturedSimulationPlayer(player))
      .map(player => ({ ...player, game })))
      .sort((a, b) => a.error - b.error || a.game.eventId.localeCompare(b.game.eventId) || a.playerId.localeCompare(b.playerId))
      .slice(0, 3).map(player => ({
        title: player.name, context: `${player.position} | ${player.team} | ${player.game.away.abbr} at ${player.game.home.abbr}`,
        simulated: player.projected.toFixed(1), actual: String(player.actual), difference: `${player.error.toFixed(1)} difference`,
      }));
  if (!rows.length) throw new Error(kind === 'games'
    ? 'No verified game simulations are available for this week yet.'
    : 'No player simulations meet the selected statistic’s featured minimums yet.');
  return { kind, capturedAt: new Date(now).toISOString(), slate, statistic: simulationAccuracyStats[stat],
    minimum: kind === 'players' ? featuredSimulationMinimums[stat] : undefined,
    record: simulationWinnerRecord(report.games), verified: report.games.length, pending: report.pending, excluded: report.issues.length, rows };
}

export async function renderSimulationResultsGraphic(snapshot: SimulationResultsGraphicSnapshot): Promise<Blob> {
  if (snapshot.rows.length < 1 || snapshot.rows.length > 3) throw new Error('Choose between one and three verified simulation results.');
  const logo = await loadGamewireGraphicAssets();
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the simulation results graphic.');
  const white = '#f2f6fc', muted = '#b7c8db', red = '#ff354c', blue = '#8ce2ff';
  const text = (value: string, x: number, y: number, size: number, width: number, color = white, display = false) => {
    const font = () => `700 ${size}px ${display ? 'Oswald' : '"DM Sans"'}`;
    ctx.font = font();
    while (ctx.measureText(value).width > width && size > 16) { size--; ctx.font = font(); }
    if (ctx.measureText(value).width > width) throw new Error('A simulation results label is too long to fit the Instagram graphic.');
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  const panel = (y: number, height: number, accent: string) => {
    ctx.save(); ctx.beginPath(); ctx.roundRect(56, y, 968, height, 16);
    const fill = ctx.createLinearGradient(56, y, 1024, y + height);
    fill.addColorStop(0, '#142c47'); fill.addColorStop(1, '#081526');
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#345b7e'; ctx.lineWidth = 2; ctx.stroke();
    ctx.clip(); ctx.fillStyle = accent; ctx.fillRect(56, y, 4, height); ctx.restore();
  };
  const background = ctx.createLinearGradient(0, 0, 1080, 1350);
  background.addColorStop(0, '#09182b'); background.addColorStop(.5, '#071323'); background.addColorStop(1, '#040b16');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1080, 1350);
  const logoWidth = Math.min(244, 138 * logo.naturalWidth / logo.naturalHeight);
  ctx.drawImage(logo, 1024 - logoWidth, 30, logoWidth, logoWidth * logo.naturalHeight / logo.naturalWidth);
  ctx.fillStyle = red; ctx.fillRect(56, 40, 84, 6);
  text('GamewAIre', 56, 106, 54, 690, white, true);
  text(`TOP ${snapshot.rows.length} ${snapshot.kind === 'games' ? 'GAME SIMULATIONS' : 'PLAYER SIMULATIONS'}`, 56, 164, 36, 968, white, true);
  text(snapshot.slate, 56, 205, 22, 968, muted);
  panel(234, 132, blue);
  text('SELECTED-WEEK WINNER RECORD', 84, 273, 23, 900, blue);
  const record = snapshot.record;
  text(`${record.wins}W - ${record.losses}L - ${record.ties}T`, 84, 325, 40, 550, white, true);
  text(`${snapshot.verified} verified games`, 680, 315, 21, 312, muted);
  snapshot.rows.forEach((row, index) => {
    const y = 396 + index * 240;
    panel(y, 224, red);
    text(`#${index + 1}`, 82, y + 41, 25, 66, red, true);
    text(row.title, 150, y + 41, 34, 842, white, true);
    text(row.context, 84, y + 76, 19, 908, muted);
    text(snapshot.kind === 'players' ? snapshot.statistic.toUpperCase() : 'PUBLISHED SCORE', 84, y + 111, 21, 908, blue);
    text(`SIM ${row.simulated}`, 84, y + 163, 38, 436, white, true);
    text(`ACTUAL ${row.actual}`, 562, y + 163, 38, 430, white, true);
    text(row.difference, 84, y + 202, 22, 908, muted);
  });
  const coverage = `${snapshot.pending} pending | ${snapshot.excluded} excluded | ${record.noWinner} no winner forecast`;
  text(coverage, 56, 1163, 21, 968, muted);
  text(snapshot.kind === 'players' && snapshot.minimum !== undefined
    ? `Featured minimum: ${snapshot.minimum} in both simulation and actual result.`
    : 'Closest published scores; verified realized QB scenarios only.', 56, 1200, 20, 968, muted);
  const captured = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(snapshot.capturedAt));
  text(`Downloaded ${captured} ET`, 56, 1240, 21, 968, muted);
  text('Verified results, not guarantees or bet grades.', 56, 1292, 18, 740, muted);
  text('gamewire.us', 810, 1292, 25, 214, white, true);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob)
    : reject(new Error('Your browser could not export the Instagram PNG. Retry.')), 'image/png'));
}
