export type AppView = 'Wire' | 'Players' | 'Analyst' | 'Gamewaire' | 'Den' | 'Profile';

const routes: Record<AppView, string> = {
  Wire: '#wire', Players: '#stat-hub', Analyst: '#analyst-desk', Gamewaire: '#gamewaire', Den: '#locker-room', Profile: '#profile',
};

export function viewFromHash(hash: string): AppView | null {
  if (hash === '#wire' || /^#wire\/game\/\d+$/.test(hash) || nbaNotificationFromHash(hash)) return 'Wire';
  if (hash === '#livewire' || /^#livewire\/post\/[0-9a-f-]{36}$/i.test(hash)) return 'Analyst';
  if (/^#analyst-desk\/story\/[0-9a-f-]{36}$/i.test(hash)) return 'Analyst';
  return (Object.keys(routes) as AppView[]).find((view) => routes[view] === hash) ?? null;
}

export function nbaNotificationFromHash(hash: string): { date: string; eventId: string } | null {
  const match = /^#wire\/nba\/(\d{4}-\d{2}-\d{2})\/(\d+)$/.exec(hash);
  if (!match) return null;
  const date = new Date(`${match[1]}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]) return null;
  return { date: match[1], eventId: match[2] };
}

export function hashForView(view: AppView, currentHash: string): string {
  if (view === 'Analyst' && currentHash.startsWith('#livewire')) return routes.Analyst;
  return viewFromHash(currentHash) === view ? currentHash : routes[view];
}

interface MedianTabNavigation {
  setTabs(options: { enabled: false }): void;
}

declare global {
  interface Window {
    median?: { tabNavigation?: MedianTabNavigation };
    median_library_ready?: () => void;
  }
}

export function connectMedianNavigation(): () => void {
  if (!/\bmedian\b|\bgonative\b/i.test(navigator.userAgent)) return () => {};
  const previousReady = window.median_library_ready;
  const initialize = () => {
    const navigation = window.median?.tabNavigation;
    if (!navigation) return;
    try {
      navigation.setTabs({ enabled: false });
    } catch (error) {
      document.documentElement.classList.remove('median-native-tabs');
      console.error('GameWire could not hide Median native tabs; check that the App Studio bottom bar is hidden.', error);
    }
  };
  const onReady = () => {
    try { previousReady?.(); } finally { initialize(); }
  };
  window.median_library_ready = onReady;
  initialize();
  return () => {
    if (window.median_library_ready === onReady) window.median_library_ready = previousReady;
    document.documentElement.classList.remove('median-native-tabs');
  };
}
