import type { Game } from './sportsData.ts';
import { fetchNBAScoreboard } from './sportsData.ts';
import { fetchNBARoster, fetchNBASummary, fetchNBATeamSeason } from './nbaData.ts';
import type { NBASummary } from './nbaData.ts';
import { gameSnapshotKey, readRenderSnapshot, saveRenderSnapshot } from './renderSnapshots.ts';

const warmedTeams = new Map<string, number>();
export async function preloadNBAPregame(games: Game[], signal: AbortSignal): Promise<string[]> {
  const failed: string[] = [];
  const unique = [...new Map(games.flatMap((game) => [game.away, game.home].map((team) =>
    [`${team.id}:${game.seasonYear}`, { team, season: game.seasonYear }] as const))).values()];
  for (let start = 0; start < unique.length; start += 2) {
    signal.throwIfAborted();
    await Promise.all(unique.slice(start, start + 2).map(async ({ team, season }) => {
      const key = `${team.id}:${season}`;
      if (Date.now() - (warmedTeams.get(key) ?? 0) < 300_000
        && readRenderSnapshot('nbaRoster', `roster:${key}`) && readRenderSnapshot('nbaTeamSeason', `season:${key}`)) return;
      try {
        await Promise.all([
          fetchNBARoster(team.id, season, signal),
          fetchNBATeamSeason(team.id, season, signal),
        ]);
        warmedTeams.set(key, Date.now());
      } catch (error) {
        if (signal.aborted) throw error;
        console.error(`Could not preload NBA team ${key}`, error);
        failed.push(key);
      }
    }));
  }
  for (const game of games) {
    const season = game.seasonYear;
    const teams = [game.away, game.home];
    const away = readRenderSnapshot('nbaTeamSeason', `season:${game.away.id}:${season}`);
    const home = readRenderSnapshot('nbaTeamSeason', `season:${game.home.id}:${season}`);
    if (away && home) saveRenderSnapshot('nbaComparison', `comparison:${game.away.id}:${game.home.id}:${season}`, { away, home });
    const groups = teams.map((team) => ({ team, players: readRenderSnapshot('nbaRoster', `roster:${team.id}:${season}`) }));
    if (groups.every((group) => group.players !== null)) {
      saveRenderSnapshot('nbaDirectory', `directory:${teams.map((team) => team.id).join(',')}:${season}`,
        groups.flatMap((group) => group.players ? [{ team: group.team, players: group.players }] : []));
    }
  }
  return failed;
}

export function saveNBASummary(key: string, summary: NBASummary) {
  const previous = readRenderSnapshot('nbaSummary', key);
  if (previous?.teams.some((team) => team.players.length
    && !summary.teams.some((next) => next.id === team.id && next.players.length))) {
    throw new Error('NBA box-score refresh is incomplete; retaining saved statistics.');
  }
  // Keep instant-open snapshots small; the complete play history still loads from ESPN.
  saveRenderSnapshot('nbaSummary', key, { ...summary, plays: summary.plays.slice(-80) });
}

export function nbaNearbyDates(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  return [1, 2, 3, 4, 5, 6, 7, -1].map((offset) => {
    const next = new Date(day);
    next.setUTCDate(next.getUTCDate() + offset);
    return next.toISOString().slice(0, 10);
  });
}

export async function preloadNBABoxes(games: Game[], signal: AbortSignal): Promise<string[]> {
  const failed: string[] = [];
  const due = games.filter((game) => {
    if (game.status === 'UPCOMING') return false;
    const saved = readRenderSnapshot('nbaSummary', gameSnapshotKey(game.feedPath, game.eventId, game.seasonYear));
    return !(game.status === 'FINAL' && saved?.status === 'post'
      && [game.away.id, game.home.id].every((id) => saved.teams.some((team) => team.id === id && team.players.length)));
  });
  for (let start = 0; start < due.length; start += 2) {
    signal.throwIfAborted();
    await Promise.all(due.slice(start, start + 2).map(async (game) => {
      try {
        const summary = await fetchNBASummary(game.eventId, signal);
        signal.throwIfAborted();
        saveNBASummary(gameSnapshotKey(game.feedPath, game.eventId, game.seasonYear), summary);
      } catch (error) {
        if (signal.aborted) throw error;
        console.error(`Could not preload NBA box score ${game.eventId}`, error);
        failed.push(game.eventId);
      }
    }));
  }
  return failed;
}

export async function preloadNBADates(date: string, signal: AbortSignal): Promise<string[]> {
  const failed: string[] = [];
  for (const next of nbaNearbyDates(date)) {
    signal.throwIfAborted();
    try {
      const games = await fetchNBAScoreboard(next, signal);
      if (next < date) failed.push(...await preloadNBABoxes(games, signal));
    } catch (error) {
      if (signal.aborted) throw error;
      console.error(`Could not preload NBA schedule ${next}`, error);
      failed.push(next);
    }
  }
  return failed;
}
