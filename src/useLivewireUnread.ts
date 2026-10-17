import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './services/supabaseClient';
import { usePublicDataRevision } from './usePublicDataRevision';

const guestKey = 'gamewire-livewire-guest-reads';

function guestReads(): Set<string> {
  const value: unknown = JSON.parse(localStorage.getItem(guestKey) ?? '[]');
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) throw new Error('Saved LIVEWIRE read status is invalid.');
  return new Set(value);
}

export function useLivewireUnread(userId: string | null, enabled: boolean) {
  const revision = usePublicDataRevision('posts');
  const scope = userId ?? 'guest';
  const [state, setState] = useState({ scope, unread: false, error: '' });
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const seen = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const currentScope = useRef(scope);
  currentScope.current = scope;

  useEffect(() => {
    seen.current = new Set();
    inFlight.current = new Set();
  }, [scope]);

  useEffect(() => {
    if (!enabled || !supabase) return;
    const client = supabase;
    let active = true;
    const load = async () => {
      const request = ++generation.current;
      if (!navigator.onLine) return;
      try {
        let unread = false;
        if (userId) {
          const result = await client.rpc('livewire_unread_count');
          if (result.error) throw result.error;
          const count = Number(result.data);
          if (result.data === null || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid LIVEWIRE unread count.');
          unread = count > 0;
        } else {
          const read = guestReads();
          for (let offset = 0; ; offset += 500) {
            const result = await client.from('livewire_posts').select('id').order('id').range(offset, offset + 499);
            if (result.error) throw result.error;
            if (result.data.some((post) => !read.has(post.id))) { unread = true; break; }
            if (result.data.length < 500) break;
          }
        }
        if (active && request === generation.current) setState({ scope, unread, error: '' });
      } catch (cause) {
        if (active && request === generation.current) {
          console.error('Could not load LIVEWIRE unread status', cause);
          setState((previous) => ({ scope, unread: previous.scope === scope && previous.unread, error: 'Could not sync LIVEWIRE unread status. Reconnect or reopen the page to retry.' }));
        }
      }
    };
    const resume = () => { if (document.visibilityState === 'visible') void load(); };
    const storage = (event: StorageEvent) => { if (event.key === guestKey) resume(); };
    void load();
    const timer = window.setInterval(resume, 30_000);
    window.addEventListener('online', resume);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('online', resume);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [scope, userId, enabled, refresh, revision]);

  const markRead = useCallback(async (postId: string) => {
    if (!enabled || seen.current.has(postId) || inFlight.current.has(postId)) return;
    const pending = inFlight.current;
    pending.add(postId);
    try {
      if (userId) {
        if (!supabase) throw new Error('Account services are not configured.');
        const result = await supabase.from('livewire_reads').upsert({ user_id: userId, post_id: postId }, { onConflict: 'user_id,post_id', ignoreDuplicates: true });
        if (result.error) throw result.error;
      } else {
        const read = guestReads();
        read.add(postId);
        localStorage.setItem(guestKey, JSON.stringify([...read]));
      }
      if (currentScope.current !== scope) return;
      seen.current.add(postId);
      ++generation.current;
      setRefresh((value) => value + 1);
    } finally {
      pending.delete(postId);
    }
  }, [scope, userId, enabled]);

  return { unread: enabled && state.scope === scope && state.unread, error: enabled && state.scope === scope ? state.error : '', markRead };
}
