import { useEffect, useState } from 'react';
import { Network } from '@capacitor/network';
import { nativeApp } from './services/nativeOffline';

export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const nativeOffline = () => {
      if (nativeApp) void Network.getStatus().then(({ connected }) => setOnline(connected)).catch((error: unknown) => console.error('Could not check native connectivity', error));
    };
    const networkListener = nativeApp ? Network.addListener('networkStatusChange', ({ connected }) => setOnline(connected)) : null;
    nativeOffline();
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GAMEWIRE_CONNECTION_STATUS' && event.data.offline === true) setOnline(false);
    };
    const checkWorker = () => navigator.serviceWorker?.controller?.postMessage({ type: 'GAMEWIRE_CONNECTION_STATUS' });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('gamewire-native-offline', nativeOffline);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    navigator.serviceWorker?.addEventListener('controllerchange', checkWorker);
    checkWorker();
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('gamewire-native-offline', nativeOffline);
      if (networkListener) void networkListener.then((listener) => listener.remove());
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      navigator.serviceWorker?.removeEventListener('controllerchange', checkWorker);
    };
  }, []);
  return online;
}

function OfflineStatusContent() {
  const online = useOnlineStatus();
  const [savedAt, setSavedAt] = useState<string | null>(null);
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
    const recordSaved = (timestamp: unknown) => {
      if (typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp))) {
        setSavedAt((previous) => !previous || Date.parse(timestamp) < Date.parse(previous) ? timestamp : previous);
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GAMEWIRE_OFFLINE_SAVE_ERROR') setSaveError(true);
      if (event.data?.type === 'GAMEWIRE_CACHED_RESPONSE') recordSaved(event.data.savedAt);
    };
    const onNativeCached = (event: Event) => recordSaved((event as CustomEvent<string>).detail);
    const onNativeError = () => setSaveError(true);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    window.addEventListener('gamewire-offline-snapshot', onSnapshot);
    window.addEventListener('gamewire-native-cached', onNativeCached);
    window.addEventListener('gamewire-native-save-error', onNativeError);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      window.removeEventListener('gamewire-offline-snapshot', onSnapshot);
      window.removeEventListener('gamewire-native-cached', onNativeCached);
      window.removeEventListener('gamewire-native-save-error', onNativeError);
    };
  }, []);
  if (online) return null;
  return <aside className="offline-status" role="status">
    <b>Offline — saved browsing</b>
    <span>Scores and stats are not live. {savedAt ? `Oldest saved response shown: ${new Date(savedAt).toLocaleString()}. ` : ''}
      {snapshot.savedAt ? `Weekly copy saved: ${new Date(snapshot.savedAt).toLocaleString()}. ` : ''}
      Only successfully saved content is available. Sign-in, account changes, publishing, and new notifications require internet.</span>
    {(saveError || snapshot.error) && <span>{snapshot.error ?? 'Some content could not be saved on this device.'}</span>}
  </aside>;
}

export default function OfflineStatus() {
  return <OfflineStatusContent />;
}
