import { useEffect, useRef, useState } from 'react';
import AnglePicks from './AnglePicks';
import { supabase } from './services/supabaseClient';
import { activeAnglePicks, angleSport, readAngles } from './services/theAngle';
import { readRenderSnapshot, saveRenderSnapshot } from './services/renderSnapshots';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';

export default function ActiveAngleBets({ active, revision }: { active: boolean; revision: string }) {
  const [saved] = useState(() => readRenderSnapshot('activeBets', 'last'));
  const [rows, setRows] = useState(saved?.rows ?? []);
  const [loaded, setLoaded] = useState(!!saved);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const activeRef = useRef(active);
  const previousActive = useRef(active);
  const loadedRef = useRef(loaded);
  activeRef.current = active;
  loadedRef.current = loaded;
  useEffect(() => {
    if (active && !previousActive.current && loadedRef.current) setRefresh((value) => value + 1);
    previousActive.current = active;
  }, [active]);
  useEffect(() => subscribeForegroundRefresh(() => {
    if (activeRef.current) setRefresh((value) => value + 1);
  }), []);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    async function load() {
      if (!supabase) throw new Error('Account services are unavailable.');
      const next = [];
      for (let offset = 0; ; offset += 100) {
        const result = await supabase.from('angles').select('*').eq('status', 'published')
          .contains('picks', JSON.stringify([{ result: 'pending' }]))
          .order('published_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false })
          .range(offset, offset + 99).abortSignal(signal);
        if (result.error) throw result.error;
        next.push(...readAngles(result.data));
        if (!current) return;
        if (result.data.length < 100) break;
      }
      setRows(next); setLoaded(true); setError('');
      saveRenderSnapshot('activeBets', 'last', { rows: next });
    }
    void load().catch((cause: unknown) => {
      if (!current) return;
      console.error('Could not refresh active bets', cause);
      setError('Could not refresh active bets. Saved picks may have changed; retry for the latest settlements.');
    });
    const timer = window.setInterval(() => {
      if (activeRef.current && document.visibilityState !== 'hidden') setRefresh((value) => value + 1);
    }, 30_000);
    return () => { current = false; controller.abort(); window.clearInterval(timer); };
  }, [revision, refresh]);
  const picks = activeAnglePicks(rows);
  return <details className="angle-active-bets">
    <summary>Active bets <span>{loaded ? picks.length : '...'}</span><small>All sports · All weeks · Unsettled only</small></summary>
    {!loaded && !error && <p role="status">Loading active bets...</p>}
    {error && <p className="feed-warning" role="alert">{error} <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry active bets</button></p>}
    {loaded && !picks.length && <p>No active bets. No unsettled admin picks right now.</p>}
    {!!picks.length && <ul aria-label="Unsettled admin picks">{picks.map(({ story, pick }) => <li key={`${story.id}:${pick.id}`}>
      <AnglePicks picks={[pick]} emoji={angleSport(story.game_id).emoji} />
      <a href={`#analyst-desk/story/${story.id}`}>{angleSport(story.game_id).label} · {story.matchup} · Week {story.week}, {story.season}</a>
    </li>)}</ul>}
  </details>;
}
