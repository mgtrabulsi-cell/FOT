import { useEffect, useRef } from 'react';
import type { Game } from './services/sportsData';
import { offlineSnapshotInterval, saveWeekSnapshot } from './services/offlineSnapshots';

export function useOfflineSnapshots(games: Game[], enabled: boolean) {
  const latestGames = useRef(games);
  latestGames.current = games;
  const weekKey = games.filter((game) => game.league === 'NFL').map((game) => `${game.seasonYear}:${game.eventId}`).sort().join(',');
  useEffect(() => {
    if (!import.meta.env.PROD || !enabled || !weekKey || !('serviceWorker' in navigator)) return;
    const controller = new AbortController();
    let running = false;
    let lastAttempt = 0;
    const update = (detail: { saving: boolean; savedAt?: string; error?: string }) => {
      window.dispatchEvent(new CustomEvent('gamewire-offline-snapshot', { detail }));
    };
    const save = async () => {
      if (running || !navigator.onLine || document.visibilityState === 'hidden' || !navigator.serviceWorker.controller
        || Date.now() - lastAttempt < offlineSnapshotInterval) return;
      running = true;
      lastAttempt = Date.now();
      update({ saving: true });
      try {
        const failures = await saveWeekSnapshot(latestGames.current, controller.signal);
        controller.signal.throwIfAborted();
        if (failures.length) throw new Error(`Offline copy is incomplete for ${failures.join(', ')}. Keep the app online to retry.`);
        const savedAt = new Date().toISOString();
        localStorage.setItem('gamewire-offline-snapshot', savedAt);
        update({ saving: false, savedAt });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Offline weekly snapshot failed', error);
          update({ saving: false, error: error instanceof Error ? error.message : 'Offline saving failed. Reconnect and try again.' });
        }
      } finally { running = false; }
    };
    const resume = () => { void save(); };
    const reconnect = () => { lastAttempt = 0; resume(); };
    navigator.serviceWorker.addEventListener('controllerchange', reconnect);
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', resume);
    const timer = window.setInterval(resume, offlineSnapshotInterval);
    resume();
    return () => {
      controller.abort();
      window.clearInterval(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', reconnect);
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [weekKey, enabled]);
}
