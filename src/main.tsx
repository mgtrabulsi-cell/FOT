import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import OfflineStatus from './OfflineStatus';
import './style.css';
import './sports-theme.css';
import { initializeNativeOffline, nativeApp } from './services/nativeOffline';
import { initializeWebOffline } from './services/webOffline';

if (!nativeApp && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).catch((error: unknown) => {
    console.error('GameWire service worker registration failed.', error);
  });
}

class AppRecoveryBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('GameWire screen failed to render.', error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main role="alert" style={{ padding: 32 }}>
      <h1>GameWire could not open this screen</h1>
      <p>Reload to get the latest version. Your saved account data has not been cleared.</p>
      <button type="button" onClick={() => {
        const url = new URL(window.location.href);
        url.searchParams.set('gw-recover', String(Date.now()));
        window.location.replace(url.href);
      }}>Reload GameWire</button>
      <p><a href="https://gamewire.us/support.html">Contact support</a></p>
    </main>;
  }
}

async function start() {
  if (!nativeApp) initializeWebOffline();
  await initializeNativeOffline();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppRecoveryBoundary>
        <OfflineStatus />
        <App />
      </AppRecoveryBoundary>
    </React.StrictMode>,
  );
}
void start().catch((error: unknown) => {
  console.error('GameWire startup failed', error);
  const root = document.getElementById('root');
  if (root) root.textContent = 'GameWire could not open its saved data. Please close and reopen the app. If this continues, contact support.';
});
