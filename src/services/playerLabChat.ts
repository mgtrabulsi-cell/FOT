import { loadBotReport, loadGameSimulation, readSavedGameSimulation } from './gamewireBot';
import type { BotFormat, BotPlayer, BotReport } from './gamewireBot';
import { loadNBAPlayerLabReport, nbaPlayerLabAnswer } from './nbaPlayerLab';
import type { NBAPlayerLabPlayer, NBAPlayerLabReport } from './nbaPlayerLab';
import { nbaStatValue } from './nbaStats';
import { fetchScoreboards } from './sportsData';
import { isHitQuestion, playerHitReport } from './playerLabResearch';
import type { HitReport } from './playerLabResearch';

export type LabPlayer = { sport: 'NFL'; player: BotPlayer } | { sport: 'NBA'; player: NBAPlayerLabPlayer; season: number };
export type LabAnswer = { text: string[]; nfl?: BotReport; nba?: NBAPlayerLabReport; hitRates?: HitReport };
export const labPlayerKey = (entry: LabPlayer) => `${entry.sport}:${entry.player.teamId}:${entry.player.id}`;
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function findLabPlayers(question: string, players: LabPlayer[]): LabPlayer[] {
  const query = ` ${normalized(question)} `;
  const nba = /\bnba\b/i.test(question), nfl = /\bnfl\b/i.test(question);
  const league = nba && !nfl ? 'NBA' : nfl && !nba ? 'NFL' : null;
  const pool = players.filter(entry => !league || entry.sport === league);
  const complete = pool.filter(entry => query.includes(` ${normalized(entry.player.name)} `));
  if (complete.length) return complete;
  const short = normalized(question).replace(/\b(nfl|nba)\b/g, '').trim();
  if (short.length >= 2 && short.split(' ').length <= 2) {
    const matches = pool.filter(entry => normalized(entry.player.name).includes(short));
    if (matches.length) return matches;
  }
  const surnames = pool.filter(entry => {
    const names = normalized(entry.player.name).split(' ').filter(token => !['jr', 'sr', 'ii', 'iii', 'iv'].includes(token));
    const surname = names.at(-1);
    return !!surname && surname.length >= 3 && query.includes(` ${surname} `);
  });
  if (surnames.length) return surnames;
  return pool.filter(entry => {
    const first = normalized(entry.player.name).split(' ')[0];
    return first.length >= 3 && query.includes(` ${first} `);
  });
}
export function labFollowup(question: string) {
  return /\b(his|him|their|them|he|they)\b/i.test(question)
    || /^(?:(?:what|how) about )?(?:pra|points|rebounds|assists|threes|3pm|passing|rushing|receiving|receptions|injury|availability|status|matchup|recent|projection|over|under)\b/i.test(question.trim())
    || /^(?:show|explain) (?:the |those )?(?:stats|projection|matchup|recent)/i.test(question.trim());
}
export function chatStatLine(question: string) {
  const value = question.replace(/\b3[\s-]*(?:pointers?|pm|pt)\b/gi, 'threes');
  const match = value.match(/\b(?:over|under|line|at least|more than|less than|hit|reach|get|score|record)\s+(\d+(?:\.\d+)?)/i)
    ?? value.match(/\b(\d+(?:\.\d+)?)\s*(?:pra|points?|pts|rebounds?|reb|assists?|ast|threes|yards?|yds|receptions?|catches)\b/i);
  if (!match) return null;
  const line = Number(match[1]);
  if (!Number.isFinite(line) || line < 0 || line > 500) throw new Error('Use a stat line between 0 and 500.');
  return line;
}
export function nbaChatAnswer(report: NBAPlayerLabReport, question: string): LabAnswer {
  const lower = question.toLowerCase(), p = report.projection;
  const metric = /\bpra\b|points\s*\+\s*rebounds\s*\+\s*assists/.test(lower) ? 'pra'
    : /\bthrees?\b|\b3[\s-]*(pointers?|pm|pt)\b/.test(lower) ? 'threePointersMade'
    : /\b(rebounds?|reb)\b/.test(lower) ? 'rebounds' : /\b(assists?|ast)\b/.test(lower) ? 'assists'
    : /\b(points?|pts)\b/.test(lower) ? 'points' : null;
  const text: string[] = [];
  if (report.game) text.push(`Today's matchup: ${report.game.away.abbr} @ ${report.game.home.abbr} (${report.game.status}).`);
  else text.push("No verified matchup found on today's Eastern-time slate.");
  const line = chatStatLine(question);
  if (line !== null) {
    if (!metric) return { text: ['Which NBA statistic should I compare? Ask about points, rebounds, assists, PRA or threes.'], nba: report };
    const answer = nbaPlayerLabAnswer(report, metric, line), label = metric === 'threePointersMade' ? 'threes made' : metric.toUpperCase();
    text.push(answer.estimate === null ? `No verified matchup estimate for ${label}.`
      : `Saved ${label} estimate: ${Math.round(answer.estimate)}. P10-P90 range: ${Math.round(answer.low!)}-${Math.round(answer.high!)}. Your line: ${line}.`);
    text.push(answer.games ? `Last ${answer.games} recorded pre-matchup appearances: ${answer.over} over / ${answer.under} under / ${answer.pushes} equal to ${line}.`
      : 'No complete recorded pre-matchup sample is available for that statistic.');
    text.push('Historical counts are not forecast probabilities. Estimates are conditional on playing, not betting recommendations.');
  } else if (/\b(injur|hurt|status|availability|playing|out)\w*\b/.test(lower)) {
    text.push(p ? `Saved availability: ${p.status}. This is a forecast snapshot, not a live injury feed.` : 'No verified saved player availability is available. I cannot confirm that this player is playing.');
  } else if (/\brecent|last\s+\d+|averages?|stats\b/.test(lower)) {
    const averages = report.profile?.averages;
    text.push(averages ? `Recorded season averages: ${(['points', 'rebounds', 'assists', 'pra', 'threePointersMade'] as const).map(key => {
      const value = nbaStatValue(averages, key);
      return `${value === undefined ? 'Unavailable' : value.toFixed(1)} ${key === 'threePointersMade' ? '3PM' : key.toUpperCase()}`;
    }).join(' / ')}.` : 'Recorded season averages could not be verified.');
    text.push('Open the recent-game details below for individual recorded stat lines.');
  } else {
    text.push(p ? `Saved matchup projection: ${Math.round(p.stats.points.mean)} points, ${Math.round(p.stats.rebounds.mean)} rebounds, ${Math.round(p.stats.assists.mean)} assists / ${Math.round(p.stats.pra.mean)} PRA / ${p.stats.threePointers ? Math.round(p.stats.threePointers.mean) : 'Unavailable'} threes.`
      : 'No supported saved matchup projection exists for this player. I will not substitute averages and call them a forecast.');
    if (p) text.push(p.matchup, `Conditional on playing / ${p.games} sampled appearances${p.limited ? ' / Limited sample' : ''}.`);
  }
  text.push(...report.issues);
  return { text, nba: report };
}
export function nflChatAnswer(report: BotReport, question: string): LabAnswer {
  const lower = question.toLowerCase(), text: string[] = [];
  if (/\b(injur|hurt|status|availability|playing|out)\w*\b/.test(lower)) text.push(report.availability);
  else if (/\brecent|last\s+\d+|averages?|stats\b/.test(lower)) {
    text.push(...report.production.map(stat => `${stat.label}: ${stat.average.toFixed(1)} recorded average / ${stat.games} games.`));
    if (!report.production.length) text.push('No verified recent production is available.');
  } else {
    text.push(report.summary, report.matchupText);
    const market = /\b(pass|passing)\b/.test(lower) ? 'player_pass_yds' : /\b(rush|rushing)\b/.test(lower) ? 'player_rush_yds'
      : /\b(receptions?|catches)\b/.test(lower) ? 'player_receptions' : /\b(receiv|receiving|rec)\b/.test(lower) ? 'player_reception_yds' : null;
    const projections = market ? report.projections.filter(row => row.market === market) : report.projections;
    const line = chatStatLine(question);
    if (line !== null && !market) text.push('Specify passing yards, rushing yards, receiving yards or receptions to compare a line.');
    else {
      for (const row of projections) text.push(`${row.label}: ${row.estimate ?? 'Unavailable'} estimated${line === null ? '' : ` / Your line: ${line}`}. ${row.explanation}`);
      if (market && !projections.length) text.push('No verified model projection is available for that statistic and player.');
      if (line !== null) text.push('Estimates are experimental, not current sportsbook prices or betting recommendations.');
    }
  }
  text.push(...report.dataIssues, ...report.warnings);
  return { text, nfl: report };
}
export async function loadLabAnswer(entry: LabPlayer, question: string, format: BotFormat, signal: AbortSignal): Promise<LabAnswer> {
  if (isHitQuestion(question)) {
    const hitRates = await playerHitReport(entry, question, signal);
    return { text: [`${hitRates.name}: ${hitRates.metric}, last ${hitRates.request.games} recorded appearances. Historical hit rates are not forecast probabilities.`], hitRates };
  }
  if (entry.sport === 'NBA') return nbaChatAnswer(await loadNBAPlayerLabReport(entry.player, entry.season, signal), question);
  return nflChatAnswer(await loadBotReport(entry.player.id, format, signal), question);
}

export async function startOpinion(answers: LabAnswer[], format: BotFormat, signal: AbortSignal): Promise<string[]> {
  const nfl = answers.flatMap(answer => answer.nfl ? [answer.nfl] : []), nba = answers.flatMap(answer => answer.nba ? [answer.nba] : []);
  if (nfl.length && nba.length) return ['NFL and NBA use different scoring systems. Compare players within one sport for a start recommendation.'];
  const ranked: { name: string; score: number; why: string }[] = [], unavailable: string[] = [];
  if (nfl.length) {
    const board = await fetchScoreboards(signal, nfl[0].week);
    for (const report of nfl) {
      const game = board.games.find(game => game.eventId === report.matchup?.eventId);
      if (!game || game.status !== 'UPCOMING' || Date.parse(game.date) <= Date.now() || !report.eligibleForGuidance) { unavailable.push(report.player.name); continue; }
      const forecast = await readSavedGameSimulation(game) ?? await loadGameSimulation(game, signal);
      const stamp = report.projections.find(row => row.simulation)?.simulation;
      const scenario = forecast.scenarios.find(row => row.id === stamp?.scenarioId)
        ?? (forecast.scenarios.length === 1 ? forecast.scenarios[0] : undefined);
      const player = [scenario?.home, scenario?.away].find(team => team?.id === report.player.teamId)?.players.find(player => player.id === report.player.id);
      if (forecast.status !== 'ready' || !forecast.forecastAt || !Number.isFinite(Date.parse(forecast.forecastAt))
        || Date.parse(forecast.forecastAt) > Date.now() || Date.parse(forecast.forecastAt) >= Date.parse(game.date)
        || stamp && (stamp.version !== forecast.version || stamp.forecastAt !== forecast.forecastAt)
        || !player || player.issue || /\b(out|inactive|injured reserve|suspended)\b/i.test(player.status)) { unavailable.push(report.player.name); continue; }
      const weights = report.player.position === 'QB'
        ? { passingYards: .04, passingTouchdowns: 4, rushingYards: .1, rushingTouchdowns: 6 }
        : report.player.position === 'RB'
          ? { rushingYards: .1, rushingTouchdowns: 6, receivingYards: .1, receivingTouchdowns: 6, receptions: format === 'ppr' ? 1 : format === 'half' ? .5 : 0 }
          : { receivingYards: .1, receivingTouchdowns: 6, receptions: format === 'ppr' ? 1 : format === 'half' ? .5 : 0 };
      let score = 0, complete = true;
      for (const [key, weight] of Object.entries(weights)) {
        const stat = player.stats[key as keyof typeof player.stats];
        if (!stat || !Number.isFinite(stat.mean)) { complete = false; break; }
        score += stat.mean * weight;
      }
      if (!complete) { unavailable.push(report.player.name); continue; }
      ranked.push({ name: report.player.name, score, why: `${report.matchupText} ${player.games} reference appearances. ${player.limited ? 'Limited evidence. ' : ''}Availability: ${player.status}. Forecast ${forecast.forecastAt}.` });
    }
  } else {
    for (const report of nba) {
      const player = report.projection;
      if (!player || !report.game || report.game.status !== 'UPCOMING' || !report.forecastAt
        || !Number.isFinite(Date.parse(report.game.date)) || Date.parse(report.game.date) <= Date.now()
        || !Number.isFinite(Date.parse(report.forecastAt)) || Date.parse(report.forecastAt) > Date.now() || Date.parse(report.forecastAt) >= Date.parse(report.game.date)
        || !Number.isFinite(player.stats.pra.mean) || /\b(out|inactive|suspended)\b/i.test(player.status)) { unavailable.push(report.player.name); continue; }
      ranked.push({ name: report.player.name, score: player.stats.pra.mean,
        why: `${player.stats.points.mean.toFixed(1)} PTS / ${player.stats.rebounds.mean.toFixed(1)} REB / ${player.stats.assists.mean.toFixed(1)} AST. ${player.matchup} Availability: ${player.status}. Forecast ${report.forecastAt}.` });
    }
  }
  signal.throwIfAborted();
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const text = [nfl.length ? `NFL ${format.toUpperCase()} projected scoring subtotal, BEFORE interception/fumble deductions; no bonuses or two-point conversions.`
    : 'NBA comparison uses projected PRA, not a configured fantasy-league scoring system.'];
  if (unavailable.length || ranked.length !== answers.length) text.push(`Cannot fairly rank every named player. Missing, locked or ineligible projections: ${unavailable.join(', ') || 'one or more players'}. No definitive start recommendation.`);
  else if (ranked.length > 1) text.push(Math.abs(ranked[0].score - ranked[1].score) < .05 ? 'GameWire opinion: the top projections are effectively tied; no clear first choice.'
    : `GameWire opinion: start ${ranked[0].name} first, based on the highest supported ${nfl.length ? 'projected scoring subtotal' : 'projected PRA'} in this comparison.`);
  text.push(...ranked.map((row, index) => `${index + 1}. ${row.name}: ${row.score.toFixed(1)} ${nfl.length ? 'projected points before turnovers' : 'projected PRA'}. ${row.why}`),
    'Conditional on playing. Experimental model opinion, not a guarantee; verify current availability and your league’s scoring.');
  return text;
}
