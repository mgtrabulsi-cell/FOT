import { useEffect } from 'react';
import { supabase } from './services/supabaseClient';

const RESUME_AFTER_MS = 30 * 60 * 1000;
const sessionKey = (userId: string) => `gamewire-site-open:${userId}`;

export function useSiteOpenTracking(userId: string | null | undefined, enabled = true) {
  useEffect(() => {
    if (!supabase || !enabled) return;
    const client = supabase;
    let guestSession: string | null = null;
    if (!userId) {
      try {
        guestSession = sessionStorage.getItem('gamewire-guest-session');
        if (!guestSession) {
          guestSession = crypto.randomUUID();
          sessionStorage.setItem('gamewire-guest-session', guestSession);
        }
      } catch (cause) {
        console.warn('Guest visit session storage is unavailable', cause);
        guestSession = crypto.randomUUID();
      }
    }
    const key = sessionKey(userId ?? `guest:${guestSession}`);
    const record = () => {
      void (async () => {
        const { error } = userId ? await client.rpc('record_site_open')
          : await client.rpc('record_guest_site_open', { guest_session: guestSession });
        if (error) throw error;
        try { sessionStorage.setItem(key, String(Date.now())); }
        catch (cause) { console.warn('Could not retain visit tracking receipt', cause); }
      })().catch((cause: unknown) => console.error('Could not record site open', cause));
    };

    let alreadyCounted = false;
    try { alreadyCounted = sessionStorage.getItem(key) !== null; } catch (cause) { console.warn('Could not read visit tracking receipt', cause); }
    if (!alreadyCounted) record();

    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= RESUME_AFTER_MS) record();
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [userId, enabled]);
}
