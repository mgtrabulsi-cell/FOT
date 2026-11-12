import { projectedSimulationScore, roundedSimulationBox } from '../../supabase/functions/_shared/nflSimulation';
import type { SimulationScenario, SimulationTeamResult, SimulationStat } from '../../supabase/functions/_shared/nflSimulation';
import { loadGamewireGraphicAssets } from './gamewaireResultsGraphic';
import { teamMarkAbbr, teamMarkColor } from '../TeamAbbrMark';

export function simulationGraphicTeam(team: SimulationTeamResult, finalScore?: number) {
  const box = team.totals ? roundedSimulationBox({ ...team, totals: team.totals }, finalScore) : null;
  const supported = team.players.filter(player => box && Object.keys(box.players[player.id]).length);
  const rank = (key: keyof SimulationStat, tie: keyof SimulationStat) => (a: typeof supported[number], b: typeof supported[number]) =>
    (box!.players[b.id][key] ?? -1) - (box!.players[a.id][key] ?? -1)
    || (box!.players[b.id][tie] ?? -1) - (box!.players[a.id][tie] ?? -1) || a.name.localeCompare(b.name);
  return {
    team, box,
    quarterback: supported.filter(player => player.position === 'QB' && box!.players[player.id].passingYards !== undefined)
      .sort(rank('passingAttempts', 'passingYards'))[0],
    runningBack: supported.filter(player => player.position === 'RB' && box!.players[player.id].rushingAttempts !== undefined)
      .sort(rank('rushingAttempts', 'rushingYards'))[0],
    receivers: supported.filter(player => box!.players[player.id].receptions !== undefined)
      .sort(rank('receptions', 'receivingYards')).slice(0, 2),
  };
}

export async function renderSimulationGraphic(scenario: SimulationScenario, kickoff: string,
  colors: { away?: string; home?: string } = {}, format: 'landscape' | 'instagram' = 'landscape'): Promise<Blob> {
  if (!scenario.away || !scenario.home || scenario.issue) throw new Error('Choose an available simulation before downloading.');
  const score = projectedSimulationScore(scenario);
  if (!score) throw new Error('The modeled overtime final is not available yet. No tied final or invented winner is exported.');
  const logo = await loadGamewireGraphicAssets();
  const stadium = format === 'landscape' ? await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.src = ''; reject(new Error('Stadium artwork timed out. Reconnect and retry the graphic.')); }, 15_000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('Stadium artwork could not load. Reconnect and retry the graphic.')); };
    image.src = `${import.meta.env.BASE_URL}simulation-stadium.png`;
  }) : null;
  const canvas = document.createElement('canvas');
  const portrait = format === 'instagram', height = portrait ? 2000 : 1000;
  canvas.width = portrait ? 1080 : 1600; canvas.height = portrait ? 1350 : 1000;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the simulation graphic.');
  if (portrait) ctx.scale(.675, .675);
  const white = '#f2f6fc', muted = '#b7c8db', red = '#ff354c';
  const awayColor = teamMarkColor(colors.away), homeColor = teamMarkColor(colors.home);
  let playerPanel = false;
  const text = (value: string, x: number, y: number, size: number, width: number,
    color: string | CanvasGradient = white, display = false) => {
    const font = () => `${display && !portrait && !playerPanel ? 'italic ' : ''}700 ${size}px ${display ? 'Oswald' : '"DM Sans"'}`;
    ctx.font = font();
    while (ctx.measureText(value).width > width && size > 18) {
      size--; ctx.font = font();
    }
    if (ctx.measureText(value).width > width) throw new Error('A player or scenario name is too long to fit this graphic.');
    ctx.fillStyle = playerPanel ? '#ffffff' : color; ctx.fillText(value, x, y);
  };
  const metallic = (y: number, size: number) => {
    if (portrait || playerPanel) return white;
    const gradient = ctx.createLinearGradient(0, y - size, 0, y + 4);
    gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(.45, '#f4f8ff');
    gradient.addColorStop(.53, '#a3b7ce'); gradient.addColorStop(1, '#ffffff');
    return gradient;
  };
  const path = (points: number[][]) => {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  };
  const beam = (x: number, y: number, end: number, color: string, strength = 14) => {
    if (portrait) return;
    ctx.save();
    const gradient = ctx.createLinearGradient(x, y, end, y);
    gradient.addColorStop(0, `${color}00`); gradient.addColorStop(.4, color);
    gradient.addColorStop(.5, '#eaf7ff'); gradient.addColorStop(.6, color); gradient.addColorStop(1, `${color}00`);
    ctx.strokeStyle = gradient; ctx.lineWidth = 2;
    ctx.shadowColor = color; ctx.shadowBlur = strength;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(end, y); ctx.stroke(); ctx.restore();
  };
  const panel = (x: number, y: number, width: number, height: number, accent: string) => {
    if (portrait) {
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x, y, width, height, 16);
      const fill = ctx.createLinearGradient(x, y, x + width, y + height);
      fill.addColorStop(0, '#142c47'); fill.addColorStop(1, '#081526');
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = '#345b7e'; ctx.lineWidth = 2; ctx.stroke();
      ctx.clip();
      ctx.fillStyle = accent; ctx.fillRect(x, y, 4, height);
      const gloss = ctx.createLinearGradient(0, y, 0, y + height * .42);
      gloss.addColorStop(0, '#ffffff0d'); gloss.addColorStop(1, '#ffffff00');
      ctx.fillStyle = gloss; ctx.fillRect(x, y, width, height);
      ctx.restore();
      return;
    }
    path([[x + 14, y], [x + width - 14, y], [x + width, y + 14], [x + width, y + height - 14],
      [x + width - 14, y + height], [x + 14, y + height], [x, y + height - 14], [x, y + 14]]);
    if (playerPanel) {
      ctx.fillStyle = '#091321'; ctx.fill();
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
      return;
    }
    const fill = ctx.createLinearGradient(x, y, x + width / 2, y + height);
    fill.addColorStop(0, '#1b3148'); fill.addColorStop(.24, '#0b1828'); fill.addColorStop(1, '#040a13');
    ctx.fillStyle = fill; ctx.fill();
    ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 16;
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    beam(x + 24, y, x + width - 24, accent);
    const gloss = ctx.createLinearGradient(0, y, 0, y + 44);
    gloss.addColorStop(0, '#ffffff17'); gloss.addColorStop(1, '#ffffff00');
    ctx.save(); ctx.clip(); ctx.fillStyle = gloss; ctx.fillRect(x, y, width, 44); ctx.restore();
  };
  const background = ctx.createLinearGradient(0, 0, 1600, height);
  background.addColorStop(0, portrait ? '#09182b' : '#10243a');
  background.addColorStop(.5, portrait ? '#071323' : '#030911');
  background.addColorStop(1, portrait ? '#040b16' : '#1a1021');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1600, height);
  for (let i = -4; !portrait && i < 15; i++) {
    const x = i * 160;
    path([[x, 0], [x + 44, 0], [x + 720, height], [x + 676, height]]);
    ctx.fillStyle = i % 3 === 0 ? '#4b82b312' : '#ffffff04'; ctx.fill();
  }
  (portrait ? [] : [awayColor, homeColor]).forEach((accent, i) => {
    const light = ctx.createRadialGradient(i ? 1600 : 0, 550, 0, i ? 1600 : 0, 550, 750);
    light.addColorStop(0, `${accent}35`); light.addColorStop(1, `${accent}00`);
    ctx.fillStyle = light; ctx.fillRect(0, 0, 1600, height);
    ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 20; ctx.strokeStyle = accent; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(i ? 1600 : 0, 70); ctx.lineTo(i ? 1390 : 210, 280);
    ctx.moveTo(i ? 1600 : 0, height - 180); ctx.lineTo(i ? 1370 : 230, height); ctx.stroke(); ctx.restore();
  });
  if (!portrait) {
    ctx.drawImage(stadium!, 0, 0, 1600, 1000);
    const midfield = scenario.home.abbr === 'NYG' ? 'NY' : teamMarkAbbr(scenario.home.abbr);
    ctx.save();
    // A circular turf marking appears foreshortened in the stadium perspective.
    ctx.translate(0, 310.5);
    ctx.scale(1, .55);
    const centerY = 690;
    ctx.globalAlpha = .8;
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath(); ctx.ellipse(800, centerY, 65, 65, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#e9eee4'; ctx.lineWidth = 3; ctx.stroke();
    ctx.font = '700 48px Oswald'; ctx.fillStyle = scenario.home.abbr === 'NYG' ? '#145cff' : homeColor;
    ctx.fillText(midfield, 800 - ctx.measureText(midfield).width / 2, centerY + 17);
    ctx.clip();
    ctx.globalAlpha = .18;
    ctx.strokeStyle = '#245745'; ctx.lineWidth = 1;
    for (let blade = 0; blade < 70; blade++) {
      const x = 735 + blade * 2;
      ctx.beginPath(); ctx.moveTo(x, centerY - 65); ctx.lineTo(x + 5, centerY + 65); ctx.stroke();
    }
    ctx.restore();
    beam(0, 925, 550, red, 22); beam(1050, 925, 1600, '#29aaff', 22);
  }
  ctx.drawImage(logo, 25, 2, 175, 175 * logo.naturalHeight / logo.naturalWidth);
  ctx.font = `${portrait ? '' : 'italic '}700 72px Oswald`;
  const brandX = (1600 - ctx.measureText('GamewAIre').width) / 2;
  text('Gamew', brandX, 82, 72, 300, metallic(82, 72), true);
  const aiX = brandX + ctx.measureText('Gamew').width;
  text('AI', aiX, 82, 72, 110, portrait ? '#39bcff' : red, true);
  text('re', aiX + ctx.measureText('AI').width, 82, 72, 120, metallic(82, 72), true);
  ctx.font = '700 20px "DM Sans"';
  const subtitle = 'S I M U L A T I O N   P R E V I E W';
  text(subtitle, (1600 - ctx.measureText(subtitle).width) / 2, 123, 20, 600, muted);
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(kickoff));
  panel(40, 171, 1520, 145, awayColor);
  ctx.font = `${portrait ? '' : 'italic '}700 23px Oswald`;
  const finalLabel = score.overtime ? 'PROJECTED F/OT' : 'PROJECTED FINAL';
  text(finalLabel, (1600 - ctx.measureText(finalLabel).width) / 2, 204, 23, 320, muted, true);
  text(String(score.away), 575, 285, 96, 180, metallic(285, 96), true);
  text('VS', 780, 266, 28, 60, muted, true);
  text(String(score.home), 900, 285, 96, 180, metallic(285, 96), true);
  beam(800, 316, 1545, homeColor);
  [scenario.away, scenario.home].forEach((team, index) => {
    const x = index ? 830 : 40, accent = index ? homeColor : awayColor;
    const model = simulationGraphicTeam(team, index ? score.home : score.away);
    const teamX = portrait ? index ? 1045 : 465 : index ? 1120 : 70;
    const badgeY = portrait ? 215 : 188;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(teamX, badgeY, 78, 78, 16);
    ctx.fillStyle = '#081526'; ctx.fill();
    const badge = ctx.createLinearGradient(teamX, badgeY, teamX + 78, badgeY + 78);
    badge.addColorStop(0, `${accent}d9`); badge.addColorStop(1, `${accent}8c`);
    ctx.fillStyle = badge; ctx.fill();
    ctx.strokeStyle = `${accent}cc`; ctx.lineWidth = 2; ctx.stroke();
    ctx.clip();
    const gloss = ctx.createLinearGradient(0, badgeY, 0, badgeY + 47);
    gloss.addColorStop(0, '#ffffff35'); gloss.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gloss; ctx.fillRect(teamX, badgeY, 78, 78);
    const label = teamMarkAbbr(team.abbr);
    ctx.font = '700 24px "DM Sans"';
    text(label, teamX + (78 - ctx.measureText(label).width) / 2, badgeY + 44, 24, 72);
    ctx.fillStyle = accent; ctx.fillRect(teamX + 24, badgeY + 57, 30, 4);
    ctx.restore();
    text(team.name, portrait ? index ? 1150 : 70 : teamX, portrait ? 266 : 298, 30,
      portrait ? 365 : 405, metallic(298, 30), true);
    ctx.save();
    if (!portrait) {
      playerPanel = true;
      const targetX = index ? 1084 : 20;
      ctx.translate(targetX - x * .68, 165);
      ctx.scale(.68, .8);
      panel(x, 295, 730, 53, accent);
      text(`${teamMarkAbbr(team.abbr)}   ${team.name}`, x + 28, 332, 30, 674, white, true);
    }
    const heading = (y: number, label: string, height: number) => {
      panel(x, y, 730, height, accent);
      if (portrait) {
        ctx.fillStyle = '#16aeff';
        for (let i = 0; i < 3; i++) {
          const left = x + 28 + i * 14;
          path([[left + 14, y + 24], [left + 21, y + 24], [left + 7, y + 48], [left, y + 48]]);
          ctx.fill();
        }
        text(label, x + 100, y + 48, 30, 600, '#dce6f2', true);
        ctx.fillStyle = '#1687c5'; ctx.fillRect(x + 25, y + 65, 680, 1);
        return;
      }
      path([[x + 14, y], [x + 320, y], [x + 293, y + 38], [x, y + 38], [x, y + 14]]);
      const tab = ctx.createLinearGradient(x, y, x + 320, y + 38);
      tab.addColorStop(0, accent); tab.addColorStop(1, '#07101c');
      ctx.fillStyle = tab; ctx.fill();
      ctx.fillStyle = '#00000055'; ctx.fill();
      text(label, x + 25, y + 28, 23, 280, white, true);
    };
    const metrics = (y: number, player: typeof model.quarterback, keys: Array<[keyof SimulationStat, string]>) => {
      keys.forEach(([key, title], i) => {
        const column = x + 28 + i * (674 / keys.length);
        const value = player ? model.box?.players[player.id][key] : undefined;
        if (i) {
          ctx.strokeStyle = '#51647a66'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(column - 14, y - 16); ctx.lineTo(column - 14, y + 50); ctx.stroke();
        }
        text(title, column, y, portrait ? keys.length > 4 ? 22 : 28 : 18, 674 / keys.length - 20, muted);
        text(value === undefined ? '\u2014' : String(value), column, y + (portrait ? 54 : 36),
          portrait ? 52 : 33, Math.min(150, 674 / keys.length - 20), metallic(y + 36, 33));
      });
    };
    const card = (y: number, label: string, player: typeof model.quarterback, keys: Array<[keyof SimulationStat, string]>) => {
      heading(y, label, portrait ? 390 : 166);
      text(player?.name ?? 'Projection unavailable', x + 28, y + (portrait ? 115 : 82), portrait ? 44 : 34, 674);
      metrics(y + (portrait ? 235 : 112), player, keys);
    };
    card(portrait ? 370 : 348, 'QUARTERBACK', model.quarterback, [['completions', 'CMP'], ['passingAttempts', 'ATT'],
      ['passingYards', 'PASS YDS'], ['passingTouchdowns', 'PASS TD'], ['rushingYards', 'RUSH YDS']]);
    card(portrait ? 800 : 536, 'TOP RUNNING BACK', model.runningBack, [['rushingAttempts', 'RUSH ATT'], ['rushingYards', 'RUSH YDS'],
      ['rushingTouchdowns', 'RUSH TD']]);
    heading(portrait ? 1230 : 724, 'TOP 2 RECEIVERS', portrait ? 550 : 173);
    [0, 1].forEach(i => {
      const player = model.receivers[i], y = portrait ? 1350 + i * 240 : 797 + i * 70;
      text(player?.name ?? 'Projection unavailable', x + 28, y, portrait ? 42 : 28, portrait ? 674 : 310);
      const keys: Array<[keyof SimulationStat, string]> = [['receptions', 'REC'], ['receivingYards', 'REC YDS'], ['receivingTouchdowns', 'REC TD']];
      keys.forEach(([key, label], column) => {
        const left = portrait ? x + 28 + column * 225 : x + 365 + column * 118;
        const value = player ? model.box?.players[player.id][key] : undefined;
        text(label, left, y + (portrait ? 62 : -16), portrait ? 28 : 15, portrait ? 210 : 110, muted);
        text(value === undefined ? '\u2014' : String(value), left, y + (portrait ? 124 : 15),
          portrait ? 52 : 30, 110, metallic(y + 15, 30));
      });
      if (!i) { ctx.fillStyle = '#536b8144'; ctx.fillRect(x + 25, y + (portrait ? 162 : 30), 680, 1); }
    });
    ctx.restore();
    playerPanel = false;
  });
  text(`QB scenario: ${scenario.label}`, 40, height - 71, portrait ? 28 : 20, 1520, muted);
  text(`${date} ET`, 40, height - 27, 19, 450, muted);
  text(score.archiveExtension ? 'Pregame-data OT extension; not the original historical forecast. Player stats regulation.'
    : scenario.overtime ? 'Empirical OT score-only; player stats regulation. Uncalibrated.'
    : 'Simulated outcomes, not guarantees. Usage-ranked; participation assumed.', 495, height - 27, 18, 850, muted);
  text('gamewire.us', 1360, height - 27, 24, 200, white, true);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob)
    : reject(new Error('Your browser could not export the PNG. Retry.')), 'image/png'));
}
