import type { Game, NFLBoxScoreData, NFLGameDetails, NFLPlayerSeasonBoxScore, NFLSkillPlayer, NFLTeamSeasonAverages } from './sportsData.ts';

type Snapshots = {
  scoreboard: { games: Game[]; failedLeagues: string[]; nflWeek: number | null };
  details: NFLGameDetails;
  players: { data: NFLPlayerSeasonBoxScore; players: NFLSkillPlayer[] };
  box: NFLBoxScoreData;
  team: NFLTeamSeasonAverages;
};

const prefix = `gamewire-render-v1:${import.meta.env?.BASE_URL ?? '/'}:`;
let stopped = false;

function storage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function valid<K extends keyof Snapshots>(kind: K, data: unknown): data is Snapshots[K] {
  if (!object(data)) return false;
  switch (kind) {
    case 'scoreboard':
      return Array.isArray(data.games) && data.games.every((game: unknown) =>
        object(game) && typeof game.id === 'string' && object(game.away) && object(game.home))
        && Array.isArray(data.failedLeagues);
    case 'details':
      return Array.isArray(data.teamForms) && data.teamForms.every((team: unknown) =>
        object(team) && typeof team.teamId === 'string' && Array.isArray(team.skillPlayers) && Array.isArray(team.recentGames));
    case 'players':
      return object(data.data) && typeof data.data.teamId === 'string'
        && Array.isArray(data.data.categories) && data.data.categories.every((category: unknown) =>
          object(category) && Array.isArray(category.athletes) && Array.isArray(category.labels))
        && Array.isArray(data.players);
    case 'box':
      return typeof data.eventId === 'string' && Array.isArray(data.teams) && data.teams.every((team: unknown) =>
        object(team) && typeof team.id === 'string' && Array.isArray(team.categories) && Array.isArray(team.teamStats) && Array.isArray(team.linescores));
    case 'team':
      return typeof data.teamId === 'string' && 'pointsPerGame' in data;
  }
  return false;
}

export function readRenderSnapshot<K extends keyof Snapshots>(kind: K, key: string): Snapshots[K] | null {
  if (stopped) return null;
  try {
    const raw = storage()?.getItem(`${prefix}${kind}:${key}`);
    if (!raw) return null;
    const entry: unknown = JSON.parse(raw);
    if (!object(entry) || entry.version !== 1 || !valid(kind, entry.data)) throw new Error('Invalid saved display snapshot');
    return entry.data;
  } catch (error) {
    console.error('Could not read saved public display', error);
    return null;
  }
}

export function saveRenderSnapshot<K extends keyof Snapshots>(kind: K, key: string, data: Snapshots[K]): void {
  if (stopped) return;
  try {
    const target = storage();
    if (!target) return;
    const name = `${prefix}${kind}:${key}`;
    const raw = JSON.stringify({ version: 1, data });
    if (raw.length > 256_000) throw new Error('Public display snapshot exceeds its storage limit');
    if (target.getItem(name) === raw) return;
    const entries = Array.from({ length: target.length }, (_, index) => target.key(index))
      .filter((entry): entry is string => !!entry && entry.startsWith(prefix) && entry !== name);
    let size = raw.length;
    let count = 1;
    for (const entry of entries.reverse()) {
      const length = target.getItem(entry)?.length ?? 0;
      if (count >= 160 || size + length > 2_000_000) target.removeItem(entry);
      else { size += length; count++; }
    }
    target.setItem(name, raw);
  } catch (error) {
    console.error('Could not save public display for immediate reopening', error);
  }
}

export function stopRenderSnapshots() {
  stopped = true;
}

export const gameSnapshotKey = (feed: string, event: string, season: number) => `${feed}:${event}:${season}`;
export const teamSnapshotKey = (feed: string, team: string, season: number) => `${feed}:${team}:${season}`;
export const detailsSnapshotKey = (feed: string, event: string, season: number, teams: string[]) =>
  `${gameSnapshotKey(feed, event, season)}:${[...teams].sort().join(',')}`;

export function readGameDetailsSnapshot(feed: string, event: string, season: number, teams: string[]): NFLGameDetails | null {
  const together = readRenderSnapshot('details', detailsSnapshotKey(feed, event, season, teams));
  if (together) return together;
  const teamForms = teams.flatMap((team) =>
    readRenderSnapshot('details', detailsSnapshotKey(feed, event, season, [team]))?.teamForms ?? []);
  return teamForms.length === teams.length ? { teamForms } : null;
}
