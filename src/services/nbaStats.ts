import type { NBAPlayerStatKey, NBAStats } from './nbaData.ts';

export function nbaStatValue(stats: NBAStats, key: NBAPlayerStatKey): number | undefined {
  if (key !== 'pra') return stats[key];
  const { points, rebounds, assists } = stats;
  return points !== undefined && rebounds !== undefined && assists !== undefined
    && [points, rebounds, assists].every(Number.isFinite) ? points + rebounds + assists : undefined;
}
