import { fetchNBALeague, fetchNBAPlayerProfile, fetchNBARoster, fetchNBATeamSeason } from './nbaData.ts';
import type { NBAPlayer, NBAPlayerProfile, NBAPlayerStatKey, NBATeamStat } from './nbaData.ts';
import { fetchNBAScoreboard, nbaCalendarDate, shiftNBACalendarDate } from './sportsData.ts';
import type { Game, Team } from './sportsData.ts';
import { readLastNBAStatHub, readRenderSnapshot, saveRenderSnapshot } from './renderSnapshots.ts';
import { loadNBASimulation, readSavedNBASimulation } from './nbaSimulation.ts';
import type { NBAPlayerProjection } from '../../supabase/functions/_shared/nbaSimulation.ts';
import { nbaStatValue } from './nbaStats.ts';

export type NBAPlayerLabPlayer = NBAPlayer & { team: Team };
export type NBAPlayerLabDirectory = { season: number; players: NBAPlayerLabPlayer[]; issues: string[] };
export type NBAPlayerLabReport = { player: NBAPlayerLabPlayer; season: number; profile: NBAPlayerProfile | null;
  game: Game | null; projection: NBAPlayerProjection | null; forecastAt: string | null; forecastVersion?: string; issues: string[]; sourceIssues?: string[];
  opponent?: { team: Team; seasonStats: NBATeamStat[]; pace?: number; defensiveRating?: number; offensiveRating?: number } };
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Data source unavailable.';
export function readNBAPlayerLabDirectory(): NBAPlayerLabDirectory | null {
  const league = readRenderSnapshot('nbaLeague', 'nba-league'), last = readLastNBAStatHub();
  const season = league?.season ?? last?.season;
  if (!season) return null;
  const teams = league?.teams ?? last?.groups.map(group => group.team) ?? [];
  const players = teams.flatMap(team => (readRenderSnapshot('nbaRoster', `roster:${team.id}:${season}`)
    ?? (last?.season === season ? last.groups.find(group => group.team.id === team.id)?.players : undefined) ?? [])
    .map(player => ({ ...player, team })));
  return { season, players, issues: [] };
}
export async function loadNBAPlayerLabDirectory(signal: AbortSignal, progress: (directory: NBAPlayerLabDirectory) => void) {
  const league = await fetchNBALeague(signal);
  signal.throwIfAborted();
  if (!league.teams.length) throw new Error('No verified NBA teams were returned. Retry player search.');
  saveRenderSnapshot('nbaLeague', 'nba-league', league);
  const groups = new Map(league.teams.map(team => [team.id, readRenderSnapshot('nbaRoster', `roster:${team.id}:${league.season}`) ?? []]));
  const issues: string[] = [];
  const snapshot = (): NBAPlayerLabDirectory => ({ season: league.season, issues: [...issues],
    players: league.teams.flatMap(team => (groups.get(team.id) ?? []).map(player => ({ ...player, team }))) });
  progress(snapshot());
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, league.teams.length) }, async () => {
    while (next < league.teams.length) {
      signal.throwIfAborted();
      const team = league.teams[next++];
      try { groups.set(team.id, await fetchNBARoster(team.id, league.season, signal)); }
      catch (cause) {
        signal.throwIfAborted();
        console.error('NBA Player Lab roster refresh failed', team.id, cause);
        issues.push(`${team.abbr}: ${message(cause)}`);
      }
      signal.throwIfAborted();
      progress(snapshot());
    }
  }));
  const result = snapshot();
  if (!result.players.length) throw new Error('No verified NBA players could load. Reconnect and retry search.');
  return result;
}
export async function loadNBAPlayerLabReport(player: NBAPlayerLabPlayer, season: number, signal: AbortSignal): Promise<NBAPlayerLabReport> {
  const day = nbaCalendarDate(), issues: string[] = [];
  const [profileResult, scheduleResult] = await Promise.allSettled([
    fetchNBAPlayerProfile(player.id, season, signal), fetchNBAScoreboard(day, signal),
  ]);
  signal.throwIfAborted();
  if (profileResult.status === 'rejected') issues.push(`Recorded stats: ${message(profileResult.reason)}`);
  if (scheduleResult.status === 'rejected') issues.push(`Matchups: ${message(scheduleResult.reason)}`);
  const profile = profileResult.status === 'fulfilled' ? profileResult.value : readRenderSnapshot('nbaProfile', `profile:${player.id}:${season}`);
  const games = scheduleResult.status === 'fulfilled' ? scheduleResult.value : readRenderSnapshot('scoreboard', `NBA:${day}`)?.games ?? [];
  const relevant = (rows: Game[]) => rows.filter(game => (game.home.id === player.teamId || game.away.id === player.teamId)
    && (game.status === 'UPCOMING' || game.status === 'LIVE')).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  let game = relevant(games)[0] ?? null;
  let nextDay = day;
  for (let offset = 0; !game && offset < 7; offset += 2) {
    const dates: string[] = [];
    for (let i = 0; i < 2 && offset + i < 7; i++) { nextDay = shiftNBACalendarDate(nextDay, 1); dates.push(nextDay); }
    const results = await Promise.allSettled(dates.map(date => fetchNBAScoreboard(date, signal)));
    signal.throwIfAborted();
    const upcoming: Game[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') upcoming.push(...result.value);
      else issues.push(`Upcoming schedule (${dates[index]}): ${message(result.reason)}`);
    });
    game = relevant(upcoming)[0] ?? null;
    if (results.every(result => result.status === 'rejected')) break;
  }
  const opponentTeam = game ? game.home.id === player.teamId ? game.away : game.home : null;
  let forecast = game ? await readSavedNBASimulation(game) : null;
  let seasonStats: NBATeamStat[] = [];
  if (game && opponentTeam) {
    const [model, stats] = await Promise.allSettled([
      loadNBASimulation(game, signal), fetchNBATeamSeason(opponentTeam.id, game.seasonYear ?? season, signal),
    ]);
    signal.throwIfAborted();
    if (model.status === 'fulfilled') forecast = model.value;
    else issues.push(`Matchup forecast: ${message(model.reason)}`);
    if (stats.status === 'fulfilled') seasonStats = stats.value;
    else {
      issues.push(`Opponent stats: ${message(stats.reason)}`);
      seasonStats = readRenderSnapshot('nbaTeamSeason', `season:${opponentTeam.id}:${game.seasonYear ?? season}`) ?? [];
    }
  }
  signal.throwIfAborted();
  const projection = forecast?.status === 'ready'
    ? [forecast.home, forecast.away].find(team => team?.id === player.teamId)?.players.find(row => row.id === player.id) ?? null : null;
  const sourceIssues = [...issues];
  if (forecast && forecast.status !== 'ready') issues.push(forecast.stage);
  if (forecast) issues.push(...forecast.warnings);
  const ownTeam = [forecast?.home, forecast?.away].find(team => team?.id === player.teamId);
  const opponent = [forecast?.home, forecast?.away].find(team => team?.id === opponentTeam?.id);
  return { player, season, profile, game, projection, forecastAt: forecast?.forecastAt ?? null, forecastVersion: forecast?.version, issues, sourceIssues,
    ...(opponentTeam ? { opponent: { team: opponentTeam, seasonStats, pace: ownTeam?.pace,
      defensiveRating: ownTeam?.opponentDefensiveRating, offensiveRating: opponent?.offensiveRating } } : {}) };
}

export function nbaPlayerBreakdown(report: NBAPlayerLabReport, now = Date.now()) {
  const kickoff = report.game ? Date.parse(report.game.date) : now;
  const cutoff = Math.min(now, Number.isFinite(kickoff) ? kickoff : now);
  const games = [...new Map((report.profile?.games ?? []).filter(game => Number.isFinite(Date.parse(game.date))
    && Date.parse(game.date) < cutoff && (['points', 'rebounds', 'assists', 'minutes'] as const).some(key =>
      Number.isFinite(game.stats[key]))).map(game => [game.id, game])).values()]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const recent = games.slice(0, 5);
  const metrics = [['points', 'points'], ['rebounds', 'rebounds'], ['assists', 'assists'], ['pra', 'PRA'],
    ['threePointersMade', 'made threes']] as const;
  const averages = metrics.map(([key, label]) => {
    const values = recent.flatMap(game => { const value = nbaStatValue(game.stats, key); return value === undefined || !Number.isFinite(value) ? [] : [value]; });
    return { key, label, games: values.length, value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined };
  });
  const available = averages.filter(row => row.value !== undefined);
  const recentText = recent.length && available.length
    ? `Across the last ${recent.length}${recent.length < 5 ? ' available' : ''} recorded games before this matchup, ${report.player.name} averaged ${available.map(row =>
      `${row.value!.toFixed(1)} ${row.label}${row.games < recent.length ? ` (${row.games} reported games)` : ''}`).join(', ')}.`
    : 'Recent game averages are unavailable until complete recorded stat lines load.';
  const opponent = report.opponent?.team ?? (report.game ? report.game.home.id === report.player.teamId ? report.game.away : report.game.home : null);
  const opponentText: string[] = [];
  if (opponent && report.game) {
    opponentText.push(`${report.game.status === 'LIVE' ? 'Current' : 'Next'} matchup: ${report.player.teamId === report.game.home.id ? 'home against' : 'away at'} ${opponent.name}.`);
    const stats = report.opponent?.seasonStats ?? [];
    const season = [['avgPoints', 'points'], ['avgRebounds', 'rebounds'], ['avgAssists', 'assists']].flatMap(([key, label]) => {
      const raw = stats.find(row => row.name === key)?.display;
      const value = raw?.trim() ? Number(raw.replace(/,/g, '')) : NaN;
      return Number.isFinite(value) && value >= 0 ? [`${value.toFixed(1)} ${label}`] : [];
    });
    if (season.length) opponentText.push(`${opponent.abbr} averages ${season.join(', ')} per game this season.`);
    const defense = report.opponent?.defensiveRating, pace = report.opponent?.pace;
    if (defense !== undefined && Number.isFinite(defense)) opponentText.push(`In the saved matchup sample, ${opponent.abbr} allowed ${defense.toFixed(1)} points per 100 possessions.`);
    if (pace !== undefined && Number.isFinite(pace)) opponentText.push(`The matchup model uses about ${Math.round(pace)} possessions per team.`);
    if (!season.length && defense === undefined) opponentText.push('Detailed opponent statistics are currently unavailable.');
  } else opponentText.push('The next opponent could not be verified in the next seven days.');
  return { games, recent, averages, recentText, opponentText };
}
export function nbaPlayerLabAnswer(report: NBAPlayerLabReport, metric: NBAPlayerStatKey, line: number) {
  if (!['points', 'rebounds', 'assists', 'pra', 'threePointersMade'].includes(metric)
    || !Number.isFinite(line) || line < 0 || line > 500) throw new Error('Choose a supported statistic and a line between 0 and 500.');
  const projectedKey = metric === 'threePointersMade' ? 'threePointers' : metric === 'pra' ? 'pra'
    : metric === 'points' ? 'points' : metric === 'rebounds' ? 'rebounds' : 'assists';
  const estimate = report.projection?.stats[projectedKey];
  const cutoff = report.game ? Date.parse(report.game.date) : Date.now();
  const values = (report.profile?.games ?? []).filter(game => Number.isFinite(Date.parse(game.date)) && Date.parse(game.date) < cutoff)
    .slice(0, 20).flatMap(game => { const value = nbaStatValue(game.stats, metric); return value === undefined ? [] : [value]; });
  return { estimate: estimate?.mean ?? null, low: estimate?.p10 ?? null, high: estimate?.p90 ?? null,
    games: values.length, over: values.filter(value => value > line).length, under: values.filter(value => value < line).length,
    pushes: values.filter(value => value === line).length };
}
