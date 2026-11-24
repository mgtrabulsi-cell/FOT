import { useEffect, useState } from 'react';
import { readStatStorageStatus, restoreStatSnapshots, subscribeStatStorage } from './services/renderSnapshots';
import './statHub.css';

export default function StatHubHeader({ sport }: { sport: 'NFL' | 'NBA' }) {
  const [storage, setStorage] = useState(readStatStorageStatus);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const unsubscribe = subscribeStatStorage(() => setStorage(readStatStorageStatus()));
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    void restoreStatSnapshots();
    return () => {
      unsubscribe();
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, []);
  return <header className="stat-hub-heading">
    <div><span className="eyebrow">PLAYER LIBRARY</span><h2>{sport} player stats</h2>
      <p>Search players or choose a team. Open saved game logs and stats.</p></div>
    <div className="stat-hub-device" role="status">
      <b>{storage.error ? 'Check device storage' : storage.restoring ? 'Restoring saved stats' : storage.saving ? 'Saving stats'
        : storage.savedAt ? online ? 'Saved on this device' : 'Browsing saved stats' : online ? 'Saves as you browse' : 'Offline'}</b>
      <span>{storage.savedAt ? `Last saved ${new Date(storage.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : 'Downloaded stats reopen without waiting'}</span>
      {storage.error && <span className="stat-hub-storage-error">{storage.error}</span>}
    </div>
  </header>;
}
