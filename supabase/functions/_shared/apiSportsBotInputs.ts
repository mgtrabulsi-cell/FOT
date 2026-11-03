// API-Sports-backed inputs for the GamewAIre bot. Each helper returns null when
// the feed data is incomplete so callers fall back to the ESPN source unchanged.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { OpponentContext } from './gamewaire.ts';
import { teamNameKey } from './gamewaireSources.ts';

type TeamGameRow = { team_name: string; espn_team_id: string | null; points_for: number | null; points_against: number | null };

// Builds the exact scoring-defense context defensiveStandings produces from ESPN,
// computed instead from the synced API-Sports season games.
export function buildDefensiveStandings(rows: TeamGameRow[], season: number, fetchedAt: string): Map<string, OpponentContext> {
  const teams = new Map<string, { team: string; teamId?: string; games: number; pointsAllowed: number; pointsScored: number }>();
  const byTeam = new Map<string, TeamGameRow[]>();
  for (const row of rows) byTeam.set(row.team_name, [...(byTeam.get(row.team_name) ?? []), row]);
  for (const [team, games] of byTeam) {
    if (games.some((game) => typeof game.points_for !== 'number' || typeof game.points_against !== 'number')) {
      throw new Error('A synced game is missing final points; the defensive ranking cannot be computed.');
    }
    teams.set(teamNameKey(team), {
      team,
      teamId: games[0].espn_team_id ?? undefined,
      games: games.length,
      pointsAllowed: games.reduce((sum, game) => sum + (game.points_against as number), 0) / games.length,
      pointsScored: games.reduce((sum, game) => sum + (game.points_for as number), 0) / games.length,
    });
  }
  if (teams.size !== 32) throw new Error('Defensive league ranking requires all 32 teams with recorded games.');
  const entries = [...teams.entries()];
  return new Map(entries.map(([key, team]) => [key, { ...team, leagueSize: 32, season, fetchedAt,
    rank: 1 + entries.filter(([, other]) => other.pointsAllowed < team.pointsAllowed - 1e-8).length,
    tied: entries.some(([otherKey, other]) => otherKey !== key && Math.abs(other.pointsAllowed - team.pointsAllowed) < 1e-8) }]));
}

// Reads the synced season and builds the standings, or returns null (ESPN fallback)
// when the season sync is incomplete or the data cannot be verified.
export async function feedDefensiveStandings(admin: SupabaseClient, season: number, fetchedAt: string): Promise<Map<string, OpponentContext> | null> {
  try {
    const state = await admin.from('live_feed_season_state').select('finals_total,finals_synced')
      .eq('sport', 'NFL').eq('season', season).maybeSingle();
    if (state.error || !state.data || state.data.finals_total === 0 || state.data.finals_synced < state.data.finals_total) return null;
    const rows = await admin.from('live_feed_team_games').select('team_name,espn_team_id,points_for,points_against')
      .eq('sport', 'NFL').eq('season', season);
    if (rows.error || !rows.data?.length) return null;
    return buildDefensiveStandings(rows.data, season, fetchedAt);
  } catch (cause) {
    console.error('API-Sports defensive standings unavailable; using the data feed', cause);
    return null;
  }
}
