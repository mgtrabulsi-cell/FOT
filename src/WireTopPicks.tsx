import { useEffect, useState } from 'react';
import { PickCard } from './Gamewaire';
import { orderedTopPicks, wirePickLimit } from './services/gamewaireOrder';
import type { PickOrder } from './services/gamewaireOrder';
import type { PublishedGame, Sport } from './services/gamewaire';
import type { Game } from './services/sportsData';
import { supabase } from './services/supabaseClient';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';
import { subscribePickOrderRefresh } from './services/gamewaireOrderRefresh';

export default function WireTopPicks({ games, sport, userId, desktop }: { games: Game[]; sport: Sport; userId?: string; desktop: boolean }) {
  const [reports, setReports] = useState<PublishedGame[]>([]);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [orders, setOrders] = useState<PickOrder[]>([]);
  const eventIds = [...new Set(games.filter((game) => game.status !== 'FINAL').map((game) => game.eventId))].sort().join(',');
  useEffect(() => subscribeForegroundRefresh(() => setRetry((value) => value + 1)), []);
  useEffect(() => subscribePickOrderRefresh(() => setRetry((value) => value + 1)), []);
  useEffect(() => {
    if (!userId || !eventIds) { setReports([]); setLoaded(true); return; }
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    const load = async () => {
      if (!supabase) throw new Error('Account services are not configured.');
      // Odds-provider IDs differ from ESPN IDs, so match the published candidates' saved ESPN identity.
      const [{ data, error: problem }, orderResult] = await Promise.all([
        supabase.from('gamewaire_publications').select('*')
          .eq('sport', sport).order('event_start', { ascending: false }).limit(200).abortSignal(controller.signal),
        supabase.from('gamewaire_pick_orders').select('*')
          .order('game_date', { ascending: false }).limit(200).abortSignal(controller.signal),
      ]);
      if (problem) throw problem;
      if (orderResult.error) throw orderResult.error;
      if (!controller.signal.aborted) { setReports(data as PublishedGame[]); setOrders(orderResult.data as PickOrder[]); setLoaded(true); setError(''); }
    };
    void load().catch((cause: unknown) => {
      if (!active) return;
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Published Top Picks could not load.');
      } else setError('Published Top Picks timed out. Retry to update.');
    }).finally(() => window.clearTimeout(timeout));
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'hidden' && navigator.onLine) setRetry((value) => value + 1);
    }, 60_000);
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); window.clearInterval(poll); };
  }, [userId, sport, eventIds, retry]);
  const activeIds = new Set(eventIds.split(','));
  const picks = orderedTopPicks(reports.flatMap((report) => report.picks).filter((pick) =>
    !!pick.identifiers?.espnEventId && activeIds.has(pick.identifiers.espnEventId)), orders).slice(0, wirePickLimit(desktop));
  return <aside className="gai-panel wire-top-picks" aria-label="GamewAIre Top Picks">
    <header><span className="eyebrow">PUBLISHED PICKS · {sport}</span>
      <h2><span className="gamewaire-name">Gamew<strong>AI</strong>re</span></h2><h3>Top Picks</h3></header>
    {!userId ? <p>Sign in to view published GamewAIre picks.</p> : <>
      {error && <p role="alert" className="feed-warning">{error} <button onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
      {!loaded && !error && <p role="status">Loading published Top Picks…</p>}
      {loaded && !picks.length && <p>No published Top Picks for the unfinished games on this scoreboard.</p>}
      <div className="gai-picks">{picks.map((pick, index) => <PickCard key={pick.key} pick={pick} rank={index + 1} />)}</div>
    </>}
    <a className="wire-picks-link" href="#gamewaire">Open GamewAIre</a>
    <p className="gai-note">Published selections only. Estimates are unvalidated, not guarantees or betting recommendations.</p>
  </aside>;
}
