import type { Game, NFLBoxScoreData, NFLGameDetails, NFLPlayerSeasonBoxScore, NFLSkillPlayer, NFLTeamSeasonAverages } from './sportsData.ts';
import { readLivewirePosts } from './livewirePosts.ts';
import type { LivewireSnapshot } from './livewirePosts.ts';
import type { TeamComparisonRanks } from './teamComparisonRanks.ts';
import { readMatchupPicks } from './matchupBoard.ts';
import type { MatchupPick } from './matchupBoard.ts';
import type { NBAPlayer, NBAPlayerProfile, NBASummary, NBATeamStat } from './nbaData.ts';
import type { Team } from './sportsData.ts';

type Snapshots = {
  scoreboard: { games: Game[]; failedLeagues: string[]; nflWeek: number | null };
  details: NFLGameDetails;
  players: { data: NFLPlayerSeasonBoxScore; players: NFLSkillPlayer[] };
  box: NFLBoxScoreData;
  nbaSummary: NBASummary;
  nbaRoster: NBAPlayer[];
  nbaTeamSeason: NBATeamStat[];
  nbaProfile: NBAPlayerProfile;
  nbaLeague: { teams: Team[]; season: number };
  nbaDirectory: Array<{ team: Team; players: NBAPlayer[] }>;
  nbaComparison: { away: NBATeamStat[]; home: NBATeamStat[] };
  nbaScoring: { averages: Record<string, number>; failed: string[]; updatedAt?: number };
  team: NFLTeamSeasonAverages;
  posts: LivewireSnapshot;
  teamRanks: TeamComparisonRanks;
  fantasyBoard: { picks: MatchupPick[]; revision: number };
  fantasyAverages: Record<string, { average: number | null; games: number }>;
  fantasyPPR: { projections: Record<string, number>; actuals: Record<string, number> };
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

export function nbaResourceSnapshots<K extends 'nbaRoster' | 'nbaTeamSeason' | 'nbaProfile' | 'nbaLeague' | 'nbaDirectory' | 'nbaComparison' | 'nbaScoring'>(kind: K) {
  return {
    read: (key: string) => readRenderSnapshot(kind, key),
    save: (key: string, data: Snapshots[K]) => saveRenderSnapshot(kind, key, data),
  };
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
