import { loadBotHistory, readDirectorySnapshot } from './gamewireBot';
import type { LabPlayer } from './playerLabChat';
import { fetchNBAPlayerProfile } from './nbaData';
import { nbaStatValue } from './nbaStats';
import { readRenderSnapshot, restoreStatSnapshots } from './renderSnapshots';
import { fetchTeamGameLog, fetchTeamLogDirectory } from './teamGameLogs';
import { fetchNFLHistoricalSummary } from './sportsData';
import type { Team } from './sportsData';

export type ResearchMetric = 'receivingYards' | 'rushingYards' | 'passingYards' | 'receptions'
  | 'receivingTouchdowns' | 'rushingTouchdowns' | 'passingTouchdowns'
  | 'points' | 'pointsAllowed' | 'totalPoints' | 'rebounds' | 'assists' | 'pra' | 'threePointersMade';
export type HitRequest = { metric: ResearchMetric; games: number; levels: number[]; explicitLevels: boolean; comparison: 'at least' | 'over' | 'under' | 'at most' };
export type HitReport = { name: string; metric: string; request: HitRequest; games: { id: string; date: string; value: number | undefined }[];
  rows: { level: number; hits: number; sample: number; percent: number | null }[]; issues: string[] };
const labels: Record<ResearchMetric, string> = { receivingYards: 'Receiving yards', rushingYards: 'Rushing yards', passingYards: 'Passing yards',
  receptions: 'Receptions', receivingTouchdowns: 'Receiving touchdowns', rushingTouchdowns: 'Rushing touchdowns', passingTouchdowns: 'Passing touchdowns',
  points: 'Points', pointsAllowed: 'Points allowed', totalPoints: 'Combined game points', rebounds: 'Rebounds', assists: 'Assists', pra: 'PRA', threePointersMade: 'Threes made' };
export const isHitQuestion = (question: string) => /\bhit[\s-]*(?:rates?|percentages?)\b|\bhow (?:many|often)\b|\b(?:over|under|at least|at most)\s+\d/i.test(question);
export const isStartQuestion = (question: string) => /\b(?:start|sit|bench|lineup)\b/i.test(question);
export function hitRequest(question: string): HitRequest {
  const q = question.toLowerCase();
  const games = Number(q.match(/\blast\s+(\d+)\s*(?:games?|appearances?)/)?.[1] ?? 10);
  if (!Number.isInteger(games) || games < 5 || games > 10) throw new Error('Choose a window from the last 5 to 10 games.');
  const metric: ResearchMetric | null = /\bpra\b|points\s*\+\s*rebounds/.test(q) ? 'pra'
    : /\b(?:3pm|threes?|3[\s-]*pointers?)\b/.test(q) ? 'threePointersMade'
    : /\b(?:rebounds?|reb)\b/.test(q) ? 'rebounds' : /\b(?:assists?|ast)\b/.test(q) ? 'assists'
    : /\b(?:receptions?|catches)\b/.test(q) ? 'receptions'
    : /\b(?:receiving|rec)\b/.test(q) ? /\b(?:touchdowns?|tds?)\b/.test(q) ? 'receivingTouchdowns' : 'receivingYards'
    : /\b(?:rushing|rush)\b/.test(q) ? /\b(?:touchdowns?|tds?)\b/.test(q) ? 'rushingTouchdowns' : 'rushingYards'
    : /\b(?:passing|pass)\b/.test(q) ? /\b(?:touchdowns?|tds?)\b/.test(q) ? 'passingTouchdowns' : 'passingYards'
    : /\b(?:points allowed|opponent points)\b/.test(q) ? 'pointsAllowed'
    : /\b(?:total|combined)\b/.test(q) && /\bpoints\b/.test(q) ? 'totalPoints'
    : /\b(?:points?|pts|scores?)\b/.test(q) ? 'points' : null;
  if (!metric) throw new Error('Specify receiving/rushing/passing yards, receptions, touchdowns, points, rebounds, assists, PRA or threes.');
  const stripped = q.replace(/\blast\s+\d+\s*(?:games?|appearances?)/g, '').replace(/\b(?:3pm|3[\s-]*pointers?)\b/g, 'threes')
    .replace(/\b(?:last|past)\s+\d+/g, '');
  const levels = [...new Set((stripped.match(/\b\d+(?:\.\d+)?\b/g) ?? []).map(Number))].sort((a, b) => a - b);
  if (levels.some(level => !Number.isFinite(level) || level < 0 || level > 1000)) throw new Error('Use stat thresholds between 0 and 1000.');
  const defaults = metric.endsWith('Touchdowns') ? [1, 2, 3] : metric === 'passingYards' ? [150, 200, 250, 300, 350]
    : metric.endsWith('Yards') ? [25, 50, 75, 100, 125, 150] : metric === 'threePointersMade' ? [1, 2, 3, 4, 5]
    : metric === 'receptions' || metric === 'rebounds' || metric === 'assists' ? [3, 5, 7, 10]
    : metric === 'pra' ? [20, 30, 40, 50, 60] : [10, 15, 20, 25, 30, 40];
  return { metric, games, levels: levels.length ? levels : defaults, explicitLevels: levels.length > 0,
    comparison: /\bat most\b/.test(q) ? 'at most' : /\bunder\b/.test(q) ? 'under' : /\bover\b/.test(q) ? 'over' : 'at least' };
}
export function buildHitReport(name: string, request: HitRequest, input: HitReport['games'], issues: string[] = [], cutoff = Date.now()): HitReport {
  const games = [...new Map(input.filter(game => Number.isFinite(Date.parse(game.date)) && Date.parse(game.date) < cutoff)
    .map(game => [game.id, game])).values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, request.games);
  const values = games.map(game => game.value).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const rows = request.levels.map(level => {
    const hits = values.filter(value => request.comparison === 'over' ? value > level : request.comparison === 'under' ? value < level
      : request.comparison === 'at most' ? value <= level : value >= level).length;
    return { level, hits, sample: values.length, percent: values.length ? hits / values.length * 100 : null };
  });
  return { name, metric: labels[request.metric], request, games, rows, issues: [...issues,
    ...(games.length < request.games ? [`Only ${games.length} verified appearances are available for the requested ${request.games}-game window.`] : []),
    ...(values.length < games.length ? [`${games.length - values.length} appearances have unavailable ${labels[request.metric].toLowerCase()}; they are excluded from the percentage, not filled with zeroes.`] : [])] };
}
export async function playerHitReport(entry: LabPlayer, question: string, signal: AbortSignal): Promise<HitReport> {
  const request = hitRequest(question);
  if (entry.sport === 'NBA') {
    if (!['points', 'rebounds', 'assists', 'pra', 'threePointersMade'].includes(request.metric)) throw new Error('For NBA players, choose points, rebounds, assists, PRA or threes.');
    const profile = await fetchNBAPlayerProfile(entry.player.id, entry.season, signal);
    const metric = request.metric;
    return buildHitReport(entry.player.name, request, profile.games.map(game => ({ id: game.id, date: game.date,
      value: metric === 'points' || metric === 'rebounds' || metric === 'assists' || metric === 'pra' || metric === 'threePointersMade' ? nbaStatValue(game.stats, metric) : undefined })));
  }
  const market: Partial<Record<ResearchMetric, string>> = { receivingYards: 'player_reception_yds', rushingYards: 'player_rush_yds',
    passingYards: 'player_pass_yds', receptions: 'player_receptions' };
  if (!market[request.metric] && !request.metric.endsWith('Touchdowns')) throw new Error('For NFL players, choose passing/rushing/receiving yards, receptions or a position-specific touchdown statistic.');
  await restoreStatSnapshots();
  const season = readDirectorySnapshot()?.season ?? (await fetchTeamLogDirectory('NFL', signal)).season;
  const saved = readRenderSnapshot('nflStatHubTeam', `${entry.player.teamId}:${season}`, 7 * 86400000);
  const player = saved?.players.find(player => player.id === entry.player.id);
  if (saved?.complete && player && (player.recentGames.filter(game => Object.keys(game.stats).length > 0).length >= request.games || request.metric.endsWith('Touchdowns'))) {
    const metric = request.metric;
    return buildHitReport(entry.player.name, request, player.recentGames.filter(game => Object.keys(game.stats).length > 0).map(game => ({
      id: game.gameId, date: game.date, value: metric === 'receivingYards' || metric === 'rushingYards' || metric === 'passingYards'
        || metric === 'receptions' || metric === 'receivingTouchdowns' || metric === 'rushingTouchdowns' || metric === 'passingTouchdowns' ? game.stats[metric] : undefined,
    })));
  }
  if (!market[request.metric]) throw new Error('Touchdown game logs have not downloaded yet. Open NFL Stat Hub to save this team’s verified logs, then retry.');
  const history = await loadBotHistory(entry.player.id, season, 'ppr', signal);
  signal.throwIfAborted();
  return buildHitReport(entry.player.name, request, history.weeks.filter(week => week.actuals !== null).map(week => ({
    id: week.event_id, date: week.event_start, value: week.actuals?.[market[request.metric]!] ?? undefined,
  })), history.issues);
}
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export async function teamHitReport(question: string, signal: AbortSignal): Promise<HitReport> {
  const request = hitRequest(question), leagues = /\bnba\b/i.test(question) ? ['NBA'] as const : /\bnfl\b/i.test(question) ? ['NFL'] as const : ['NFL', 'NBA'] as const;
  const matches: { league: 'NFL' | 'NBA'; season: number; team: Team }[] = [];
  for (const league of leagues) {
    const directory = await fetchTeamLogDirectory(league, signal);
    const query = ` ${normalize(question)} `;
    for (const team of directory.teams) if (query.includes(` ${normalize(team.name)} `)
      || new RegExp(`\\b${team.abbr}\\b`, 'i').test(question)
      || query.includes(` ${normalize(team.name.split(' ').at(-1)!)} `)) matches.push({ league, season: directory.season, team });
  }
  if (matches.length !== 1) throw new Error(matches.length ? 'Use the full team name and NFL or NBA to disambiguate this request.' : 'Name an NFL or NBA player or team. For teams, try “Bengals points hit rates last 10 games”.');
  const { team, league, season } = matches[0];
  if (league === 'NBA' && !request.explicitLevels && ['points', 'pointsAllowed', 'totalPoints'].includes(request.metric)) {
    request.levels = request.metric === 'totalPoints' ? [180, 200, 220, 240, 260] : [90, 100, 110, 120, 130];
  }
  if (request.metric === 'receptions' || request.metric === 'receivingYards' || request.metric.endsWith('Touchdowns') || request.metric === 'pra') throw new Error('Team hit rates support points, points allowed, combined points, NFL passing/rushing yards, and NBA rebounds, assists or threes.');
  if (league === 'NBA' && request.metric.endsWith('Yards') || league === 'NFL' && ['rebounds', 'assists', 'threePointersMade'].includes(request.metric)) throw new Error('That statistic does not apply to the selected sport.');
  const logs = (await fetchTeamGameLog(league, team.id, season, signal)).filter(row => row.seasonType !== 1)
    .sort((a, b) => Date.parse(b.game.date) - Date.parse(a.game.date)).slice(0, request.games);
  const issues: string[] = [];
  const games = await Promise.all(logs.map(async ({ game }) => {
    const own = game.home.id === team.id ? game.home : game.away, opponent = game.home.id === team.id ? game.away : game.home;
    let value: number | undefined = request.metric === 'points' ? own.score : request.metric === 'pointsAllowed' ? opponent.score
      : request.metric === 'totalPoints' ? own.score + opponent.score : undefined;
    if (value === undefined) {
      try {
        const summary: unknown = await fetchNFLHistoricalSummary(league === 'NFL' ? 'football/nfl' : 'basketball/nba', game.eventId);
        const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
        const data = object(summary), header = object(data.header);
        if (String(header.id) !== game.eventId) throw new Error('Box score belongs to a different game.');
        const teams = object(data.boxscore).teams;
        const row = Array.isArray(teams) ? teams.map(object).find(row => String(object(row.team).id) === team.id) : undefined;
        const stats = row?.statistics;
        const names: Partial<Record<ResearchMetric, string>> = { passingYards: 'netPassingYards', rushingYards: 'rushingYards', rebounds: 'totalRebounds', assists: 'assists', threePointersMade: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted' };
        const name = names[request.metric];
        const stat = Array.isArray(stats) ? stats.map(object).find(stat => stat.name === name) : undefined;
        const raw = String(stat?.displayValue ?? '').replace(/,/g, '');
        const numeric = request.metric === 'threePointersMade' ? raw.match(/^(\d+)-\d+$/)?.[1] : /^-?\d+(?:\.\d+)?$/.test(raw) ? raw : undefined;
        if (numeric !== undefined) value = Number(numeric);
      } catch (cause) {
        signal.throwIfAborted();
        console.error('Team hit-rate box score failed', game.eventId, cause);
        issues.push(`${game.eventId}: ${cause instanceof Error ? cause.message : 'Box score unavailable'}`);
      }
    }
    return { id: game.eventId, date: game.date, value };
  }));
  signal.throwIfAborted();
  return buildHitReport(`${team.name} (${league})`, request, games, issues);
}
