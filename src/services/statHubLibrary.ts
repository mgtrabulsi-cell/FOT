import { fetchNBAPlayerProfile, fetchNBARoster } from './nbaData.ts';
import { fetchNFLStatHubRoster, fetchNFLHistoricalSummary, readNFLPlayerGameStats } from './sportsData.ts';
import type { NFLSkillPlayer, Team } from './sportsData.ts';
import { fetchTeamGameLog, fetchTeamLogDirectory, teamLogResult } from './teamGameLogs.ts';
import { readLastNBAStatHub, readRenderSnapshot, restoreStatSnapshots, saveRenderSnapshot } from './renderSnapshots.ts';

export const statHubWeek = 7 * 24 * 60 * 60 * 1000;
export type StatHubLeague = 'NFL' | 'NBA';
export function readStatHubDirectory(league: StatHubLeague) {
  const directory = readRenderSnapshot('teamDirectory', league);
  if (directory || league === 'NFL') return directory;
  const saved = readRenderSnapshot('nbaLeague', 'nba-league');
  if (saved) return saved;
  const last = readLastNBAStatHub();
  return last ? { season: last.season, teams: last.groups.map(group => group.team) } : null;
}
export function readStatHubGroups(league: StatHubLeague) {
  const directory = readStatHubDirectory(league);
  return directory?.teams.map(team => {
    const key = `${team.id}:${directory.season}`;
    return league === 'NFL'
      ? { league: 'NFL' as const, team, players: readRenderSnapshot('nflStatHubTeam', key)?.players ?? [] }
      : { league: 'NBA' as const, team, players: readRenderSnapshot('nbaRoster', `roster:${key}`) ?? [] };
  }) ?? [];
}
async function workers<T>(items: T[], signal: AbortSignal, task: (item: T) => Promise<void>, count = 3) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (next < items.length) {
      signal.throwIfAborted();
      await task(items[next++]);
    }
  }));
}
async function nflRoster(team: Team, season: number, signal: AbortSignal, force: boolean) {
  const key = `${team.id}:${season}`, previous = readRenderSnapshot('nflStatHubTeam', key);
  const fresh = force ? null : readRenderSnapshot('nflStatHubTeam', key, statHubWeek);
  if (fresh?.complete) return;
  const roster = await fetchNFLStatHubRoster(team.id, season);
  signal.throwIfAborted();
  if (!roster.length) throw new Error(`${team.abbr}: no verified roster returned. Saved players were retained.`);
  const players: NFLSkillPlayer[] = roster.map(player => ({
    ...player, headshot: undefined, gamesWithUsage: 0, passingAttempts: 0, targets: 0, receptions: 0, carries: 0,
    recentGames: [], ...previous?.players.find(row => row.id === player.id),
    name: player.name, position: player.position,
  }));
  saveRenderSnapshot('nflStatHubTeam', key, { team, season, players, complete: false });
}
export async function warmNFLStatHubLogs(team: Team, season: number, signal: AbortSignal, force = false) {
  const key = `${team.id}:${season}`, saved = readRenderSnapshot('nflStatHubTeam', key);
  if (!saved?.players.length) return;
  if (!force && readRenderSnapshot('nflStatHubTeam', key, statHubWeek)?.complete) return;
  const entries = (await fetchTeamGameLog('NFL', team.id, season, signal)).filter(row => row.seasonType !== 1);
  const summaries = new Map<string, unknown>();
  const failed: string[] = [];
  await workers(entries, signal, async ({ game }) => {
    try {
      const summary = await fetchNFLHistoricalSummary('football/nfl', game.eventId);
      signal.throwIfAborted();
      if (!summary || typeof summary !== 'object' || !('header' in summary)
        || !summary.header || typeof summary.header !== 'object' || !('id' in summary.header)
        || String(summary.header.id) !== game.eventId) throw new Error('Box score identity does not match the game.');
      summaries.set(game.eventId, summary);
    } catch (cause) {
      if (signal.aborted) throw cause;
      console.error('Could not save Stat Hub NFL box score', game.eventId, cause);
      failed.push(game.eventId);
    }
  }, 2);
  signal.throwIfAborted();
  const players = saved.players.map(player => {
    const recentGames = entries.flatMap(({ game }) => {
      const summary = summaries.get(game.eventId);
      if (!summary) return player.recentGames.filter(row => row.gameId === game.eventId);
      const opponent = game.home.id === team.id ? game.away : game.home;
      return [{ gameId: game.eventId, date: game.date, opponent: opponent.name, opponentAbbreviation: opponent.abbr,
        result: teamLogResult(game, team.id), score: `${game.away.score}-${game.home.score}`,
        stats: readNFLPlayerGameStats(summary, team.id, player.id) }];
    });
    const sum = (key: 'attempts' | 'targets' | 'receptions' | 'carries') => recentGames.reduce((total, game) => total + (game.stats[key] ?? 0), 0);
    return { ...player, recentGames, gamesWithUsage: recentGames.filter(game => Object.values(game.stats).some(value => value !== undefined && value > 0)).length,
      passingAttempts: sum('attempts'), targets: sum('targets'), receptions: sum('receptions'), carries: sum('carries') };
  });
  saveRenderSnapshot('nflStatHubTeam', key, { ...saved, players, complete: !failed.length });
  if (failed.length) throw new Error(`${team.abbr}: ${failed.length} game logs could not refresh. Saved logs were retained.`);
}
export async function warmStatHubLibrary(league: StatHubLeague, signal: AbortSignal,
  progress: (label: string, failures: string[]) => void, force = false) {
  await restoreStatSnapshots();
  signal.throwIfAborted();
  const directory = !force && readRenderSnapshot('teamDirectory', league, statHubWeek)
    || await fetchTeamLogDirectory(league, signal, force);
  const failures: string[] = [];
  let completed = 0;
  const run = async (label: string, task: () => Promise<void>) => {
    try { await task(); }
    catch (cause) {
      if (signal.aborted) throw cause;
      console.error('Stat Hub background refresh failed', label, cause);
      failures.push(cause instanceof Error ? cause.message : `${label} could not refresh.`);
    }
    progress(label, [...failures]);
  };
  await workers(directory.teams, signal, async team => {
    await run(`${++completed}/${directory.teams.length} team rosters`, async () => {
      if (league === 'NFL') await nflRoster(team, directory.season, signal, force);
      else {
        const key = `roster:${team.id}:${directory.season}`;
        if (force || !readRenderSnapshot('nbaRoster', key, statHubWeek))
          await fetchNBARoster(team.id, directory.season, signal);
      }
    });
  });
  completed = 0;
  const groups = readStatHubGroups(league);
  if (league === 'NFL') {
    await workers(directory.teams, signal, team => run(`${++completed}/${directory.teams.length} teams' game logs`,
      () => warmNFLStatHubLogs(team, directory.season, signal, force)), 2);
  } else {
    const players = groups.flatMap(group => group.league === 'NBA' ? group.players : []);
    await workers(players, signal, player => run(`${++completed}/${players.length} player game logs`,
      async () => { await fetchNBAPlayerProfile(player.id, directory.season, signal, force ? 0 : statHubWeek); }), 2);
  }
  progress(failures.length ? 'Weekly download finished with missing data' : 'Weekly download complete', failures);
}
