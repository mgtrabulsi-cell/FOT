import { useEffect, useRef, useState } from 'react';
import AnglePicks from './AnglePicks';
import { supabase } from './services/supabaseClient';
import { activeAnglePicks, angleSport, angleSports, readAngles } from './services/theAngle';
import { nflSport } from './services/anglePicks';
import { pickCategories, pickCategoryLabels } from './services/anglePicks';
import type { PickCategory } from './services/anglePicks';
import { manualActiveBetSports, readManualActiveBets, writeManualActiveBets } from './services/activeBoard';
import type { ManualActiveBet } from './services/activeBoard';
import { readRenderSnapshot, saveRenderSnapshot } from './services/renderSnapshots';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';

export default function ActiveAngleBets({ active, revision, userId, defaultOpen = false }: {
  active: boolean; revision: string; userId?: string; defaultOpen?: boolean;
}) {
  const [saved] = useState(() => readRenderSnapshot('activeBets', 'last'));
  const [rows, setRows] = useState(saved?.rows ?? []);
  const [loaded, setLoaded] = useState(!!saved);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [admin, setAdmin] = useState(false);
  const [manual, setManual] = useState<ManualActiveBet[]>(() => userId ? readManualActiveBets(userId) : []);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [sport, setSport] = useState('NFL');
  const [category, setCategory] = useState<PickCategory>('straight');
  const [matchup, setMatchup] = useState('');
  const [addError, setAddError] = useState('');
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
    if (!userId || !supabase) { setAdmin(false); return; }
    let current = true;
    void Promise.resolve(supabase.from('livewire_roles').select('role').eq('user_id', userId).maybeSingle())
      .then(({ data }) => { if (current) setAdmin(data?.role === 'owner' || data?.role === 'admin'); })
      .catch(() => { if (current) setAdmin(false); });
    return () => { current = false; };
  }, [userId]);
  useEffect(() => { setManual(userId ? readManualActiveBets(userId) : []); }, [userId]);
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
  const saveManual = (next: ManualActiveBet[]) => {
    if (!userId) return;
    writeManualActiveBets(userId, next);
    setManual(next);
  };
  const addManual = () => {
    const selection = text.trim();
    if (!userId || !selection) { setAddError('Enter the bet before adding it.'); return; }
    saveManual([{ id: crypto.randomUUID(), text: selection, sport, category, matchup: matchup.trim(),
      createdAt: new Date().toISOString() }, ...manual]);
    setText(''); setMatchup(''); setAddError(''); setAdding(false);
  };
  const picks = activeAnglePicks(rows);
  const total = manual.length + picks.length;
  return <details className="angle-active-bets" open={defaultOpen || undefined}>
    <summary>Active bets <span>{loaded ? total : '...'}</span><small>All sports · All weeks · Unsettled only</small></summary>
    {!loaded && !error && <p role="status">Loading active bets...</p>}
    {error && <p className="feed-warning" role="alert">{error} <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry active bets</button></p>}
    {admin && <div className="active-bet-add">
      {!adding ? <button type="button" onClick={() => setAdding(true)}>Add an active bet</button>
        : <form onSubmit={(event) => { event.preventDefault(); addManual(); }}>
          <label>Bet / selection<textarea maxLength={500} value={text} onChange={(event) => setText(event.target.value)} required /></label>
          <div className="active-bet-add-fields">
            <label>Sport<select value={sport} onChange={(event) => setSport(event.target.value)}>
              {manualActiveBetSports.map((name) => <option key={name}>{name}</option>)}</select></label>
            <label>Type<select value={category} onChange={(event) => {
              if (pickCategories.some((value) => value === event.target.value)) setCategory(event.target.value as PickCategory);
            }}>{pickCategories.map((value) => <option key={value} value={value}>{pickCategoryLabels[value]}</option>)}</select></label>
            <label>Matchup / slate (optional)<input maxLength={80} value={matchup} onChange={(event) => setMatchup(event.target.value)} /></label>
          </div>
          {addError && <p role="alert" className="feed-warning">{addError}</p>}
          <div className="active-bet-add-actions">
            <button type="submit">Save active bet</button>
            <button type="button" onClick={() => { setAdding(false); setAddError(''); }}>Cancel</button>
          </div>
        </form>}
    </div>}
    {loaded && !total && <p>No active bets. No unsettled admin picks right now.</p>}
    {!!manual.length && <ul aria-label="Manually added active bets">{manual.map((bet, index) => <li key={bet.id}>
      <div className="active-bet-meta"><strong>Added {index + 1}</strong><span>{bet.sport}{bet.matchup ? ` · ${bet.matchup}` : ''}</span>
        {admin && <button type="button" onClick={() => saveManual(manual.filter((row) => row.id !== bet.id))}>Remove</button>}</div>
      <AnglePicks picks={[{ id: bet.id, text: bet.text, result: 'pending', category: bet.category }]}
        emoji={[nflSport, ...angleSports].find((row) => row.key === bet.sport || row.label === bet.sport)?.emoji} />
    </li>)}</ul>}
    {!!picks.length && <ul aria-label="Unsettled admin picks">{picks.map(({ story, pick }, index) => <li key={`${story.id}:${pick.id}`}>
      <div className="active-bet-meta"><strong>Pick {index + 1}</strong><span>{angleSport(story.game_id).label} · {story.matchup} · Week {story.week}, {story.season}</span></div>
      <AnglePicks picks={[pick]} emoji={angleSport(story.game_id).emoji} />
    </li>)}</ul>}
  </details>;
}
