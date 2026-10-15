import { useEffect, useRef, useState } from 'react';
import { supabase } from './services/supabaseClient';
import { fetchNFLFavoritePlays, fetchNFLLivePlayerStats } from './services/sportsData';
import type { DenNewsItem, FavoriteTarget, Game, NFLFavoritePlay, NFLPlayerStatKey, Team } from './services/sportsData';

export type DenScoreItem = {
  id: string; kind: 'score'; favoriteKey: string; favoriteName: string; timestamp: string;
  league: string; away: Team; home: Team; status: Game['status']; period: string; clock: string;
};
export type DenNewsFeedItem = DenNewsItem & { kind: 'news' };
export type DenPlayItem = NFLFavoritePlay & { kind: 'play' };
export type DenItem = DenNewsFeedItem | DenScoreItem;
export type PlayerHistory = {
  kind: 'player'; favorite: FavoriteTarget; game: Game; stats: Partial<Record<NFLPlayerStatKey, number>>;
};
type HistoryPayload = DenItem | DenPlayItem | PlayerHistory;
type HistoryEntry = { key: string; payload: HistoryPayload; observed_at: string };
type HistoryState = { scope: string; entries: HistoryEntry[]; loaded: boolean; error: string };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!record(value) || typeof value.key !== 'string' || typeof value.observed_at !== 'string' || !record(value.payload)) return false;
  const payload = value.payload;
  if (payload.kind === 'player') {
    return record(payload.favorite) && typeof payload.favorite.key === 'string' && typeof payload.favorite.id === 'string'
      && typeof payload.favorite.name === 'string' && record(payload.game) && typeof payload.game.id === 'string'
      && record(payload.game.away) && record(payload.game.home) && record(payload.stats)
      && Object.values(payload.stats).every((stat) => typeof stat === 'number' && Number.isFinite(stat));
  }
  if (typeof payload.id !== 'string' || typeof payload.favoriteKey !== 'string' || typeof payload.favoriteName !== 'string') return false;
  if (payload.kind === 'score') return typeof payload.timestamp === 'string' && record(payload.away) && record(payload.home);
  if (payload.kind === 'news') return typeof payload.published === 'string' && typeof payload.headline === 'string';
  return payload.kind === 'play' && typeof payload.timestamp === 'string' && typeof payload.description === 'string';
}

export function mergeHistory(previous: HistoryEntry[], incoming: HistoryEntry[]): HistoryEntry[] {
  const entries = new Map(previous.map((entry) => [entry.key, entry]));
  incoming.forEach((entry) => {
    const existing = entries.get(entry.key);
    if (existing?.payload.kind === 'player' && existing.payload.game.status === 'FINAL'
      && entry.payload.kind === 'player' && entry.payload.game.status !== 'FINAL') return;
    if (!existing || Date.parse(entry.observed_at) > Date.parse(existing.observed_at)) entries.set(entry.key, entry);
  });
  return [...entries.values()];
}

export function activityForWeek(items: Array<DenItem | DenPlayItem>, games: Game[]): Array<DenItem | DenPlayItem> {
  const dates = games.map((game) => Date.parse(game.date)).filter(Number.isFinite);
  const start = dates.length ? weekStart(Math.min(...dates)) : NaN;
  const end = dates.length ? weekStart(Math.max(...dates) + 7 * 86400_000) : NaN;
  return items.filter((item) => item.kind === 'news'
    ? Date.parse(item.published) >= start && Date.parse(item.published) < end
    : games.some((game) => item.kind === 'score' ? item.id.startsWith(`score:${game.id}:`) : item.id.startsWith(`${game.id}:`)));
}

function weekStart(timestamp: number): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  });
  const easternTime = (value: number) => {
    const parts = formatter.formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  };
  const local = new Date(easternTime(timestamp));
  const daysBack = (local.getUTCDay() - 2 + 7) % 7 || (local.getUTCHours() < 12 ? 7 : 0);
  local.setUTCDate(local.getUTCDate() - daysBack);
  local.setUTCHours(12, 0, 0, 0);
  return local.getTime() + (local.getTime() - easternTime(local.getTime()));
}

export function useLockerRoomHistory({ userId, season, week, games, favorites, items, plays, enabled }: {
  userId: string | null; season: number | null; week: number | null; games: Game[]; favorites: FavoriteTarget[];
  items: DenItem[]; plays: DenPlayItem[]; enabled: boolean;
}) {
  const scope = season && week ? `${userId ?? 'guest'}:${season}:${week}` : '';
  const [state, setState] = useState<HistoryState>({ scope: '', entries: [], loaded: false, error: '' });
  const [fetchError, setFetchError] = useState('');
  const [revision, setRevision] = useState(0);
  const queues = useRef(new Map<string, Map<string, HistoryEntry>>());
  const pending = useRef(new Map<string, HistoryEntry>());
  const observed = useRef(new Map<string, string>());
  const sessionScope = useRef(scope);
  sessionScope.current = scope;
  const context = useRef({ games, favorites, items, plays });
  context.current = { games, favorites, items, plays };

  useEffect(() => {
    let active = true;
    const queue = queues.current.get(scope) ?? new Map<string, HistoryEntry>();
    queues.current.set(scope, queue);
    pending.current = queue;
    observed.current.clear();
    setFetchError('');
    setState({ scope, entries: [], loaded: false, error: '' });
    if (!scope || !season || !week) return;
    const load = async () => {
      try {
        const entries: HistoryEntry[] = [];
        if (userId && supabase) {
          for (let offset = 0; ; offset += 500) {
            const { data, error } = await supabase.from('locker_room_history').select('entry_key,payload,observed_at')
              .eq('user_id', userId).eq('season', season).eq('week', week).order('entry_key').range(offset, offset + 499);
            if (error) throw error;
            const page = (data ?? []).map((row) => ({ key: row.entry_key, payload: row.payload, observed_at: row.observed_at }));
            if (!page.every(isHistoryEntry)) throw new Error('Saved weekly history has an invalid format.');
            entries.push(...page);
            if (page.length < 500) break;
          }
        } else {
          const stored: unknown = JSON.parse(localStorage.getItem(`gamewire:locker:week:${scope}`) ?? '[]');
          if (!Array.isArray(stored) || !stored.every(isHistoryEntry)) throw new Error('Saved weekly history has an invalid format.');
          entries.push(...stored);
        }
        if (active) {
          const merged = mergeHistory(entries, [...queue.values()]);
          merged.forEach((entry) => observed.current.set(entry.key, JSON.stringify(entry.payload)));
          setState({ scope, entries: merged, loaded: true, error: '' });
        }
      } catch (error) {
        console.error('Locker Room weekly history could not load', error);
        if (active) setState({ scope, entries: [], loaded: false, error: 'Weekly history could not load. Check your connection and retry.' });
      }
    };
    void load();
    return () => { active = false; };
  }, [scope, userId, season, week, revision]);

  const loaded = state.scope === scope && state.loaded;
  const incomingKey = JSON.stringify({ items, plays });
  useEffect(() => {
    if (!loaded) return;
    const incoming = activityForWeek([...context.current.items, ...context.current.plays], context.current.games);
    const entries = incoming.flatMap((payload): HistoryEntry[] => {
      const key = `${payload.kind}:${payload.id}:${payload.favoriteKey}`;
      if (observed.current.has(key)) return [];
      return [{ key, payload, observed_at: new Date().toISOString() }];
    });
    if (entries.length) {
      entries.forEach((entry) => { pending.current.set(entry.key, entry); observed.current.set(entry.key, JSON.stringify(entry.payload)); });
      setState((previous) => ({ ...previous, entries: mergeHistory(previous.entries, entries) }));
    }
  }, [scope, loaded, incomingKey]);

  const pollKey = JSON.stringify(games.map((game) => [game.id, game.status]));
  const favoriteKey = JSON.stringify(favorites);
  useEffect(() => {
    if (!scope || !loaded || !enabled) return;
    const controller = new AbortController();
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const relevant = context.current.games.filter((game) => game.status !== 'UPCOMING'
          && context.current.favorites.some((favorite) => favorite.feedPath === game.feedPath
            && ((favorite.type === 'team' ? favorite.id : favorite.teamId) === game.away.id
              || (favorite.type === 'team' ? favorite.id : favorite.teamId) === game.home.id)));
        const entries: HistoryEntry[] = [];
        const results = await Promise.allSettled(relevant.map(async (game) => {
          const players = context.current.favorites.filter((favorite) => favorite.type === 'player' && favorite.feedPath === game.feedPath
            && (favorite.teamId === game.away.id || favorite.teamId === game.home.id) && ['QB', 'RB', 'WR', 'TE'].includes(favorite.position ?? ''));
          if (players.length) {
            const result = await fetchNFLLivePlayerStats(game.feedPath, game.eventId,
              players.flatMap((favorite) => favorite.teamId ? [{ id: favorite.id, teamId: favorite.teamId }] : []), controller.signal);
            players.forEach((favorite) => {
              const stats = result[favorite.id];
              if (!stats || !Object.keys(stats).length) return;
              const payload: PlayerHistory = { kind: 'player', favorite, game, stats };
              const key = `player:${game.id}:${favorite.key}`;
              if (observed.current.get(key) !== JSON.stringify(payload)) entries.push({ key, payload, observed_at: new Date().toISOString() });
            });
          }
          const gameFavorites = context.current.favorites.filter((favorite) => favorite.feedPath === game.feedPath
            && ((favorite.type === 'team' ? favorite.id : favorite.teamId) === game.away.id
              || (favorite.type === 'team' ? favorite.id : favorite.teamId) === game.home.id));
          const result = await fetchNFLFavoritePlays([game], gameFavorites, controller.signal, true);
          result.forEach((play) => {
            const payload: DenPlayItem = { ...play, kind: 'play' };
            const key = `play:${play.id}:${play.favoriteKey}`;
            if (!observed.current.has(key)) entries.push({ key, payload, observed_at: new Date().toISOString() });
          });
          gameFavorites.forEach((favorite) => {
            const payload: DenScoreItem = {
              id: `score:${game.id}:${game.away.score}:${game.home.score}${game.status === 'FINAL' ? ':final' : ''}`,
              kind: 'score', favoriteKey: favorite.key, favoriteName: favorite.name, timestamp: game.date,
              league: game.league, away: game.away, home: game.home, status: game.status, period: game.period, clock: game.clock,
            };
            const key = `score:${payload.id}:${favorite.key}`;
            if (!observed.current.has(key)) entries.push({ key, payload, observed_at: new Date().toISOString() });
          });
        }));
        if (controller.signal.aborted) return;
        entries.forEach((entry) => { pending.current.set(entry.key, entry); observed.current.set(entry.key, JSON.stringify(entry.payload)); });
        if (entries.length) setState((previous) => ({ ...previous, entries: mergeHistory(previous.entries, entries) }));
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') {
          console.error('Locker Room weekly game data could not refresh', failure.reason);
          setFetchError('Some game stats or plays could not refresh. Saved history is still shown. Retry to load missing data.');
        } else setFetchError('');
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Locker Room weekly game data could not refresh', error);
          setFetchError('Game stats or plays could not refresh. Saved history is still shown. Retry to load missing data.');
        }
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (context.current.games.some((game) => game.status === 'LIVE')) void refresh();
    }, 15_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [scope, loaded, enabled, pollKey, favoriteKey, revision]);

  useEffect(() => {
    if (!loaded || !season || !week || !pending.current.size) return;
    const queue = pending.current;
    const batch = [...pending.current.values()];
    let active = true;
    const save = async () => {
      try {
        if (userId && supabase) {
          for (let start = 0; start < batch.length; start += 500) {
            const { error } = await supabase.rpc('save_locker_room_history', {
              archive_season: season, archive_week: week, archive_owner: userId, entries: batch.slice(start, start + 500),
            });
            if (error) throw error;
          }
        } else {
          localStorage.setItem(`gamewire:locker:week:${scope}`, JSON.stringify(state.entries));
        }
        batch.forEach((entry) => {
          if (queue.get(entry.key) === entry) queue.delete(entry.key);
        });
        if (active && sessionScope.current === scope) setState((previous) => previous.error.startsWith('Weekly history could not save')
          ? { ...previous, error: '' } : previous);
      } catch (error) {
        console.error('Locker Room weekly history could not save', error);
        if (active && sessionScope.current === scope) setState((previous) => ({ ...previous, error: 'Weekly history could not save. Keep this page open and retry.' }));
      }
    };
    void save();
    return () => { active = false; };
  }, [scope, loaded, state.entries, userId, season, week]);

  const entries = state.scope === scope ? state.entries : [];
  return {
    items: entries.flatMap((entry): DenItem[] => entry.payload.kind === 'news' || entry.payload.kind === 'score' ? [entry.payload] : []),
    plays: entries.flatMap((entry): DenPlayItem[] => entry.payload.kind === 'play' ? [entry.payload] : []),
    players: entries.flatMap((entry): PlayerHistory[] => entry.payload.kind === 'player' ? [entry.payload] : []),
    loading: !!scope && !loaded && !state.error,
    error: state.scope === scope ? state.error || fetchError : '',
    retry: () => {
      if (pending.current.size) {
        setState((previous) => ({ ...previous, entries: [...previous.entries], error: '' }));
      } else setRevision((value) => value + 1);
    },
  };
}
