import { normalize } from '../../supabase/functions/_shared/gamewaire.ts';
import { scoreboardPicks } from '../../supabase/functions/_shared/gamewaireScoreboard.ts';
import type { ScoreboardPick } from '../../supabase/functions/_shared/gamewaireScoreboard.ts';
import type { Candidate } from '../../supabase/functions/_shared/gamewaire.ts';
import type { Game } from './sportsData.ts';

export type WireTeamPick = ScoreboardPick;
export type WireTeamPicks = Record<string, WireTeamPick>;
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
