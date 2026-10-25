import { useEffect, useState } from 'react';
import { PickResult } from './AnglePicks';
import { supabase } from './services/supabaseClient';
import { readAngles } from './services/theAngle';
import { angleReviewKey, settledAngleReviews } from './services/angleReviews';
import type { AngleReviewPick } from './services/angleReviews';

export function AngleReviewList({ picks }: { picks: AngleReviewPick[] }) {
  if (!picks.length) return null;
  return <section className="angle-review-picks" aria-label="Settled picks">
    {picks.map((pick) => <div className={`angle-pick angle-pick-${pick.result} angle-settled-pick`} key={angleReviewKey(pick)}>
      <p>{pick.text}</p><PickResult result={pick.result} />
    </div>)}
  </section>;
}

export default function AngleReviewPicker({ picks, storyId, onChange }: {
  picks: AngleReviewPick[]; storyId: string; onChange: (picks: AngleReviewPick[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AngleReviewPick[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError('');
    async function load() {
      if (!supabase) throw new Error('Account services are unavailable.');
      const found: AngleReviewPick[] = [];
      for (let offset = 0; ; offset += 100) {
        const result = await supabase.from('angles').select('*').eq('status', 'published')
          .order('published_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 99)
          .abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
        if (result.error) throw result.error;
        if (!Array.isArray(result.data)) throw new Error('The server returned invalid past picks.');
        found.push(...settledAngleReviews(readAngles(result.data), storyId));
        if (result.data.length < 100) break;
      }
      if (active) setOptions(found);
    }
    void load().catch((cause: unknown) => {
      if (!active) return;
      console.error('Could not load settled picks for review', cause);
      setError('Could not load past settled picks. Reconnect and retry; your selected picks are kept.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [open, storyId, retry]);
  const term = query.trim().toLowerCase();
  const filtered = options.filter((pick) => `${pick.text} ${pick.title} ${pick.matchup} ${pick.game_id} ${pick.season} ${pick.week} ${pick.result}`.toLowerCase().includes(term));
  return <section className="angle-review-picker">
    <h4>Review past settled picks</h4>
    <p>Attach existing Hit or Miss picks from any week or sport. Originals stay unchanged and reviews never count twice in Our Results.</p>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide past picks' : 'Browse past settled picks'}</button>
    {open && <div>
      <label>Search past picks<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Player, team, headline, sport, or week" /></label>
      {loading && <p role="status">Loading settled picks...</p>}
      {error && <p className="auth-error" role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry past picks</button></p>}
      {!loading && !error && !filtered.length && <p>No settled picks match. Settle the original pick in Our Results first.</p>}
      <div className="angle-review-options">{filtered.map((pick) => {
        const selected = picks.some((item) => angleReviewKey(item) === angleReviewKey(pick));
        return <label key={angleReviewKey(pick)} className="angle-review-option">
          <input type="checkbox" checked={selected} disabled={!selected && picks.length >= 20} onChange={() => onChange(selected
            ? picks.filter((item) => angleReviewKey(item) !== angleReviewKey(pick)) : [...picks, pick])} />
          <span><b>{pick.result === 'hit' ? 'Hit' : 'Miss'} · {pick.text}</b><small>{pick.title} · {pick.matchup} · {pick.season} · Week {pick.week}</small></span>
        </label>;
      })}</div>
    </div>}
    <AngleReviewList picks={picks} />
    {picks.map((pick) => <button type="button" key={angleReviewKey(pick)} onClick={() => onChange(picks.filter((item) => angleReviewKey(item) !== angleReviewKey(pick)))}>Remove review: {pick.text}</button>)}
    {picks.length >= 20 && <p role="status">Up to 20 settled picks can be attached per review post.</p>}
  </section>;
}
