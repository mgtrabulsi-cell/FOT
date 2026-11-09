import { loadGamewireGraphicAssets } from './gamewaireResultsGraphic';
import { featuredSimulationMinimums, fullPlayerPerformances, isFeaturedSimulationPlayer, simulationAccuracyStats } from '../../supabase/functions/_shared/nflSimulationAccuracy';
import type { SimulationAccuracyGame, SimulationAccuracyReport } from '../../supabase/functions/_shared/nflSimulationAccuracy';
import type { SimulationStat } from '../../supabase/functions/_shared/nflSimulation';
import type { Game } from './sportsData';

export type SimulationResultsGraphicKind = 'games' | 'players' | 'performances';
export type SimulationWinnerRecord = { wins: number; losses: number; ties: number; noWinner: number };
export type SimulationResultsGraphicSnapshot = {
  kind: SimulationResultsGraphicKind; capturedAt: string; slate: string; statistic: string; minimum?: number;
  record: SimulationWinnerRecord; verified: number; pending: number; excluded: number;
  rows: Array<{ title: string; context: string; away: string; home: string; simulated: string; actual: string; difference: string }>;
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
      away: game.away.abbr, home: game.home.abbr,
      simulated: `${Math.round(game.away.projected)} - ${Math.round(game.home.projected)}${game.overtime ? ' F/OT' : ''}`,
      actual: `${game.away.actual} - ${game.home.actual}`, difference: `${game.error.toFixed(1)} average points missed`,
    }))
    : kind === 'performances' ? fullPlayerPerformances(report).slice(0, 3).map(player => ({
      title: player.name, context: `${player.position} | ${player.team} | ${player.game.away.abbr} at ${player.game.home.abbr}`,
      away: player.game.away.abbr, home: player.game.home.abbr,
      simulated: `${player.catches.projected.toFixed(1)} REC | ${player.yards.projected.toFixed(1)} YD | ${player.touchdowns.projected.toFixed(1)} TD`,
      actual: `${player.catches.actual} REC | ${player.yards.actual} YD | ${player.touchdowns.actual} TD`,
      difference: 'Receiving performance call matched',
    }))
    : report.games.flatMap(game => game.players.filter(player => player.stat === stat && isFeaturedSimulationPlayer(player))
      .map(player => ({ ...player, game })))
      .sort((a, b) => a.error - b.error || a.game.eventId.localeCompare(b.game.eventId) || a.playerId.localeCompare(b.playerId))
      .slice(0, 3).map(player => ({
        title: player.name, context: `${player.position} | ${player.team} | ${player.game.away.abbr} at ${player.game.home.abbr}`,
        away: player.game.away.abbr, home: player.game.home.abbr,
        simulated: player.projected.toFixed(1), actual: String(player.actual), difference: `${player.error.toFixed(1)} difference`,
      }));
  if (!rows.length) throw new Error(kind === 'games'
    ? 'No verified game simulations are available for this week yet.'
    : kind === 'performances' ? 'No verified players meet all three receiving-performance criteria yet.'
    : 'No player simulations meet the selected statistic’s featured minimums yet.');
  return { kind, capturedAt: new Date(now).toISOString(), slate, statistic: simulationAccuracyStats[stat],
    minimum: kind === 'players' ? featuredSimulationMinimums[stat] : undefined,
    record: simulationWinnerRecord(report.games), verified: report.games.length, pending: report.pending, excluded: report.issues.length, rows };
}

export async function renderSimulationResultsGraphic(snapshot: SimulationResultsGraphicSnapshot): Promise<Blob> {
  if (snapshot.rows.length < 1 || snapshot.rows.length > 3) throw new Error('Choose between one and three verified simulation results.');
  await loadGamewireGraphicAssets();
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the simulation results graphic.');
  ctx.scale(1080 / 768, 1350 / 960);
  const white = '#f2f6fc', muted = '#a8bfdc', red = '#ff2347', blue = '#36baff', green = '#35d48a';
  const text = (value: string, x: number, y: number, size: number, width: number,
    color: string | CanvasGradient = white, display = false, align: CanvasTextAlign = 'left', family = display ? 'Oswald' : '"DM Sans"') => {
    const font = () => `${display ? 'italic ' : ''}700 ${size}px ${family}`;
    ctx.font = font();
    while (ctx.measureText(value).width > width && size > 10) { size--; ctx.font = font(); }
    if (ctx.measureText(value).width > width) throw new Error('A simulation results label is too long to fit the Instagram graphic.');
    ctx.textAlign = align; ctx.fillStyle = color; ctx.fillText(value, x, y);
    return ctx.measureText(value).width;
  };
  const line = (points: number[][], color: string, width = 1) => {
    ctx.beginPath(); points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  const box = (x: number, y: number, width: number, height: number, radius = 12) => {
    ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
    const fill = ctx.createLinearGradient(x, y, x + width, y + height);
    fill.addColorStop(0, '#0a2038'); fill.addColorStop(.48, '#030d19'); fill.addColorStop(1, '#0b213a');
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#47799f'; ctx.lineWidth = 1; ctx.stroke();
  };
  const panel = (y: number, height: number, accent: string) => {
    ctx.save(); box(30, y, 708, height, 18); ctx.clip();
    ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 15; ctx.fillRect(30, y, 8, height);
    ctx.shadowBlur = 0; ctx.fillStyle = '#93c7ff12'; ctx.fillRect(38, y, 700, 36); ctx.restore();
  };
  const metallic = (y: number) => {
    const fill = ctx.createLinearGradient(0, y - 48, 0, y + 4);
    fill.addColorStop(0, '#fff'); fill.addColorStop(.6, '#f3f6ff'); fill.addColorStop(1, '#aabdd4');
    return fill;
  };
  const background = ctx.createLinearGradient(0, 0, 768, 960);
  background.addColorStop(0, '#00162d'); background.addColorStop(.4, '#020a15'); background.addColorStop(1, '#001a32');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 768, 960);
  for (let index = -2; index < 8; index++) {
    const x = index * 105;
    line([[x, 0], [x - 480, 480]], index % 2 ? '#0b4a7b25' : '#096caa18', 26);
    line([[x + 730, 700], [x + 470, 960]], '#0c538430', 24);
  }
  ctx.save(); ctx.shadowColor = blue; ctx.shadowBlur = 12;
  line([[0, 60], [60, 0]], '#39cfff', 2); line([[648, 960], [768, 840]], '#39cfff', 2); ctx.restore();
  const brandStart = text('Gamew', 60, 84, 54, 224, metallic(84), true, 'left', '"DM Sans"');
  const aiWidth = text('AI', 60 + brandStart, 84, 54, 76, red, true, 'left', '"DM Sans"');
  text('re', 60 + brandStart + aiWidth, 84, 54, 68, metallic(84), true, 'left', '"DM Sans"');
  line([[418, 43], [418, 86]], white, 2);
  ctx.save(); ctx.shadowColor = red; ctx.shadowBlur = 12;
  line([[445, 73], [478, 73], [487, 56], [493, 91], [499, 36], [506, 84], [513, 65], [519, 73], [754, 73]], red, 2); ctx.restore();
  ctx.letterSpacing = '4px';
  text(snapshot.kind === 'performances' ? `${snapshot.rows.length} FULL PLAYER PERFORMANCES`
    : `TOP ${snapshot.rows.length} ${snapshot.kind === 'games' ? 'GAME SIMULATIONS' : 'PLAYER SIMULATIONS'}`, 60, 126, 25, 678, muted, true);
  ctx.letterSpacing = '0px';
  text(snapshot.slate, 60, 153, 17, 678, muted);
  panel(178, 94, '#06caff');
  ctx.fillStyle = blue; ctx.beginPath(); ctx.moveTo(71, 204); ctx.lineTo(96, 204); ctx.lineTo(92, 225); ctx.lineTo(84, 236); ctx.lineTo(75, 225); ctx.closePath(); ctx.fill();
  line([[71, 211], [62, 211], [65, 224], [76, 231]], blue, 4);
  line([[96, 211], [107, 211], [103, 224], [92, 231]], blue, 4);
  ctx.fillRect(80, 232, 8, 13); ctx.fillRect(72, 245, 24, 6);
  line([[142, 195], [142, 255]], '#7cbce0', 1);
  line([[571, 195], [571, 255]], '#7cbce0', 1);
  text('SELECTED-WEEK WINNER RECORD', 174, 208, 17, 385, blue);
  const record = snapshot.record;
  text(`${record.wins}W - ${record.losses}L - ${record.ties}T`, 174, 255, 48, 385, metallic(255), true);
  text(`${snapshot.verified} VERIFIED`, 650, 223, 17, 138, muted, true, 'center');
  text('GAMES', 650, 242, 17, 138, muted, true, 'center');
  snapshot.rows.forEach((row, index) => {
    const y = 300 + index * 178;
    panel(y, 160, green);
    box(44, y, 68, 44, 10);
    text(`#${index + 1}`, 62, y + 34, 30, 48, blue, true);
    text(row.title, 138, y + 34, 30, 580, metallic(y + 34), true);
    text(row.context, 138, y + 58, 16, 390, muted);
    box(546, y + 56, 182, 77, 9);
    text('ACTUAL', 637, y + 80, 15, 162, muted, false, 'center');
    const teamScores = (scores: string) => `${row.away} ${scores.replace(' - ', ` - ${row.home} `)}`;
    if (snapshot.kind === 'performances') {
      row.actual.split(' | ').forEach((value, index) => text(value, 637, y + 96 + index * 16, 16, 162, white, false, 'center'));
    } else {
      text(snapshot.kind === 'games' ? teamScores(row.actual) : row.actual,
        637, y + 116, 34, 162, metallic(y + 116), true, 'center');
    }
    const labelX = snapshot.kind === 'players' ? 300 : 76;
    const labelY = y + (snapshot.kind === 'players' ? 92 : 85);
    const wordWidth = text('Gamew', labelX, labelY, 17, 100, white, true, 'left', '"DM Sans"');
    const aiWidth = text('AI', labelX + wordWidth, labelY, 17, 40, red, true, 'left', '"DM Sans"');
    text('re Sim', labelX + wordWidth + aiWidth, labelY, 17, 100, white, true, 'left', '"DM Sans"');
    if (snapshot.kind === 'games') {
      text(teamScores(row.simulated), 76, y + 118, 32, 440, metallic(y + 118), true);
    } else if (snapshot.kind === 'players') {
      text(snapshot.statistic.toUpperCase(), 76, y + 92, 17, 210, blue);
      text(row.simulated, 76, y + 123, 32, 440, metallic(y + 123), true);
    } else {
      text(row.simulated, 76, y + 118, 26, 440, metallic(y + 118), true);
    }
    line([[76, y + 129], [516, y + 129]], green, 3);
    ctx.beginPath(); ctx.arc(82, y + 140, 11, 0, Math.PI * 2); ctx.fillStyle = blue; ctx.fill();
    line([[76, y + 140], [80, y + 144], [88, y + 135]], '#05203a', 2);
    text(row.difference, 104, y + 146, 16, 424, muted);
  });
  line([[35, 838], [733, 838]], '#4a82aa', 1);
  line([[35, 895], [733, 895]], '#4a82aa', 1);
  for (let index = 0; index < 4; index++) { ctx.fillStyle = blue; ctx.fillRect(38 + index * 8, 878 - index * 5, 5, 9 + index * 5); }
  text(`${snapshot.pending} pending | ${snapshot.excluded} excluded`, 84, 873, 14, 165, muted);
  line([[266, 853], [266, 881]], '#71a9d0', 1);
  ctx.fillStyle = blue; ctx.beginPath(); ctx.moveTo(295, 858); ctx.lineTo(305, 854); ctx.lineTo(315, 858); ctx.lineTo(313, 870); ctx.lineTo(305, 879); ctx.lineTo(297, 870); ctx.closePath(); ctx.fill();
  line([[300, 866], [304, 870], [310, 862]], '#05203a', 2);
  text(`${record.noWinner} no winner forecast`, 330, 873, 14, 146, muted);
  line([[492, 853], [492, 881]], '#71a9d0', 1);
  box(523, 856, 20, 21, 3);
  line([[525, 862], [541, 862]], blue, 2);
  if (snapshot.kind === 'performances') {
    text('Both: 60+ YD / 5+ REC', 559, 865, 12, 171, muted);
    text('TD: sim 0.5+ / actual 1+', 559, 883, 12, 171, muted);
  } else {
    text(snapshot.kind === 'players' && snapshot.minimum !== undefined
      ? `Sim & actual >= ${snapshot.minimum}`
      : 'Verified scenarios only', 559, 873, 13, 171, muted);
  }
  const captured = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(snapshot.capturedAt));
  text(`Downloaded ${captured} ET`, 36, 923, 14, 500, muted);
  text('gamewire.us', 604, 925, 24, 130, white, true);
  line([[604, 934], [732, 934]], red, 2);
  text(snapshot.kind === 'performances' ? 'Performance match, not exact accuracy. Projected TDs are means.'
    : 'Verified results, not guarantees or bet grades.', 36, 945, 10, 550, muted);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob)
    : reject(new Error('Your browser could not export the Instagram PNG. Retry.')), 'image/png'));
}
