import { useEffect, useRef, useState } from 'react';
import { observePostViews } from './services/livewireViews';
import type { AnalystKind } from './services/analystReads';

export type AnalystSeen = (kind: AnalystKind, key: string) => Promise<void>;

export function useAnalystReadObserver(kind: AnalystKind, onSeen: AnalystSeen | undefined, userId: string | undefined, contentKey: string) {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!root.current || !onSeen) return;
    return observePostViews(root.current, async (key) => {
      await onSeen(kind, key);
      setError('');
    }, (cause) => {
      console.error('Could not mark Analyst Desk content as read', cause);
      setError('Could not save your Analyst Desk read status. Reconnect or return to the app to retry.');
    }, { minimumRatio: 0.01, bottomInset: 64, allowOffline: !userId, retryFailed: true });
  }, [kind, onSeen, userId, contentKey]);
  return { root, error };
}
