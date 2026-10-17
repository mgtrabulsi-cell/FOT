import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const refreshThreshold = 72;

export default function PullToRefresh() {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const refreshingRef = useRef(false);

  const refresh = () => {
    if (refreshingRef.current) return;
    if (!navigator.onLine) {
      setError('You are offline. Reconnect to refresh.');
      return;
    }
    refreshingRef.current = true;
    setRefreshing(true);
    setError('');
    window.location.reload();
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    let pulled = 0;
    const reset = () => {
      start = null;
      pulled = 0;
      setDistance(0);
    };
    const onStart = (event: TouchEvent) => {
      reset();
      if (!window.matchMedia('(max-width: 760px)').matches || window.scrollY > 0
        || refreshingRef.current || event.touches.length !== 1) return;
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      if (!(event.target instanceof Element) || event.target.closest('button, a, input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="slider"], [draggable="true"]')) return;
      for (let element: Element | null = event.target; element && element !== document.body; element = element.parentElement) {
        const style = getComputedStyle(element);
        if ((/(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth)
          || (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight)) return;
      }
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1 || window.scrollY > 0 || !event.cancelable) {
        reset();
        return;
      }
      const dx = Math.abs(event.touches[0].clientX - start.x);
      const dy = event.touches[0].clientY - start.y;
      if (dy < 0 || (dx > 10 && dx > dy)) {
        reset();
        return;
      }
      if (dy < 10) return;
      event.preventDefault();
      pulled = Math.min(100, dy / 2);
      setDistance(pulled);
    };
    const onEnd = () => {
      const ready = pulled >= refreshThreshold;
      reset();
      if (ready) refreshRef.current();
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', reset);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', reset);
    };
  }, []);

  const label = refreshing ? 'Refreshing...' : distance >= refreshThreshold ? 'Release to refresh' : distance > 0 ? 'Pull to refresh' : 'Refresh page';
  return <div className={`pull-refresh${distance > 0 ? ' is-pulling' : ''}`}>
    <button type="button" onClick={refresh} disabled={refreshing} aria-label="Refresh page">
      <RefreshCw size={15} aria-hidden="true" className={refreshing ? 'is-refreshing' : ''} style={{ transform: refreshing ? undefined : `rotate(${distance * 3}deg)` }} />
      <span role="status">{label}</span>
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
