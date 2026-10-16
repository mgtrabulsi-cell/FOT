import {
  fetchNFLBoxScore, fetchNFLGameDetails, fetchNFLPlayerSeasonBoxScore, fetchNFLTeamSeasonAverages, fetchScoreboards, refreshNFLOfflineSources,
} from './sportsData.ts';
import type { Game } from './sportsData.ts';
import { nativeApp, NativeOffline, settleNativeReads, warmNativeImages } from './nativeOffline.ts';
import { warmWebImages, webOfflineStore } from './webOffline.ts';

export const offlineSnapshotInterval = 5 * 60_000;

export function collectOfflineImages(value: unknown, images = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => collectOfflineImages(entry, images));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => {
      if ((key === 'logo' || key === 'headshot') && typeof entry === 'string' && entry.startsWith('https://a.espncdn.com/')) images.add(entry);
      else if (entry && typeof entry === 'object') collectOfflineImages(entry, images);
    });
  }
  return images;
}

export async function saveWeekSnapshot(games: Game[], signal: AbortSignal): Promise<string[]> {
  const baseline = nativeApp ? await NativeOffline.status() : { failures: webOfflineStore().failures() };
  refreshNFLOfflineSources();
  // The first scoreboard can load before the worker takes control on a new install.
  const scoreboard = await fetchScoreboards(signal);
  if (scoreboard.failedLeagues.length) throw new Error('The scoreboard could not be saved. Keep the app online to retry.');
  const images = collectOfflineImages(games);
  collectOfflineImages(scoreboard.games, images);
  const failures: string[] = [];
  try {
    await saveOfflineImages([...images], signal);
  } catch (error) {
    if (signal.aborted) throw error;
    console.error('Offline team images could not all be saved', error);
    failures.push('team images');
  }
  const nflGames = games.filter((game) => game.league === 'NFL');
  // Limit parallel games; each existing loader already batches its own player requests.
  for (let start = 0; start < nflGames.length; start += 2) {
    signal.throwIfAborted();
    await Promise.all(nflGames.slice(start, start + 2).map(async (game) => {
      try {
        const teams = [game.away, game.home];
        const box = await fetchNFLBoxScore(game.feedPath, game.eventId, signal);
        collectOfflineImages(box, images);
        const details = await fetchNFLGameDetails(game.feedPath, game.eventId, game.seasonYear, teams, signal);
        collectOfflineImages(details, images);
        try {
          await saveOfflineImages([...collectOfflineImages([box, details])], signal);
        } catch (error) {
          if (signal.aborted) throw error;
          console.error('Some matchup images could not be saved', error);
          failures.push(`${game.away.abbr} at ${game.home.abbr} images`);
        }
        for (const team of teams) {
          try {
            const form = details.teamForms.find((entry) => entry.teamId === team.id);
            if (!form?.skillPlayers.length) throw new Error(`No player data for ${team.name}`);
            const [averages, players] = await Promise.all([
              fetchNFLTeamSeasonAverages(game.feedPath, team.id, game.seasonYear, signal),
              fetchNFLPlayerSeasonBoxScore(game.feedPath, team.id, game.seasonYear, form.skillPlayers, signal),
            ]);
            collectOfflineImages([averages, players], images);
            if (players.failedPlayers) throw new Error(`Some player stats could not be saved for ${team.name}`);
          } catch (error) {
            if (signal.aborted) throw error;
            console.error(`Offline team snapshot incomplete for ${team.name}`, error);
            failures.push(team.name);
          }
        }
      } catch (error) {
        if (signal.aborted) throw error;
        console.error(`Offline snapshot incomplete for ${game.away.abbr} at ${game.home.abbr}`, error);
        failures.push(`${game.away.abbr} at ${game.home.abbr}`);
      }
    }));
  }
  signal.throwIfAborted();
  if (nativeApp) await settleNativeReads();
  else await webOfflineStore().settle();
  signal.throwIfAborted();
  await saveOfflineImages([...images], signal, baseline.failures);
  if (nativeApp && (await NativeOffline.status()).failures !== baseline.failures) throw new Error('Some native content could not be refreshed or retained. Check connectivity and available storage, then retry online.');
  return failures;
}

export async function saveOfflineImages(urls: string[], signal: AbortSignal, failures?: number): Promise<void> {
  if (nativeApp) return warmNativeImages(urls, signal);
  await warmWebImages(urls, signal);
  if (failures !== undefined && webOfflineStore().failures() !== failures) throw new Error('Some images or stats could not be saved. Check available storage and retry online.');
}
