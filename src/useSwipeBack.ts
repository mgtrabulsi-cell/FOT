import { useEffect, useRef } from 'react';
import { connectSwipeBack } from './services/swipeBack';

export function useSwipeBack<T extends HTMLElement>(onBack: () => void, enabled = true) {
  const root = useRef<T>(null);
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    if (enabled && root.current) return connectSwipeBack(root.current, () => back.current());
  }, [enabled]);
  return root;
}
