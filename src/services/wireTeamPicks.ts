import { normalize } from '../../supabase/functions/_shared/gamewaire.ts';
import { scoreboardPicks } from '../../supabase/functions/_shared/gamewaireScoreboard.ts';
import type { ScoreboardPick } from '../../supabase/functions/_shared/gamewaireScoreboard.ts';
import type { Candidate } from '../../supabase/functions/_shared/gamewaire.ts';
import type { Game } from './sportsData.ts';

export type WireTeamPick = ScoreboardPick;
export type WireTeamPicks = Record<string, WireTeamPick>;
export type WireAnalysisCoverage = { analyzedGames: number; upcomingAnalyzedGames: number; pendingGames: number; failedGames: number; dailyTarget?: number; selectionCount?: number };
export function wireAnalysisNotice(coverage: WireAnalysisCoverage, games: Game[]) {
  if (coverage.pendingGames > 0) return `GamewAIre is analyzing ${coverage.pendingGames} queued matchups. Picks appear as analyses finish; selections are never forced.`;
  if (coverage.dailyTarget !== undefined && coverage.selectionCount !== undefined && coverage.selectionCount < coverage.dailyTarget)
    return `${coverage.selectionCount} of ${coverage.dailyTarget} daily NBA selections have verified pregame evidence. Missing winner data is not substituted.`;
  const upcoming = games.filter(game => game.status === 'UPCOMING').length;
  if (coverage.analyzedGames >= games.length || upcoming > 0 && coverage.upcomingAnalyzedGames >= upcoming || coverage.failedGames > 0) return '';
  return upcoming > 0
    ? 'GamewAIre is waiting for scheduled matchup analysis. Picks appear after verified analysis completes; selections are never forced.'
    : 'No current-model pregame picks were recorded for all games in this slate. Picks are not created retroactively after games start.';
}
const teamKey = (name: string) => normalize(name).replace(/^losangeles/, 'la');
export function matchWirePicks(games: Game[], picks: ScoreboardPick[]): WireTeamPicks {
  const result: WireTeamPicks = {};
  for (const pick of picks) {
    const game = games.find(game => game.eventId === pick.eventId);
    if (!game || !Number.isFinite(Date.parse(pick.start)) || Math.abs(Date.parse(game.date) - Date.parse(pick.start)) > 60_000
      || /postpon|cancel|suspend|delay/i.test(`${game.period ?? ''} ${game.clock ?? ''}`)) continue;
    const team = [game.away, game.home].find(team => teamKey(team.name) === teamKey(pick.team));
    if (team) result[`${game.eventId}:${team.id}`] = pick;
  }
  return result;
}
export function rankWireTeams(games: Game[], candidates: Candidate[], now = Date.now()): WireTeamPicks {
  const eventIds = new Set(games.map(game => game.eventId));
  return matchWirePicks(games, scoreboardPicks(candidates.filter(pick => eventIds.has(pick.identifiers?.espnEventId ?? '')), now));
}
