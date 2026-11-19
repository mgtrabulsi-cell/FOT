import { fetchNBALeague, fetchNBAPlayerProfile, fetchNBARoster } from './nbaData.ts';
import type { NBAPlayer, NBAPlayerProfile, NBAPlayerStatKey } from './nbaData.ts';
import { fetchNBAScoreboard, nbaCalendarDate } from './sportsData.ts';
import type { Game, Team } from './sportsData.ts';
import { readLastNBAStatHub, readRenderSnapshot, saveRenderSnapshot } from './renderSnapshots.ts';
import { loadNBASimulation, readSavedNBASimulation } from './nbaSimulation.ts';
import type { NBAPlayerProjection } from '../../supabase/functions/_shared/nbaSimulation.ts';
import { nbaStatValue } from './nbaStats.ts';

export type NBAPlayerLabPlayer = NBAPlayer & { team: Team };
export type NBAPlayerLabDirectory = { season: number; players: NBAPlayerLabPlayer[]; issues: string[] };
export type NBAPlayerLabReport = { player: NBAPlayerLabPlayer; season: number; profile: NBAPlayerProfile | null;
  game: Game | null; projection: NBAPlayerProjection | null; forecastAt: string | null; issues: string[] };
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
  const game = games.find(game => game.home.id === player.teamId || game.away.id === player.teamId) ?? null;
  let forecast = game ? await readSavedNBASimulation(game) : null;
  if (game) {
    try { forecast = await loadNBASimulation(game, signal); }
    catch (cause) { signal.throwIfAborted(); issues.push(`Matchup forecast: ${message(cause)}`); }
  }
  signal.throwIfAborted();
  const projection = forecast?.status === 'ready'
    ? [forecast.home, forecast.away].find(team => team?.id === player.teamId)?.players.find(row => row.id === player.id) ?? null : null;
  if (forecast && forecast.status !== 'ready') issues.push(forecast.stage);
  if (forecast) issues.push(...forecast.warnings);
  return { player, season, profile, game, projection, forecastAt: forecast?.forecastAt ?? null, issues };
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
