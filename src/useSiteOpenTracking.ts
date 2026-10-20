import { useEffect } from 'react';
import { supabase } from './services/supabaseClient';

const RESUME_AFTER_MS = 30 * 60 * 1000;
const sessionKey = (userId: string) => `gamewire-site-open:${userId}`;

export function useSiteOpenTracking(userId: string | null | undefined) {
  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    const record = () => {
      try { sessionStorage.setItem(sessionKey(userId), String(Date.now())); } catch { /* storage unavailable */ }
      void Promise.resolve(client.rpc('record_site_open')).catch(() => undefined);
    };

    let alreadyCounted = false;
    try { alreadyCounted = sessionStorage.getItem(sessionKey(userId)) !== null; } catch { /* storage unavailable */ }
    if (!alreadyCounted) record();

    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= RESUME_AFTER_MS) record();
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [userId]);
}
