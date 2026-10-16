import type { Game, NFLPlayerGame, NFLPlayerStatKey } from './sportsData';

export const matchupPositions = ['QB', 'RB', 'WR', 'TE'] as const;
export type MatchupPosition = typeof matchupPositions[number];
export type MatchupPick = {
  id: string;
  name: string;
  position: MatchupPosition;
  teamId: string;
  gameId: string;
  headshot: string;
};

export const matchupStats: Record<MatchupPosition, { key: NFLPlayerStatKey; defense: 'passing' | 'rushing' | 'receiving'; label: string; title: string }> = {
  QB: { key: 'passingYards', defense: 'passing', label: 'Pass yards', title: 'Quarterbacks' },
  RB: { key: 'rushingYards', defense: 'rushing', label: 'Rush yards', title: 'Running backs' },
  WR: { key: 'receivingYards', defense: 'receiving', label: 'Rec yards', title: 'Wide receivers' },
  TE: { key: 'receivingYards', defense: 'receiving', label: 'Rec yards', title: 'Tight ends' },
};

export function isMatchupPosition(value: string): value is MatchupPosition {
  return matchupPositions.some((position) => position === value);
}

export function moveMatchupPick(picks: MatchupPick[], id: string, direction: -1 | 1): MatchupPick[] {
  const index = picks.findIndex((pick) => pick.id === id);
  if (index < 0) return picks;
  const positions = picks.flatMap((pick, item) => pick.position === picks[index].position ? [item] : []);
  const target = positions[positions.indexOf(index) + direction];
  if (target === undefined) return picks;
  const next = [...picks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function lastFiveAverage(player: { recentGames: Pick<NFLPlayerGame, 'gameId' | 'date' | 'stats'>[] } | undefined, position: MatchupPosition, game: Game | undefined) {
  const recent = (player?.recentGames ?? [])
    .filter((entry) => !game || (entry.gameId !== game.eventId && Date.parse(entry.date) < Date.parse(game.date)))
    .sort((first, second) => Date.parse(second.date) - Date.parse(first.date))
    .slice(0, 5);
  const values = recent.map((entry) => entry.stats[matchupStats[position].key]);
  const available = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return {
    average: available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null,
    games: available.length,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function readPlayerAverage(payload: unknown, position: MatchupPosition, game: Game) {
  const data = object(payload);
  if (!Array.isArray(data.names) || !Array.isArray(data.seasonTypes) || !data.events) {
    throw new Error('ESPN returned an invalid player game log.');
  }
  const index = data.names.indexOf(matchupStats[position].key);
  if (index < 0) return { average: null, games: 0 };
  const events = object(data.events);
  const recentGames = data.seasonTypes.flatMap((season) => {
    const categories = object(season).categories;
    return Array.isArray(categories) ? categories.flatMap((category) => {
      const group = object(category);
      if (String(group.splitType) !== '2' || !Array.isArray(group.events)) return [];
      return group.events.flatMap((entry) => {
        const row = object(entry);
        const event = object(events[String(row.eventId)]);
        const raw = Array.isArray(row.stats) ? row.stats[index] : undefined;
        const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() && raw !== '--'
          ? Number(raw.replace(/,/g, '')) : NaN;
        return [{
          gameId: String(row.eventId), date: typeof event.gameDate === 'string' ? event.gameDate : '',
          stats: Number.isFinite(value) ? { [matchupStats[position].key]: value } : {},
        }];
      });
    }) : [];
  });
  return lastFiveAverage({ recentGames }, position, game);
}

export async function fetchPlayerAverage(pick: MatchupPick, game: Game, signal: AbortSignal) {
  const response = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${encodeURIComponent(pick.id)}/gamelog?season=${game.seasonYear}&seasontype=2`, { signal });
  if (!response.ok) throw new Error(`${pick.name}'s game log returned HTTP ${response.status}.`);
  return readPlayerAverage(await response.json(), pick.position, game);
}

export function readMatchupPicks(value: unknown): MatchupPick[] {
  if (!Array.isArray(value)) throw new Error('The published matchup board is invalid.');
  return value.map((entry) => {
    const pick = object(entry);
    if (typeof pick.id !== 'string' || typeof pick.name !== 'string' || typeof pick.position !== 'string'
      || !isMatchupPosition(pick.position) || typeof pick.teamId !== 'string'
      || typeof pick.gameId !== 'string' || typeof pick.headshot !== 'string') {
      throw new Error('The published board contains an invalid player.');
    }
    return { id: pick.id, name: pick.name, position: pick.position, teamId: pick.teamId, gameId: pick.gameId, headshot: pick.headshot };
  });
}

export function readPPRProjections(payload: unknown, season: number, week: number): Map<string, number> {
  const players = object(payload).players;
  const result = new Map<string, number>();
  if (!Array.isArray(players)) throw new Error('ESPN returned an invalid fantasy player feed.');
  for (const entry of players) {
    const player = object(object(entry).player);
    if (!Array.isArray(player.stats)) continue;
    const projection = player.stats.map(object).find((stat) => stat.seasonId === season
      && stat.scoringPeriodId === week && stat.statSourceId === 1 && stat.statSplitTypeId === 1);
    if (typeof player.id === 'number' && typeof projection?.appliedTotal === 'number' && Number.isFinite(projection.appliedTotal)) {
      result.set(String(player.id), projection.appliedTotal);
    }
  }
  return result;
}

export async function fetchPPRProjections(season: number, week: number, playerIds: readonly string[], signal: AbortSignal) {
  if (!playerIds.length) return new Map<string, number>();
  const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3`;
  const response = await fetch(`${base}?view=kona_player_info&view=mSettings&scoringPeriodId=${week}`, {
    signal,
    headers: {
      'X-Fantasy-Filter': JSON.stringify({
        players: { filterIds: { value: playerIds.map(Number) }, limit: playerIds.length, sortPercOwned: { sortPriority: 1, sortAsc: false } },
      }),
    },
  });
  if (!response.ok) throw new Error(`ESPN fantasy projections returned HTTP ${response.status}.`);
  const payload: unknown = await response.json();
  const scoring = object(object(object(payload).settings).scoringSettings).scoringItems;
  if (!Array.isArray(scoring) || !scoring.some((item) => object(item).statId === 53 && object(item).points === 1)) {
    throw new Error('ESPN PPR scoring could not be verified.');
  }
  return readPPRProjections(payload, season, week);
}
