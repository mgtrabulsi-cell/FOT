import type { Game, NFLBoxScoreData, NFLGameDetails, NFLPlayerSeasonBoxScore, NFLSkillPlayer, NFLTeamSeasonAverages } from './sportsData.ts';
import { readLivewirePosts } from './livewirePosts.ts';
import type { LivewireSnapshot } from './livewirePosts.ts';
import type { TeamComparisonRanks } from './teamComparisonRanks.ts';
import { readMatchupPicks } from './matchupBoard.ts';
import type { MatchupPick } from './matchupBoard.ts';
import type { NBAPlayer, NBAPlayerProfile, NBASummary, NBATeamStat } from './nbaData.ts';
import type { Team } from './sportsData.ts';
import { readAngles } from './theAngle.ts';
import type { Angle } from './theAngle.ts';

type Snapshots = {
  scoreboard: { games: Game[]; failedLeagues: string[]; nflWeek: number | null };
  details: NFLGameDetails;
  players: { data: NFLPlayerSeasonBoxScore; players: NFLSkillPlayer[] };
  box: NFLBoxScoreData;
  nbaSummary: NBASummary;
  nbaRoster: NBAPlayer[];
  nbaTeamSeason: NBATeamStat[];
  nbaProfile: NBAPlayerProfile;
  nbaPlayerSeason: Omit<NBAPlayerProfile, 'games'>;
  nbaLeague: { teams: Team[]; season: number };
  nbaDirectory: Array<{ team: Team; players: NBAPlayer[] }>;
  nbaStatHub: { season: number; groups: Array<{ team: Team; players: NBAPlayer[] }> };
  nbaComparison: { away: NBATeamStat[]; home: NBATeamStat[] };
  nbaScoring: { averages: Record<string, number>; failed: string[]; updatedAt?: number };
  team: NFLTeamSeasonAverages;
  posts: LivewireSnapshot;
  angleFeed: { season: number; week: number; rows: Angle[] };
  activeBets: { rows: Angle[] };
  results: { rows: Angle[] };
  teamRanks: TeamComparisonRanks;
  fantasyBoard: { picks: MatchupPick[]; revision: number };
  fantasyAverages: Record<string, { average: number | null; games: number }>;
  fantasyPPR: { projections: Record<string, number>; actuals: Record<string, number> };
};

const prefix = `gamewire-render-v1:${import.meta.env?.BASE_URL ?? '/'}:`;
let stopped = false;
type SnapshotChange = { kind: keyof Snapshots; key: string };
const listeners = new Set<(change: SnapshotChange) => void>();

export function subscribeRenderSnapshots(listener: () => void, filter?: SnapshotChange) {
  const notify = (change: SnapshotChange) => {
    if (!filter || (filter.kind === change.kind && filter.key === change.key)) listener();
  };
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

function storage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function valid<K extends keyof Snapshots>(kind: K, data: unknown): data is Snapshots[K] {
  const players = (value: unknown) => Array.isArray(value) && value.every((player: unknown) =>
    object(player) && typeof player.id === 'string' && typeof player.name === 'string'
    && typeof player.teamId === 'string' && typeof player.position === 'string' && typeof player.jersey === 'string');
  const stats = (value: unknown) => Array.isArray(value) && value.every((stat: unknown) =>
    object(stat) && typeof stat.name === 'string' && typeof stat.label === 'string' && typeof stat.display === 'string');
  const numbers = (value: unknown) => object(value) && Object.values(value).every((n) => typeof n === 'number' && Number.isFinite(n));
  const team = (value: unknown) => object(value) && typeof value.id === 'string' && typeof value.name === 'string'
    && typeof value.abbr === 'string' && typeof value.color === 'string' && typeof value.score === 'number' && typeof value.record === 'string';
  if (kind === 'nbaRoster') return players(data);
  if (kind === 'nbaTeamSeason') return stats(data);
  if (kind === 'nbaDirectory') return Array.isArray(data) && data.every((group: unknown) =>
    object(group) && team(group.team) && players(group.players));
  if (!object(data)) return false;
  switch (kind) {
    case 'nbaLeague':
      return Number.isInteger(data.season) && Array.isArray(data.teams) && data.teams.every(team);
    case 'nbaStatHub':
      return Number.isInteger(data.season) && Array.isArray(data.groups) && data.groups.length > 0
        && data.groups.every((group: unknown) => object(group) && team(group.team) && players(group.players))
        && data.groups.some((group: unknown) => object(group) && Array.isArray(group.players) && group.players.length > 0);
    case 'nbaComparison':
      return stats(data.away) && stats(data.home);
    case 'nbaScoring':
      return numbers(data.averages) && Array.isArray(data.failed) && data.failed.every((id: unknown) => typeof id === 'string');
    case 'nbaProfile':
      return Number.isInteger(data.season) && numbers(data.averages) && numbers(data.totals)
        && Array.isArray(data.games) && data.games.every((game: unknown) =>
          object(game) && typeof game.id === 'string' && typeof game.date === 'string' && typeof game.opponent === 'string'
          && typeof game.result === 'string' && typeof game.score === 'string' && typeof game.seasonType === 'string'
          && numbers(game.stats));
    case 'nbaPlayerSeason':
      return Number.isInteger(data.season) && numbers(data.averages) && numbers(data.totals);
    case 'nbaSummary':
      return typeof data.eventId === 'string' && typeof data.clock === 'string' && typeof data.period === 'string'
        && typeof data.status === 'string' && Array.isArray(data.teams) && data.teams.every((team: unknown) =>
          object(team) && typeof team.id === 'string' && Array.isArray(team.stats) && team.stats.every((stat: unknown) =>
            object(stat) && typeof stat.name === 'string' && typeof stat.label === 'string' && typeof stat.display === 'string')
          && Array.isArray(team.players) && team.players.every((player: unknown) =>
            object(player) && typeof player.id === 'string' && typeof player.name === 'string' && typeof player.position === 'string'
            && object(player.stats) && Object.values(player.stats).every((value) => typeof value === 'number' && Number.isFinite(value))
            && object(player.display) && Object.values(player.display).every((value) => typeof value === 'string')
            && typeof player.starter === 'boolean' && typeof player.didNotPlay === 'boolean' && typeof player.reason === 'string'))
        && Array.isArray(data.plays) && data.plays.every((play: unknown) =>
          object(play) && typeof play.id === 'string' && typeof play.text === 'string' && typeof play.period === 'number'
          && typeof play.clock === 'string' && typeof play.scoring === 'boolean');
    case 'fantasyBoard':
      return Number.isInteger(data.revision) && Number(data.revision) >= 0 && readMatchupPicks(data.picks).length <= 16;
    case 'fantasyAverages':
      return Object.values(data).every((value) => object(value) && Number.isInteger(value.games) && Number(value.games) >= 0
        && (value.average === null || (typeof value.average === 'number' && Number.isFinite(value.average))));
    case 'fantasyPPR':
      return object(data.projections) && object(data.actuals)
        && [...Object.values(data.projections), ...Object.values(data.actuals)].every((value) => typeof value === 'number' && Number.isFinite(value));
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
    case 'posts':
      return typeof data.hasMore === 'boolean' && readLivewirePosts(data.posts).length <= 20;
    case 'angleFeed': {
      const rows = readAngles(data.rows);
      return Number.isInteger(data.season) && Number.isInteger(data.week)
        && rows.length <= 20 && rows.every((row) => row.status === 'published');
    }
    case 'activeBets':
    case 'results':
      return readAngles(data.rows).every((row) => row.status === 'published');
    case 'teamRanks':
      return Number.isInteger(data.season) && Array.isArray(data.teams) && data.teams.length === 32
        && new Set(data.teams.map((team: unknown) => object(team) ? team.teamId : null)).size === 32
        && data.teams.every((team: unknown) => object(team) && typeof team.teamId === 'string'
          && object(team.ranks) && Object.values(team.ranks).length === 8
          && ['pointsPerGame', 'totalYardsPerGame', 'passingYardsPerGame', 'rushingYardsPerGame',
            'pointsAllowedPerGame', 'totalYardsAllowedPerGame', 'passingYardsAllowedPerGame', 'rushingYardsAllowedPerGame']
            .every((key) => object(team.ranks) && key in team.ranks)
          && Object.values(team.ranks).every((rank) => rank === null || (object(rank)
            && Number.isInteger(rank.rank) && Number(rank.rank) >= 1 && Number(rank.rank) <= 32 && typeof rank.tied === 'boolean')));
  }
  return false;
}

export function readRenderSnapshot<K extends keyof Snapshots>(kind: K, key: string, maxAge = Infinity): Snapshots[K] | null {
  if (stopped) return null;
  try {
    const raw = storage()?.getItem(`${prefix}${kind}:${key}`);
    if (!raw) return null;
    const entry: unknown = JSON.parse(raw);
    if (!object(entry) || entry.version !== 1 || !valid(kind, entry.data)) throw new Error('Invalid saved display snapshot');
    if (maxAge !== Infinity && (typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt >= maxAge)) return null;
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
    const raw = JSON.stringify({ version: 1, data, savedAt: Date.now() });
    if (raw.length > (kind === 'results' ? 1_000_000 : 256_000)) throw new Error('Public display snapshot exceeds its storage limit');
    const previous = target.getItem(name);
    if (previous === raw) return;
    if (previous) {
      let unchanged = false;
      try {
        const entry: unknown = JSON.parse(previous);
        unchanged = object(entry) && entry.version === 1 && JSON.stringify(entry.data) === JSON.stringify(data);
      } catch (error) {
        console.error('Could not compare saved public display; replacing it with fresh data', error);
      }
      if (unchanged) { target.setItem(name, raw); return; }
    }
    const entries = Array.from({ length: target.length }, (_, index) => target.key(index))
      .filter((entry): entry is string => !!entry && entry.startsWith(prefix) && entry !== name);
    let size = raw.length;
    let count = 1;
    const protectedEntries = new Set(['nbaStatHub:last', 'posts:livewire', 'angleFeed:angle', 'angleFeed:news', 'activeBets:last', 'results:last'].map((key) => `${prefix}${key}`));
    entries.reverse().sort((a, b) => Number(protectedEntries.has(b)) - Number(protectedEntries.has(a)));
    for (const entry of entries) {
      const length = target.getItem(entry)?.length ?? 0;
      if (!protectedEntries.has(entry) && (count >= 160 || size + length > 2_000_000)) target.removeItem(entry);
      else { size += length; count++; }
    }
    target.setItem(name, raw);
    listeners.forEach((listener) => listener({ kind, key }));
  } catch (error) {
    console.error('Could not save public display for immediate reopening', error);
  }
}

export function stopRenderSnapshots() {
  stopped = true;
}

export function nbaResourceSnapshots<K extends 'nbaRoster' | 'nbaTeamSeason' | 'nbaProfile' | 'nbaLeague' | 'nbaDirectory' | 'nbaComparison' | 'nbaScoring'>(kind: K) {
  return {
    read: (key: string) => readRenderSnapshot(kind, key),
    save: (key: string, data: Snapshots[K]) => {
      if (JSON.stringify(readRenderSnapshot(kind, key)) !== JSON.stringify(data)) saveRenderSnapshot(kind, key, data);
    },
  };
}

export function readNBADirectorySnapshot(teams: Team[], season: number) {
  const combined = readRenderSnapshot('nbaDirectory', `directory:${teams.map((team) => team.id).join(',')}:${season}`);
  const groups = teams.map((team) => {
    const roster = readRenderSnapshot('nbaRoster', `roster:${team.id}:${season}`);
    const players = combined?.find((group) => group.team.id === team.id)?.players;
    return { team, players: roster?.length ? roster : players?.length ? players : roster ?? players ?? null };
  });
  if (!groups.some((group) => group.players !== null)) return null;
  return groups.flatMap((group) => group.players !== null ? [{ team: group.team, players: group.players }] : []);
}

export function readLastNBAStatHub(): Snapshots['nbaStatHub'] | null {
  const saved = readRenderSnapshot('nbaStatHub', 'last');
  if (saved) return saved;
  if (stopped) return null;
  try {
    const target = storage();
    if (!target) return null;
    const candidates = Array.from({ length: target.length }, (_, index) => target.key(index))
      .filter((key): key is string => !!key && key.startsWith(`${prefix}nbaDirectory:directory:`))
      .map((key) => {
        const entry: unknown = JSON.parse(target.getItem(key) ?? 'null');
        return { key: key.slice(`${prefix}nbaDirectory:`.length), savedAt: object(entry) && typeof entry.savedAt === 'number' ? entry.savedAt : 0 };
      }).sort((a, b) => b.savedAt - a.savedAt);
    for (const candidate of candidates) {
      const groups = readRenderSnapshot('nbaDirectory', candidate.key);
      const season = Number(candidate.key.split(':').at(-1));
      if (groups?.some((group) => group.players.length) && Number.isInteger(season)) return { season, groups };
    }
    return null;
  } catch (error) {
    console.error('Could not restore last NBA Stat Hub list', error);
    return null;
  }
}

export function saveLastNBAStatHub(data: Snapshots['nbaStatHub']) {
  if (!valid('nbaStatHub', data)) return;
  if (JSON.stringify(readRenderSnapshot('nbaStatHub', 'last')) !== JSON.stringify(data)) {
    saveRenderSnapshot('nbaStatHub', 'last', data);
  }
}

export function readNBAComparisonSnapshot(away: string, home: string, season: number) {
  const combined = readRenderSnapshot('nbaComparison', `comparison:${away}:${home}:${season}`);
  const awayStats = readRenderSnapshot('nbaTeamSeason', `season:${away}:${season}`) ?? combined?.away;
  const homeStats = readRenderSnapshot('nbaTeamSeason', `season:${home}:${season}`) ?? combined?.home;
  return awayStats && homeStats ? { away: awayStats, home: homeStats } : null;
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
