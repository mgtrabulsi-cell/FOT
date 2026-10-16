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
  useEffect(() => {
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
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);
  if (!online || cached) return <aside className="offline-status" role="status">
    <b>{online ? 'Showing saved data' : 'Offline — saved browsing'}</b>
    <span>Scores and stats are not live. {savedAt ? `Oldest saved response shown: ${new Date(savedAt).toLocaleString()}. ` : ''}
      Only previously loaded content is available. Sign-in, account changes, publishing, and new notifications require internet.</span>
    {online && <button onClick={() => window.location.reload()}>Refresh live data</button>}
  </aside>;
  if (saveError) return <aside className="offline-status" role="status">This device could not save some content for offline use. Free up storage and reload while online.</aside>;
  return null;
}
