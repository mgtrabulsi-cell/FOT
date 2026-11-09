import { loadGamewireGraphicAssets } from './gamewaireResultsGraphic';
import { featuredSimulationMinimums, fullPlayerPerformances, isFeaturedSimulationPlayer, simulationAccuracyStats } from '../../supabase/functions/_shared/nflSimulationAccuracy';
import type { SimulationAccuracyGame, SimulationAccuracyReport, SimulationAccuracyPlayer } from '../../supabase/functions/_shared/nflSimulationAccuracy';
import type { SimulationStat } from '../../supabase/functions/_shared/nflSimulation';
import type { Game } from './sportsData';
import { projectedSimulationScore, selectedSimulationScenario } from '../../supabase/functions/_shared/nflSimulation';
import type { NFLGameSimulation } from '../../supabase/functions/_shared/nflSimulation';
import type { NFLClosingSpread } from './nflClosingSpread';

export type SimulationResultsGraphicKind = 'games' | 'players' | 'performances' | 'slate' | 'winners' | 'player-summary';
export type SimulationWinnerRecord = { wins: number; losses: number; ties: number; noWinner: number };
type SimulationSpreadGrade = 'covered' | 'missed' | 'push' | 'pending' | 'unavailable' | 'win' | 'loss' | 'tie';
export type SimulationResultsGraphicSnapshot = {
  kind: SimulationResultsGraphicKind; capturedAt: string; slate: string; statistic: string; minimum?: number;
  record: SimulationWinnerRecord; verified: number; pending: number; excluded: number;
  rows: Array<{ title: string; context: string; away: string; home: string; simulated: string; actual: string; difference: string;
    spread?: { margin: number | null; favorite: string | null; actualMargin: number | null;
      grade: SimulationSpreadGrade; awayName: string; homeName: string;
      awayColor: string; homeColor: string; projectedAway: number | null; projectedHome: number | null;
      actualAway: number | null; actualHome: number | null; closingLine: number | null; closingProvider: string | null } }>;
  sections?: Array<{ title: string; note: string; rows: SimulationResultsGraphicSnapshot['rows'] }>;
};

export type SimulationSlateForecast = { eventId: string; forecast?: NFLGameSimulation; error?: string };

export function simulationPlayerSummarySnapshot(report: SimulationAccuracyReport, games: Game[],
  now = Date.now()): SimulationResultsGraphicSnapshot {
  const groups = report.games.flatMap(game => {
    const grouped = new Map<string, SimulationAccuracyPlayer[]>();
    for (const player of game.players) {
      const key = JSON.stringify([player.playerId, player.team]);
      const rows = grouped.get(key) ?? [];
      rows.push(player); grouped.set(key, rows);
    }
    return [...grouped.values()].map(rows => ({ game, rows }));
  });
  const top = (stats: Array<keyof SimulationStat>, mode: 'yards' | 'receiving' | 'touchdowns') => groups.flatMap(group => {
    const rows = stats.flatMap(stat => group.rows.filter(row => row.stat === stat));
    if (rows.length !== stats.length || !stats.every(stat => rows.filter(row => row.stat === stat).length === 1)
      || !rows.every(row => row.name === rows[0].name && row.position === rows[0].position
        && Number.isFinite(row.projected) && Number.isFinite(row.actual) && row.projected >= 0 && row.actual >= 0)) return [];
    const projected = rows.reduce((sum, row) => sum + row.projected, 0), actual = rows.reduce((sum, row) => sum + row.actual, 0);
    if (mode === 'touchdowns' ? projected < 1 || actual < 1 : !rows.every(isFeaturedSimulationPlayer)) return [];
    const error = mode === 'receiving' ? rows.reduce((sum, row) => sum + Math.abs(row.projected - row.actual) / row.actual, 0) / rows.length
      : mode === 'touchdowns' ? Math.abs(projected - actual) : Math.abs(rows[0].projected - rows[0].actual);
    const format = (side: 'projected' | 'actual') => {
      const number = (value: number) => String(side === 'projected' ? Math.round(value) : value);
      return mode === 'receiving' ? `${number(rows[0][side])} REC | ${number(rows[1][side])} YD`
        : mode === 'touchdowns' ? `${number(side === 'projected' ? projected : actual)} TD`
        : `${number(rows[0][side])} YD`;
    };
    return [{ error, game: group.game, player: rows[0], row: {
      title: rows[0].name, context: `${rows[0].position} | ${rows[0].team} | ${group.game.away.abbr} at ${group.game.home.abbr}`,
      away: group.game.away.abbr, home: group.game.home.abbr, simulated: format('projected'), actual: format('actual'),
      difference: mode === 'receiving' ? `${(error * 100).toFixed(1)}% mean absolute percentage error`
        : `${error.toFixed(1)} ${mode === 'touchdowns' ? 'TD' : 'yard'} difference`,
    } }];
  }).sort((a, b) => a.error - b.error || a.game.eventId.localeCompare(b.game.eventId)
    || a.player.playerId.localeCompare(b.player.playerId) || a.player.team.localeCompare(b.player.team)).slice(0, 3).map(row => row.row);
  const sections = [
    { title: 'Passing yards', note: 'QB only; sim & actual 200+ YD; ranked by yard error', rows: top(['passingYards'], 'yards') },
    { title: 'Receptions + receiving yards', note: 'Both: 3+ REC / 30+ YD; ranked by mean percentage error', rows: top(['receptions', 'receivingYards'], 'receiving') },
    { title: 'Rushing yards', note: 'Sim & actual 30+ YD; ranked by yard error', rows: top(['rushingYards'], 'yards') },
    { title: 'Rushing + receiving touchdowns', note: 'Both stat lines verified; sim & actual total 1+ TD; ranked by TD error',
      rows: top(['rushingTouchdowns', 'receivingTouchdowns'], 'touchdowns') },
  ];
  const rows = sections.flatMap(section => section.rows);
  if (!rows.length) throw new Error('No verified players meet the four-section graphic minimums yet.');
  const base = simulationResultsGraphicSnapshot(report, games, 'games', 'passingYards', now);
  return { ...base, kind: 'player-summary', statistic: 'Player category leaders', rows, sections };
}

export function simulationSlateGraphicSnapshot(report: SimulationAccuracyReport, games: Game[],
  forecasts: SimulationSlateForecast[], now = Date.now(), kind: 'slate' | 'winners' = 'slate',
  closingSpreads: NFLClosingSpread[] = []): SimulationResultsGraphicSnapshot {
  if (!games.length || !Number.isFinite(now) || games.some(game => !Number.isFinite(Date.parse(game.date)))
    || new Set(games.map(game => game.eventId)).size !== games.length)
    throw new Error('Choose a valid, unique NFL slate before downloading its simulated spreads.');
  const dates = games.map(game => Date.parse(game.date)).sort((a, b) => a - b);
  const date = (value: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).format(value);
  const rows = [...games].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.eventId.localeCompare(b.eventId)).map(game => {
    const verified = report.games.find(row => row.eventId === game.eventId);
    const saved = forecasts.find(row => row.eventId === game.eventId);
    const forecast = saved?.forecast;
    if (forecast && (forecast.eventId !== game.eventId || Date.parse(forecast.kickoff) !== Date.parse(game.date)))
      throw new Error('A saved simulation does not match the selected slate.');
    const scenario = forecast ? selectedSimulationScenario(forecast) : undefined;
    const score = scenario ? projectedSimulationScore(scenario) : null;
    const published = score && !score.archiveExtension ? score : null;
    const home = verified ? Math.round(verified.home.projected) : published?.home ?? null;
    const away = verified ? Math.round(verified.away.projected) : published?.away ?? null;
    const actualHome = verified?.home.actual ?? (game.status === 'FINAL' ? game.home.score : null);
    const actualAway = verified?.away.actual ?? (game.status === 'FINAL' ? game.away.score : null);
    if ([home, away, actualHome, actualAway].some(value => value !== null && !Number.isFinite(value)))
      throw new Error('Valid published and final scores are required to grade simulated spreads.');
    const margin = home !== null && away !== null && home !== away ? Math.abs(home - away) : null;
    const closing = kind === 'slate' && actualHome !== null && actualAway !== null
      ? closingSpreads.find(row => row.eventId === game.eventId) : undefined;
    if (closing && (Date.parse(closing.kickoff) !== Date.parse(game.date) || closing.homeTeamId !== game.home.id
      || closing.awayTeamId !== game.away.id || ![closing.homeLine, closing.awayLine].every(Number.isFinite)
      || Math.abs(closing.homeLine + closing.awayLine) > 1e-9 || !closing.provider))
      throw new Error('A closing spread does not match the selected game or contains invalid lines.');
    const projectedCover = closing && margin !== null ? home! - away! + closing.homeLine : null;
    const pickHome = kind === 'winners' ? home! > away! : projectedCover !== null && projectedCover > 0;
    const favorite = margin === null || kind === 'slate' && (projectedCover === null || projectedCover === 0)
      ? null : pickHome ? game.home.abbr : game.away.abbr;
    const closingLine = closing && favorite ? pickHome ? closing.homeLine : closing.awayLine : null;
    const actualMargin = favorite && actualHome !== null && actualAway !== null
      ? (pickHome ? actualHome - actualAway : actualAway - actualHome) + (kind === 'slate' ? closingLine! : 0) : null;
    const grade: SimulationSpreadGrade = margin === null ? 'unavailable' : actualMargin === null ? 'pending'
      : kind === 'winners' ? actualMargin > 0 ? 'win' : actualMargin < 0 ? 'loss' : 'tie'
      : actualMargin > 0 ? 'covered' : actualMargin === 0 ? 'push' : 'missed';
    const finalGrade: SimulationSpreadGrade = kind === 'slate' && margin !== null && actualHome !== null && actualAway !== null && !favorite
      ? 'unavailable' : grade;
    const difference = finalGrade === 'unavailable' ? margin === null ? saved?.error ?? 'No published decisive simulation'
      : closing ? 'No ATS pick: simulation pushes closing line' : 'Closing line unavailable'
      : grade === 'pending' ? `${game.status === 'LIVE' ? 'Live' : 'Upcoming'} - not graded`
      : grade === 'win' ? 'Correct simulated winner' : grade === 'loss' ? 'Incorrect simulated winner' : grade === 'tie' ? 'Final game tied'
      : grade === 'push' ? 'Push - closing line' : grade === 'covered' ? 'Covered closing spread' : 'Did not cover closing spread';
    return { title: `${game.away.abbr} at ${game.home.abbr}`, context: difference, away: game.away.abbr, home: game.home.abbr,
      simulated: margin === null ? 'Unavailable' : `${away} - ${home}${verified?.overtime || published?.overtime ? ' F/OT' : ''}`,
      actual: actualHome === null || actualAway === null ? 'Pending' : `${actualAway} - ${actualHome}`, difference,
      spread: { margin, favorite, actualMargin, grade: finalGrade, awayName: game.away.name, homeName: game.home.name,
        awayColor: game.away.color, homeColor: game.home.color, projectedAway: margin === null ? null : away,
        projectedHome: margin === null ? null : home, actualAway, actualHome,
        closingLine, closingProvider: closing?.provider ?? null } };
  });
  const graded = rows.filter(row => row.spread.actualMargin !== null);
  return { kind, capturedAt: new Date(now).toISOString(),
    slate: dates[0] === dates[dates.length - 1] ? `${date(dates[0])} ET` : `${date(dates[0])} - ${date(dates[dates.length - 1])} ET`,
    statistic: kind === 'winners' ? 'Simulated winners' : 'Closing-line ATS picks', record: {
      wins: rows.filter(row => row.spread.grade === (kind === 'winners' ? 'win' : 'covered')).length,
      losses: rows.filter(row => row.spread.grade === (kind === 'winners' ? 'loss' : 'missed')).length,
      ties: rows.filter(row => row.spread.grade === (kind === 'winners' ? 'tie' : 'push')).length,
      noWinner: rows.filter(row => row.spread.grade === 'unavailable').length,
    }, verified: graded.length,
    pending: rows.filter(row => row.spread.grade === 'pending').length, excluded: rows.filter(row => row.spread.grade === 'unavailable').length, rows };
}

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
  kind: Exclude<SimulationResultsGraphicKind, 'slate' | 'winners' | 'player-summary'>, stat: keyof SimulationStat, now = Date.now()): SimulationResultsGraphicSnapshot {
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
  const fullSlate = snapshot.kind === 'slate' || snapshot.kind === 'winners';
  const playerSummary = snapshot.kind === 'player-summary';
  if (playerSummary && (!snapshot.sections || snapshot.sections.length !== 4
    || snapshot.sections.some(section => section.rows.length > 3)
    || snapshot.sections.reduce((sum, section) => sum + section.rows.length, 0) !== snapshot.rows.length))
    throw new Error('The player graphic requires four complete category sections with up to three results each.');
  if (snapshot.rows.length < 1 || (!fullSlate && !playerSummary && snapshot.rows.length > 3))
    throw new Error('Choose between one and three verified simulation results.');
  await loadGamewireGraphicAssets();
  const canvas = document.createElement('canvas');
  const playerRowStep = 158;
  const height = playerSummary ? 415 + snapshot.sections!.reduce((sum, section) => sum + 80 + Math.max(section.rows.length * playerRowStep, 48), 0)
    : fullSlate ? Math.max(960, 430 + snapshot.rows.length * 100) : 960;
  canvas.width = 1080; canvas.height = Math.round(height * 1080 / 768);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the simulation results graphic.');
  ctx.scale(1080 / 768, 1080 / 768);
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
  const simLabel = (x: number, y: number, color = white) => {
    const size = 14;
    const word = text('Gamew', x, y, size, 100, color, true, 'left', '"DM Sans"');
    const ai = text('AI', x + word, y, size, 40, red, true, 'left', '"DM Sans"');
    const ending = text('re', x + word + ai, y, size, 40, color, true, 'left', '"DM Sans"');
    text('Sim', x + word + ai + ending + ctx.measureText(' ').width, y, size, 60, color, true, 'left', '"DM Sans"');
  };
  const background = ctx.createLinearGradient(0, 0, 768, height);
  background.addColorStop(0, '#00162d'); background.addColorStop(.4, '#020a15'); background.addColorStop(1, '#001a32');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 768, height);
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
  text(playerSummary ? 'PLAYER RESULTS - TOP 3 PER CATEGORY' : fullSlate ? `FULL SLATE - ${snapshot.rows.length} GAMES` : snapshot.kind === 'performances' ? `${snapshot.rows.length} FULL PLAYER PERFORMANCES`
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
  text(snapshot.kind === 'winners' ? 'SIMULATED-WINNER RECORD' : snapshot.kind === 'slate' ? 'CLOSING-LINE ATS RECORD' : 'SELECTED-WEEK WINNER RECORD', 174, 208, 17, 385, blue);
  const record = snapshot.record;
  text(snapshot.kind === 'slate' ? `${record.wins}W - ${record.losses}L - ${record.ties}P`
    : `${record.wins}W - ${record.losses}L - ${record.ties}T`, 174, 255, 48, 385, metallic(255), true);
  text(`${snapshot.verified} ${fullSlate ? 'GRADED' : 'VERIFIED'}`, 650, 223, 17, 138, muted, true, 'center');
  text('GAMES', 650, 242, 17, 138, muted, true, 'center');
  if (playerSummary) {
    let cursor = 300;
    for (const section of snapshot.sections!) {
      text(`${section.title.toUpperCase()} - TOP ${section.rows.length}`, 36, cursor + 24, 23, 696, blue, true);
      text(section.note, 36, cursor + 46, 13, 696, muted);
      cursor += 60;
      if (!section.rows.length) {
        panel(cursor, 48, muted);
        text('No verified players meet this category’s minimums yet.', 60, cursor + 30, 15, 650, muted);
        cursor += 48;
      }
      section.rows.forEach((row, index) => {
        const y = cursor + index * playerRowStep;
        panel(y, 148, green);
        text(`#${index + 1} ${row.title}`, 64, y + 28, 24, 458, metallic(y + 28), true);
        text(row.context, 64, y + 49, 14, 458, muted);
        simLabel(64, y + 76);
        text(row.simulated, 64, y + 112, 28, 458, white, true);
        text(row.difference, 64, y + 136, 12, 458, muted);
        box(546, y + 12, 182, 116, 9);
        text('ACTUAL', 637, y + 38, 13, 162, muted, false, 'center');
        const actual = row.actual.split(' | ');
        actual.forEach((value, lineIndex) => text(value, 637, y + (actual.length === 1 ? 91 : 72 + lineIndex * 32),
          actual.length === 1 ? 28 : 22, 162, white, true, 'center'));
      });
      cursor += section.rows.length * playerRowStep + 20;
    }
    line([[35, cursor], [733, cursor]], '#4a82aa', 1);
    text(`${snapshot.rows.length} qualifying results | ${snapshot.pending} pending games | ${snapshot.excluded} excluded`, 36, cursor + 26, 14, 696, muted);
    text('Simulated stat displays are rounded; rankings and errors use original means.', 36, cursor + 49, 12, 696, muted);
    text('Receiving ranks average each stat’s absolute error divided by its actual value.', 36, cursor + 70, 12, 696, muted);
    text(`Downloaded ${new Date(snapshot.capturedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`, 36, cursor + 105, 11, 500, muted);
    text('gamewire.us', 604, cursor + 105, 18, 130, white, true);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob)
      : reject(new Error('Your browser could not export the player category PNG. Retry.')), 'image/png'));
  }
  if (fullSlate) {
    text('MATCHUP', 60, 289, 14, 230, muted);
    simLabel(278, 289, blue);
    text('FINAL', 455, 289, 14, 90, muted, false, 'center');
    text(snapshot.kind === 'winners' ? 'WINNER PICK' : 'CLOSING ATS PICK', 630, 289, 14, 180, muted, false, 'center');
  }
  snapshot.rows.forEach((row, index) => {
    if (fullSlate) {
      const spread = row.spread;
      if (!spread) throw new Error('A slate row is missing its simulated spread.');
      const y = 302 + index * 100;
      const accent = spread.grade === 'covered' || spread.grade === 'win' ? green
        : spread.grade === 'missed' || spread.grade === 'loss' ? red : spread.grade === 'push' || spread.grade === 'tie' ? blue : muted;
      panel(y, 88, accent);
      for (const [side, offset] of [['away', 0], ['home', 36]] as const) {
        const color = side === 'away' ? spread.awayColor : spread.homeColor;
        box(48, y + 10 + offset, 48, 28, 6);
        ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(color) ? color : '#244361';
        ctx.fillRect(48, y + 10 + offset, 4, 28);
        text(row[side], 72, y + 30 + offset, 15, 40, white, false, 'center');
        text(side === 'away' ? spread.awayName : spread.homeName, 108, y + 30 + offset, 17, 170, white);
        text(String((side === 'away' ? spread.projectedAway : spread.projectedHome) ?? '—'), 330, y + 32 + offset, 26, 80, white, true, 'center');
        text(String((side === 'away' ? spread.actualAway : spread.actualHome) ?? '—'), 455, y + 32 + offset, 26, 80, muted, true, 'center');
      }
      if (row.simulated.endsWith(' F/OT')) text('F/OT', 389, y + 50, 10, 42, blue, false, 'center');
      box(540, y + 10, 182, 68, 8);
      text(spread.margin === null ? 'UNAVAILABLE' : snapshot.kind === 'winners' ? spread.favorite!
        : spread.closingLine === null ? spread.grade === 'pending' ? 'PENDING LINE' : spread.closingProvider ? 'NO ATS PICK' : 'NO CLOSE LINE'
        : `${spread.favorite} ${spread.closingLine > 0 ? '+' : ''}${spread.closingLine}`, 631, y + 35, 26, 160, accent, true, 'center');
      text(spread.grade === 'pending' ? 'NOT GRADED' : spread.grade === 'covered' ? 'WIN' : spread.grade === 'missed' ? 'LOSS'
        : spread.grade.toUpperCase(), 631, y + 54, 13, 160, accent, false, 'center');
      text(spread.actualMargin === null ? (spread.grade === 'pending' ? row.context : spread.margin === null ? 'Archive/score unavailable'
        : snapshot.kind === 'slate' ? spread.closingProvider ? 'Projection pushes line' : 'Closing line unavailable' : 'Archive/score unavailable')
        : snapshot.kind === 'winners' ? row.difference
        : `Close: ${spread.closingProvider}`, 631, y + 71, 12, 160, muted, false, 'center');
      return;
    }
    const y = 300 + index * 178;
    panel(y, 174, green);
    box(44, y, 68, 44, 10);
    text(`#${index + 1}`, 62, y + 34, 30, 48, blue, true);
    text(row.title, 138, y + 34, 30, 580, metallic(y + 34), true);
    text(row.context, 138, y + 58, 16, 390, muted);
    box(546, y + 56, 182, 96, 9);
    text('ACTUAL', 637, y + 76, 13, 162, muted, false, 'center');
    const teamScores = (scores: string) => `${row.away} ${scores.replace(' - ', ` - ${row.home} `)}`;
    if (snapshot.kind === 'performances') {
      row.actual.split(' | ').forEach((value, index) => text(value, 637, y + 100 + index * 21, 16, 162, white, false, 'center'));
    } else {
      text(snapshot.kind === 'games' ? teamScores(row.actual) : row.actual,
        637, y + 120, 30, 162, metallic(y + 120), true, 'center');
    }
    simLabel(76, y + 84);
    if (snapshot.kind === 'games') {
      text(teamScores(row.simulated), 76, y + 120, 28, 440, metallic(y + 120), true);
    } else if (snapshot.kind === 'players') {
      text(snapshot.statistic.toUpperCase(), 300, y + 84, 14, 216, blue);
      text(row.simulated, 76, y + 120, 28, 440, metallic(y + 120), true);
    } else {
      text(row.simulated, 76, y + 120, 28, 440, metallic(y + 120), true);
    }
    line([[76, y + 133], [516, y + 133]], green, 3);
    ctx.beginPath(); ctx.arc(82, y + 153, 8, 0, Math.PI * 2); ctx.fillStyle = blue; ctx.fill();
    line([[78, y + 153], [81, y + 156], [86, y + 149]], '#05203a', 2);
    text(row.difference, 104, y + 158, 12, 412, muted);
  });
  if (fullSlate) {
    const footer = height - 115;
    line([[35, footer], [733, footer]], '#4a82aa', 1);
    text(snapshot.kind === 'winners' ? 'GREEN: WIN   RED: LOSS   BLUE: TIE' : 'GREEN: WIN   RED: LOSS   BLUE: PUSH', 36, footer + 26, 15, 696, white);
    text(`${snapshot.verified} graded | ${snapshot.pending} pending | ${snapshot.excluded} unavailable`, 36, footer + 48, 14, 696, muted);
    text(snapshot.kind === 'winners' ? 'Win/loss grades the predicted winner only, regardless of the winning margin.'
      : 'The published simulation selects the ATS side against the provider closing spread.', 36, footer + 69, 12, 696, muted);
    text(snapshot.kind === 'winners' ? 'Published pregame winner picks, not guarantees or betting recommendations.'
      : 'Provider closing lines only. No invented odds or betting recommendations.', 36, footer + 88, 12, 696, muted);
    text(`Downloaded ${new Date(snapshot.capturedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`, 36, footer + 105, 11, 500, muted);
    text('gamewire.us', 604, footer + 105, 18, 130, white, true);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob)
      : reject(new Error('Your browser could not export the slate PNG. Retry.')), 'image/png'));
  }
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
