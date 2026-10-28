import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './services/supabaseClient';
import { analystGuestKey, analystReceiptKey, guestAnalystReads, readAnalystItems } from './services/analystReads';
import type { AnalystKind } from './services/analystReads';

export function useAnalystUnread(userId: string | null, enabled: boolean, season: number, week: number) {
  const scope = `${userId ?? 'guest'}:${season}:${week}`;
  const [state, setState] = useState({ scope, angle: false, news: false, picks: false, hate: false, unreadKeys: [] as string[], error: '' });
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const seen = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => { seen.current = new Set(); inFlight.current = new Set(); }, [scope]);

  useEffect(() => {
    if (!enabled || !supabase || !season || !week) return;
    const client = supabase;
    let active = true;
    const load = async () => {
      const request = ++generation.current;
      if (!navigator.onLine) return;
      try {
        const result = await client.rpc('fantasy_unread_items', { board_season: season, board_week: week });
        if (result.error) throw result.error;
        const read = userId ? new Set<string>() : guestAnalystReads();
        const unread = readAnalystItems(result.data).filter((item) => !read.has(analystReceiptKey(item)));
        if (active && request === generation.current) setState({
          scope, angle: unread.some((item) => item.kind === 'angle'), news: unread.some((item) => item.kind === 'news'), picks: unread.some((item) => item.kind === 'picks'), hate: unread.some((item) => item.kind === 'hate'), unreadKeys: unread.map(analystReceiptKey), error: '',
        });
      } catch (cause) {
        if (active && request === generation.current) {
          console.error('Could not load Analyst Desk unread status', cause);
          setState((previous) => ({
            scope, angle: previous.scope === scope && previous.angle, news: previous.scope === scope && previous.news, picks: previous.scope === scope && previous.picks, hate: previous.scope === scope && previous.hate,
            unreadKeys: previous.scope === scope ? previous.unreadKeys : [],
            error: 'Could not sync Analyst Desk read status. Reconnect or reopen the page to retry.',
          }));
        }
      }
    };
    const resume = () => { if (document.visibilityState === 'visible') void load(); };
    const storage = (event: StorageEvent) => { if (event.key === analystGuestKey) resume(); };
    void load();
    const timer = window.setInterval(resume, 30_000);
    window.addEventListener('online', resume);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false; window.clearInterval(timer);
      window.removeEventListener('online', resume);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [scope, userId, enabled, season, week, refresh]);

  const markRead = useCallback(async (kind: AnalystKind, key: string) => {
    const receipt = analystReceiptKey({ kind, key });
    if (!enabled || seen.current.has(receipt) || inFlight.current.has(receipt)) return;
    const pending = inFlight.current;
    pending.add(receipt);
    try {
      if (userId) {
        if (!supabase) throw new Error('Account services are not configured.');
        const result = await supabase.rpc('mark_fantasy_read', { item_kind: kind, item_key: key });
        if (result.error) throw result.error;
      } else {
        const read = guestAnalystReads();
        read.add(receipt);
        localStorage.setItem(analystGuestKey, JSON.stringify([...read]));
      }
      if (currentScope.current !== scope) return;
      seen.current.add(receipt);
      setState((previous) => {
        if (previous.scope !== scope) return previous;
        const unreadKeys = previous.unreadKeys.filter((item) => item !== receipt);
        return { ...previous, unreadKeys, angle: unreadKeys.some((item) => item.startsWith('angle:')),
          news: unreadKeys.some((item) => item.startsWith('news:')), picks: unreadKeys.some((item) => item.startsWith('picks:')),
          hate: unreadKeys.some((item) => item.startsWith('hate:')) };
      });
      ++generation.current;
      setRefresh((value) => value + 1);
    } finally { pending.delete(receipt); }
  }, [enabled, userId, scope]);
  const angle = enabled && state.scope === scope && state.angle;
  const news = enabled && state.scope === scope && state.news;
  const picks = enabled && state.scope === scope && state.picks;
  const hate = enabled && state.scope === scope && state.hate;
  return { angle, news, picks, hate, unread: angle || news || picks || hate, unreadKeys: enabled && state.scope === scope ? state.unreadKeys : [], error: enabled && state.scope === scope ? state.error : '', markRead };
}
