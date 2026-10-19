import { fetchNFLTeamSeasonAverages } from './sportsData.ts';
import type { NFLTeamSeasonAverages } from './sportsData.ts';

export const teamComparisonMetrics = [
  { key: 'pointsPerGame', label: 'Points / game', defense: false },
  { key: 'totalYardsPerGame', label: 'Total yards / game', defense: false },
  { key: 'passingYardsPerGame', label: 'Passing yards / game', defense: false },
  { key: 'rushingYardsPerGame', label: 'Rushing yards / game', defense: false },
  { key: 'pointsAllowedPerGame', label: 'Points allowed / game', defense: true },
  { key: 'totalYardsAllowedPerGame', label: 'Total yards allowed / game', defense: true },
  { key: 'passingYardsAllowedPerGame', label: 'Passing yards allowed / game', defense: true },
  { key: 'rushingYardsAllowedPerGame', label: 'Rushing yards allowed / game', defense: true },
] as const;
export type TeamComparisonMetric = typeof teamComparisonMetrics[number]['key'];
export type TeamComparisonRank = { rank: number; tied: boolean };
export type TeamComparisonRanks = {
  season: number;
  teams: Array<{ teamId: string; ranks: Record<TeamComparisonMetric, TeamComparisonRank | null> }>;
};

export function rankTeamAverages(teams: NFLTeamSeasonAverages[], season: number): TeamComparisonRanks {
  if (teams.length !== 32 || new Set(teams.map((team) => team.teamId)).size !== 32) {
    throw new Error('NFL rankings require all 32 teams; incomplete league data cannot be ranked.');
  }
  return {
    season,
    teams: teams.map((team) => {
      const ranks = {} as Record<TeamComparisonMetric, TeamComparisonRank | null>;
      for (const { key, defense } of teamComparisonMetrics) {
        const values = teams.map((entry) => entry[key]);
        const value = team[key];
        ranks[key] = value === null || !values.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
          ? null : {
            rank: 1 + values.filter((entry) => entry !== null && (defense ? entry < value : entry > value)).length,
            tied: values.filter((entry) => entry === value).length > 1,
          };
      }
      return { teamId: team.teamId, ranks };
    }),
  };
}

const cache = new Map<string, { expires: number; request: Promise<TeamComparisonRanks> }>();

export function fetchTeamComparisonRanks(feedPath: string, season: number): Promise<TeamComparisonRanks> {
  const key = `${feedPath}:${season}`;
  const previous = cache.get(key);
  if (previous && previous.expires > Date.now()) return previous.request;
  const request = (async () => {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${feedPath}/teams?limit=32`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`NFL ranking team list returned HTTP ${response.status}`);
    const data = await response.json();
    const entries: unknown = data?.sports?.[0]?.leagues?.[0]?.teams;
    if (!Array.isArray(entries) || !entries.every((entry) => entry && typeof entry.team?.id === 'string')) {
      throw new Error('NFL ranking team list is invalid.');
    }
    const ids = entries.map((entry) => String(entry.team.id));
    if (ids.length !== 32 || new Set(ids).size !== 32) throw new Error('NFL ranking team list must contain all 32 teams.');
    const teams: NFLTeamSeasonAverages[] = [];
    for (let offset = 0; offset < ids.length; offset += 4) {
      teams.push(...await Promise.all(ids.slice(offset, offset + 4).map((id) =>
        fetchNFLTeamSeasonAverages(feedPath, id, season, AbortSignal.timeout(15_000)))));
    }
    return rankTeamAverages(teams, season);
  })();
  const entry = { request, expires: Number.POSITIVE_INFINITY };
  cache.set(key, entry);
  void request.then(() => { entry.expires = Date.now() + 10 * 60_000; }, () => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return request;
}
