import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Candidate } from './services/gamewaire';
import { movePick, orderedTopPicks } from './services/gamewaireOrder';
import type { PickOrder } from './services/gamewaireOrder';
import { supabase } from './services/supabaseClient';
import { notifyPickOrderSaved } from './services/gamewaireOrderRefresh';

export default function GamewairePickOrder({ picks, order, date, refresh, onSave, visibleKeys, renderPick }: {
  picks: Candidate[]; order?: PickOrder; date: string; refresh: () => void; onSave: (order: PickOrder) => void;
  visibleKeys?: string[]; renderPick?: (pick: Candidate, rank: number, orderedKeys: string[]) => ReactNode;
}) {
  const [keys, setKeys] = useState(() => orderedTopPicks(picks, order ? [order] : []).map((pick) => pick.key));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [revision, setRevision] = useState(order?.revision ?? 0);
  const list = useRef<HTMLOListElement>(null);
  const positions = useRef(new Map<string, number>());
  const draftActive = useRef(false);
  useEffect(() => {
    if (!draftActive.current && !dirty && !dragging && (order?.revision ?? 0) >= revision) {
      setKeys(orderedTopPicks(picks, order ? [order] : []).map((pick) => pick.key));
      setRevision(order?.revision ?? 0);
    }
  }, [picks, order, dirty, revision, dragging]);
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const row of list.current?.querySelectorAll<HTMLLIElement>('li[data-pick-key]') ?? []) {
      const key = row.dataset.pickKey;
      if (!key) continue;
      const top = row.offsetTop;
      const previous = positions.current.get(key);
      if (previous !== undefined && previous !== top && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const child of row.children) {
          child.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }], { duration: 160, easing: 'ease-out' });
        }
      }
      next.set(key, top);
    }
    positions.current = next;
  }, [keys]);
  const displayedKeys = visibleKeys ? keys.filter((key) => visibleKeys.includes(key)) : keys;
  const move = (key: string, to: number) => {
    const targetKey = displayedKeys[to];
    if (!targetKey || targetKey === key) return;
    draftActive.current = true;
    setKeys((current) => movePick(current, current.indexOf(key), current.indexOf(targetKey)));
    setDirty(true); setNotice('Order changed. Save to update everyone’s view.'); setError('');
  };
  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (!supabase) throw new Error('Account services are not configured.');
      const { data, error: problem } = await supabase.rpc('gamewaire_save_pick_order', {
        target_date: date, ordered_keys: keys, expected_revision: revision,
      });
      if (problem) throw problem;
      if (!data || typeof data.revision !== 'number') throw new Error('The saved pick order could not be confirmed.');
      setRevision(data.revision); setDirty(false); setNotice('Order saved for everyone.');
      onSave({ game_date: date, pick_keys: keys, revision: data.revision });
      draftActive.current = false;
      notifyPickOrderSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : typeof cause === 'object' && cause && 'message' in cause && typeof cause.message === 'string'
        ? cause.message : 'Could not save pick order. Your changes are still here.');
    } finally { setBusy(false); }
  };
  if (!picks.length) return <p className="gai-note">No published picks or Game Leans to arrange for this date.</p>;
  return <section className="gai-order-editor" aria-label="Order published picks and Game Leans">
    <h4>Reorder published picks · {date}</h4>
    <p className="gai-note">Drag a pick’s three-line handle, then save to update GamewAIre and The Wire for everyone. Top Picks and published Game Leans share this order: choose the top 3 on mobile and top 5 on desktop. Use Up/Down arrow keys on a handle for keyboard ordering.</p>
    <ol ref={list} className={`gai-order-list${dragging ? ' is-sorting' : ''}`}
      onPointerMove={(event) => {
        if (!dragging) return;
        const rows = [...(list.current?.querySelectorAll<HTMLLIElement>('li[data-pick-key]') ?? [])];
        const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest('li[data-pick-key]');
        const target = rows.findIndex((row) => row === hovered);
        if (target >= 0 && target !== displayedKeys.indexOf(dragging)) move(dragging, target);
        if (event.clientY > window.innerHeight - 80) window.scrollBy(0, 12);
        else if (event.clientY < 100) window.scrollBy(0, -12);
      }}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
      onLostPointerCapture={() => setDragging(null)}>{displayedKeys.map((key, index) => {
      const pick = picks.find((candidate) => candidate.key === key);
      if (!pick) return null;
      return <li key={key} data-pick-key={key} className={dragging === key ? 'is-dragging' : ''}>
        <span className="gai-order-number">{index + 1}</span>
        <div className="gai-order-pick">{renderPick ? renderPick(pick, index + 1, displayedKeys) : <><b>{pick.subject} · {pick.market === 'h2h' ? 'ML' : `${pick.side} ${pick.line ?? ''}`}</b><small>{pick.sport} · {pick.away} @ {pick.home}</small></>}</div>
        <button type="button" className="gai-order-handle" disabled={busy} aria-label={`Reorder ${pick.subject}, position ${index + 1} of ${displayedKeys.length}`}
          onKeyDown={(event) => {
            const to = event.key === 'ArrowUp' ? Math.max(0, index - 1) : event.key === 'ArrowDown' ? Math.min(displayedKeys.length - 1, index + 1)
              : event.key === 'Home' ? 0 : event.key === 'End' ? displayedKeys.length - 1 : null;
            if (to !== null) { event.preventDefault(); move(key, to); }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            setDragging(key);
            list.current?.setPointerCapture(event.pointerId);
          }}>
          <span aria-hidden="true"><i /><i /><i /></span>
        </button>
      </li>;
    })}</ol>
    <div className="gai-order-actions"><button disabled={busy || !dirty || !!dragging} onClick={() => void save()}>{busy ? 'Saving…' : 'Save order · 0 credits'}</button>
      <button disabled={busy || !dirty || !!dragging} onClick={() => {
        draftActive.current = false; setKeys(orderedTopPicks(picks, order ? [order] : []).map((pick) => pick.key)); setDirty(false); setError(''); setNotice('');
      }}>Discard changes</button></div>
    {notice && <p role="status" className="gai-note">{notice}</p>}
    {error && <p role="alert" className="feed-warning">{error} <button disabled={busy} onClick={() => {
      draftActive.current = false; setDirty(false); setRevision(order?.revision ?? 0); setError(''); refresh();
    }}>Reload published order</button></p>}
  </section>;
}
