import { useEffect, useState } from 'react';

export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GAMEWIRE_CONNECTION_STATUS' && event.data.offline === true) setOnline(false);
    };
    const checkWorker = () => navigator.serviceWorker?.controller?.postMessage({ type: 'GAMEWIRE_CONNECTION_STATUS' });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    navigator.serviceWorker?.addEventListener('controllerchange', checkWorker);
    checkWorker();
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      navigator.serviceWorker?.removeEventListener('controllerchange', checkWorker);
    };
  }, []);
  return online;
}

export default function OfflineStatus() {
  const online = useOnlineStatus();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [snapshot, setSnapshot] = useState<{ saving: boolean; savedAt?: string; error?: string }>(() => {
    try {
      const savedAt = localStorage.getItem('gamewire-offline-snapshot');
      return { saving: false, savedAt: savedAt && Number.isFinite(Date.parse(savedAt)) ? savedAt : undefined };
    } catch (error) {
      console.error('Could not read offline snapshot status', error);
      return { saving: false };
    }
  });
  useEffect(() => {
    const onSnapshot = (event: Event) => {
      const detail = (event as CustomEvent<{ saving: boolean; savedAt?: string; error?: string }>).detail;
      setSnapshot((previous) => ({ ...previous, ...detail, error: detail.error }));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GAMEWIRE_OFFLINE_SAVE_ERROR') setSaveError(true);
      if (event.data?.type !== 'GAMEWIRE_CACHED_RESPONSE') return;
      setCached(true);
      const timestamp: unknown = event.data.savedAt;
      if (typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp))) {
        setSavedAt((previous) => !previous || Date.parse(timestamp) < Date.parse(previous) ? timestamp : previous);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    window.addEventListener('gamewire-offline-snapshot', onSnapshot);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      window.removeEventListener('gamewire-offline-snapshot', onSnapshot);
    };
  }, []);
  if (!online || cached) return <aside className="offline-status" role="status">
    <b>{online ? 'Showing saved data' : 'Offline — saved browsing'}</b>
    <span>Scores and stats are not live. {savedAt ? `Oldest saved response shown: ${new Date(savedAt).toLocaleString()}. ` : ''}
      {snapshot.savedAt ? `Weekly copy saved: ${new Date(snapshot.savedAt).toLocaleString()}. ` : ''}
      Only successfully saved content is available. Sign-in, account changes, publishing, and new notifications require internet.</span>
    {(saveError || snapshot.error) && <span>{snapshot.error ?? 'Some content could not be saved on this device.'}</span>}
    {online && <button onClick={() => window.location.reload()}>Refresh live data</button>}
  </aside>;
  if (saveError) return <aside className="offline-status" role="status">This device could not save some content for offline use. Free up storage and reload while online.</aside>;
  if (snapshot.error) return <aside className="offline-status" role="status">{snapshot.error}</aside>;
  if (snapshot.saving || snapshot.savedAt) return <aside className="offline-status" role="status">
    <b>{snapshot.saving ? 'Saving games, player stats, logos, and faces for offline use...' : 'Offline copy saved'}</b>
    <span>{snapshot.savedAt ? `Last completed: ${new Date(snapshot.savedAt).toLocaleString()}. ` : ''}
      Weekly NFL copies refresh every five minutes while this app is open, visible, and online. Keep it open until saving finishes.</span>
  </aside>;
  return null;
}
