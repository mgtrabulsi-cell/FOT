export function subscribeForegroundRefresh(refresh: () => void) {
  let lastRefresh = -Infinity;
  const resume = () => {
    if (document.visibilityState === 'hidden' || !navigator.onLine) return;
    const now = Date.now();
    if (now - lastRefresh < 1000) return;
    lastRefresh = now;
    refresh();
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  window.addEventListener('online', resume);
  document.addEventListener('resume', resume);
  window.addEventListener('gamewire-app-active', resume);
  return () => {
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('focus', resume);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('online', resume);
    document.removeEventListener('resume', resume);
    window.removeEventListener('gamewire-app-active', resume);
  };
}
