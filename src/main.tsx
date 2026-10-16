import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import OfflineStatus from './OfflineStatus';
import './style.css';
import { initializeNativeOffline, nativeApp } from './services/nativeOffline';

if (!nativeApp && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error: unknown) => {
    console.error('GameWire service worker registration failed.', error);
  });
}

async function start() {
  await initializeNativeOffline();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <OfflineStatus />
      <App />
    </React.StrictMode>,
  );
}
void start().catch((error: unknown) => {
  console.error('GameWire startup failed', error);
  const root = document.getElementById('root');
  if (root) root.textContent = 'GameWire could not open its saved data. Please close and reopen the app. If this continues, contact support.';
});
