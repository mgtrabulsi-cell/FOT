import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Check, X } from 'lucide-react';
import { supabase } from './services/supabaseClient';
import { anglePicks, angleSport, angleSportRecords, publishedAnglePicks, readAngles } from './services/theAngle';
import type { Angle, AnglePick, AngleSportKey } from './services/theAngle';
import { PickResult } from './AnglePicks';

const message = (cause: unknown) => cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
  ? cause.message : 'Could not load results. Please retry.';

export default function OurResults({ user }: { user: User | null }) {
  const [rows, setRows] = useState<Angle[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [accessError, setAccessError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selectedSport, setSelectedSport] = useState<AngleSportKey | null>(null);

  useEffect(() => {
    let active = true;
    if (!user || !supabase) { setAdmin(false); return; }
    void Promise.resolve(supabase.from('livewire_roles').select('role').eq('user_id', user.id).maybeSingle()).then(({ data, error }) => {
      if (error) throw error;
      if (active) { setAdmin(data?.role === 'owner' || data?.role === 'admin'); setAccessError(''); }
    }).catch((cause: unknown) => { if (active) { setAdmin(false); setAccessError(`Could not check result editing access: ${message(cause)}`); } });
    return () => { active = false; };
  }, [user?.id, refresh]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) throw new Error('Account services are not configured.');
      const next: Angle[] = [];
      for (let offset = 0; ; offset += 500) {
        const response = await supabase.from('angles').select('*').eq('status', 'published')
          .order('published_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).range(offset, offset + 499);
        if (response.error) throw response.error;
        next.push(...readAngles(response.data));
        if (!active) return;
        if (response.data.length < 500) break;
      }
      setRows(next); setLoaded(true); setError('');
    }
    void load().catch((cause: unknown) => { if (active) setError(`Could not refresh results: ${message(cause)}`); });
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id, refresh]);

  async function grade(story: Angle, pickId: string, result: AnglePick['result']) {
    if (!supabase || !admin || busy) return;
    setBusy(true); setActionError(''); setNotice('');
    try {
      const response = await supabase.from('angles').update({
        picks: anglePicks(story).map((pick) => pick.id === pickId ? { ...pick, result } : pick),
        revision: story.revision + 1,
      }).eq('id', story.id).eq('revision', story.revision).eq('status', 'published').select('*').maybeSingle();
      if (response.error) throw response.error;
      if (!response.data) throw new Error('Another admin changed or unpublished this story. Results are refreshing; check the latest version before trying again.');
      const saved = readAngles([response.data])[0];
      setRows((previous) => previous.map((row) => row.id === saved.id ? saved : row));
      setNotice('Pick result saved.');
    } catch (cause) {
      setActionError(message(cause));
      setRefresh((value) => value + 1);
    } finally { setBusy(false); }
  }
  const picks = publishedAnglePicks(rows);
  const records = angleSportRecords(rows);
  const sportLabel = records.find((sport) => sport.key === selectedSport)?.label;
  const visiblePicks = selectedSport ? picks.filter(({ story }) => angleSport(story.game_id).key === selectedSport) : picks;
  return <section className="angle-panel results-panel" aria-label="Our Results">
    <p className="angle-disclaimer">Results are marked by admins. Editorial opinions, not betting recommendations.</p>
    {accessError && <p className="feed-warning" role="status">{accessError}</p>}
    {error && <p className="feed-warning" role="alert">{error} <button onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
    {actionError && <p className="feed-warning" role="alert">{actionError}</p>}
    {notice && <p className="angle-notice" role="status">{notice}</p>}
    {!loaded && !error && <p role="status">Loading results...</p>}
    {loaded && <details className="results-records">
      <summary>
        <span>Overall record</span>
        <strong><span className="results-record-wins">{picks.filter(({ pick }) => pick.result === 'hit').length} Wins</span>
          <span aria-hidden="true"> - </span>
          <span className="results-record-losses">{picks.filter(({ pick }) => pick.result === 'miss').length} Losses</span></strong>
        <small>Record by sport</small>
      </summary>
      <p>All published picks across all weeks. Hit counts as a win; Missed counts as a loss. Pending picks are excluded.</p>
      <table aria-label="Admin-reported wins and losses by sport">
        <thead><tr><th scope="col">Sport</th><th scope="col">Wins</th><th scope="col">Losses</th></tr></thead>
        <tbody>{records.map((sport) => <tr key={sport.key} className={selectedSport === sport.key ? 'results-sport-selected' : undefined}>
          <th scope="row"><button type="button" className="results-sport-filter" aria-pressed={selectedSport === sport.key} aria-controls="results-picks-feed" onClick={() => setSelectedSport(sport.key)}><span className="angle-sport-emoji" aria-hidden="true">{sport.emoji}</span>{sport.label}</button></th>
          <td className="results-record-wins">{sport.wins}</td>
          <td className="results-record-losses">{sport.losses}</td>
        </tr>)}</tbody>
      </table>
    </details>}
    {loaded && <div className="results-feed-filter">
      <p role="status">{sportLabel ? `${sportLabel} picks` : 'All sports'} · {visiblePicks.length} {visiblePicks.length === 1 ? 'pick' : 'picks'} · All weeks</p>
      {selectedSport && <button type="button" onClick={() => setSelectedSport(null)}>Show all sports</button>}
    </div>}
    {loaded && !picks.length && <p className="angle-empty">No published Admin picks yet. Picks added to The Angle will appear here individually.</p>}
    {loaded && picks.length > 0 && !visiblePicks.length && <p className="angle-empty">No published {sportLabel} picks yet.</p>}
    <div className="results-stories" id="results-picks-feed">{visiblePicks.map(({ story, pick }) => <article className="angle-card" key={`${story.id}:${pick.id}`}>
      <div className={`angle-pick results-pick-${pick.result}`}>
        <div className="angle-pick-heading"><span className="results-pick-label"><span className="angle-sport-emoji" aria-hidden="true">{angleSport(story.game_id).emoji}</span>Admin pick · Opinion</span><PickResult result={pick.result} /></div>
        <h3 className="results-pick-text">{pick.text}</h3>
      </div>
      <h4>{story.title}</h4><p className="angle-matchup">{angleSport(story.game_id).key === 'NFL' ? '' : `${angleSport(story.game_id).label} · `}{story.matchup} · {story.season} · Week {story.week}</p>
      <a href={`#analyst-desk/story/${story.id}`}>View story</a>
      {admin && <div className="angle-actions" role="group" aria-label={`Result for pick: ${pick.text}`}>
        {(['hit', 'miss', 'pending'] as const).map((result) => <button key={result} className={`grade-${result}`} aria-pressed={pick.result === result} disabled={busy} onClick={() => void grade(story, pick.id, result)}>{result === 'hit' ? <Check size={18} aria-hidden="true" /> : result === 'miss' ? <X size={18} aria-hidden="true" /> : null}{result === 'hit' ? 'Mark hit' : result === 'miss' ? 'Mark missed' : 'Reset to pending'}</button>)}
      </div>}
    </article>)}</div>
  </section>;
}
