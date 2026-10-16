import {
  fetchNFLBoxScore, fetchNFLGameDetails, fetchNFLPlayerSeasonBoxScore, fetchNFLTeamSeasonAverages, fetchScoreboards, refreshNFLOfflineSources,
} from './sportsData.ts';
import type { Game } from './sportsData.ts';
import { nativeApp, NativeOffline, warmNativeImages } from './nativeOffline.ts';

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
  const baseline = nativeApp ? await NativeOffline.status() : await snapshotMessage({ type: 'GAMEWIRE_SNAPSHOT_START' }, signal);
  if (typeof baseline.failures !== 'number') throw new Error('The offline worker needs an update. Reload while online.');
  refreshNFLOfflineSources();
  // The first scoreboard can load before the worker takes control on a new install.
  const scoreboard = await fetchScoreboards(signal);
  if (scoreboard.failedLeagues.length) throw new Error('The scoreboard could not be saved. Keep the app online to retry.');
  const images = collectOfflineImages(games);
  collectOfflineImages(scoreboard.games, images);
  const failures: string[] = [];
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
        for (const team of teams) {
          const form = details.teamForms.find((entry) => entry.teamId === team.id);
          if (!form?.skillPlayers.length) throw new Error(`No player data for ${team.name}`);
          const [averages, players] = await Promise.all([
            fetchNFLTeamSeasonAverages(game.feedPath, team.id, game.seasonYear, signal),
            fetchNFLPlayerSeasonBoxScore(game.feedPath, team.id, game.seasonYear, form.skillPlayers, signal),
          ]);
          collectOfflineImages([averages, players], images);
          if (players.failedPlayers) throw new Error(`Some player stats could not be saved for ${team.name}`);
        }
      } catch (error) {
        if (signal.aborted) throw error;
        console.error(`Offline snapshot incomplete for ${game.away.abbr} at ${game.home.abbr}`, error);
        failures.push(`${game.away.abbr} at ${game.home.abbr}`);
      }
    }));
  }
  signal.throwIfAborted();
  await saveOfflineImages([...images], signal, baseline.failures);
  if (nativeApp && (await NativeOffline.status()).failures !== baseline.failures) throw new Error('Some native content could not be refreshed or retained. Check connectivity and available storage, then retry online.');
  return failures;
}

export async function saveOfflineImages(urls: string[], signal: AbortSignal, failures?: number): Promise<void> {
  if (nativeApp) return warmNativeImages(urls, signal);
  const result = await snapshotMessage({ type: 'GAMEWIRE_SAVE_IMAGES', urls, failures }, signal);
  if (result.saved !== true) throw new Error('Some images or stats could not be saved. Keep the app online to retry.');
}

function snapshotMessage(message: { type: string; urls?: string[]; failures?: number }, signal: AbortSignal): Promise<{ saved?: boolean; failures?: number }> {
  return new Promise((resolve, reject) => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) { reject(new Error('Offline saving is not ready yet.')); return; }
    const channel = new MessageChannel();
    const finish = (error?: Error, result: { saved?: boolean; failures?: number } = {}) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      channel.port1.close();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('Snapshot cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Offline saving timed out. Reload while online to retry.')), message.type === 'GAMEWIRE_SNAPSHOT_START' ? 10_000 : 5 * 60_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    channel.port1.onmessage = (event: MessageEvent) => finish(undefined, event.data);
    worker.postMessage(message, [channel.port2]);
  });
}
