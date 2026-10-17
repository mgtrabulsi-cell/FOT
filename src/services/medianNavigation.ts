export type AppView = 'Wire' | 'Players' | 'LiveWire' | 'Den' | 'Profile';

const routes: Record<AppView, string> = {
  Wire: '#wire', Players: '#stat-hub', LiveWire: '#livewire', Den: '#locker-room', Profile: '#profile',
};

export function viewFromHash(hash: string): AppView | null {
  if (hash === '#wire' || /^#wire\/game\/\d+$/.test(hash)) return 'Wire';
  if (hash === '#livewire' || /^#livewire\/post\/[0-9a-f-]{36}$/i.test(hash)) return 'LiveWire';
  return (Object.keys(routes) as AppView[]).find((view) => routes[view] === hash) ?? null;
}

export function hashForView(view: AppView, currentHash: string): string {
  return viewFromHash(currentHash) === view ? currentHash : routes[view];
}

export const medianTabs = [
  { label: 'The Wire', icon: 'fas fa-football-ball', hash: '#wire' },
  { label: 'Stat Hub', icon: 'fas fa-chart-bar', hash: '#stat-hub' },
  { label: 'LIVEWIRE', icon: 'fas fa-bolt', hash: '#livewire' },
  { label: 'Locker Room', icon: 'fas fa-users', hash: '#locker-room' },
].map(({ label, icon, hash }) => ({
  label, icon,
  url: `javascript:location.hash='${hash}';window.dispatchEvent(new Event('hashchange'));void(0);`,
}));

interface MedianTabNavigation {
  setTabs(options: { enabled: boolean; items: typeof medianTabs }): void;
  selectTab(index: number): void;
  deselect(): void;
}

declare global {
  interface Window {
    median?: { tabNavigation?: MedianTabNavigation };
    median_library_ready?: () => void;
  }
}

export function syncMedianTab(view: AppView): void {
  const navigation = window.median?.tabNavigation;
  if (!navigation || !document.documentElement.classList.contains('median-native-tabs')) return;
  const index = ['Wire', 'Players', 'LiveWire', 'Den'].indexOf(view);
  if (index < 0) navigation.deselect();
  else navigation.selectTab(index);
}

export function connectMedianNavigation(getView: () => AppView): () => void {
  if (!/\bmedian\b|\bgonative\b/i.test(navigator.userAgent)) return () => {};
  const previousReady = window.median_library_ready;
  const initialize = () => {
    const navigation = window.median?.tabNavigation;
    if (!navigation) return;
    try {
      navigation.setTabs({ enabled: true, items: medianTabs });
      document.documentElement.classList.add('median-native-tabs');
      syncMedianTab(getView());
    } catch (error) {
      document.documentElement.classList.remove('median-native-tabs');
      console.error('GameWire native navigation could not initialize; keeping website navigation.', error);
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
