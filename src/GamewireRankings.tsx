import { useEffect, useRef, useState } from 'react';
import { loadBotDirectory, loadBotRankings, saveBotRankings } from './services/gamewireBot';
import type { BotDirectory } from './services/gamewireBot';
import { matchRankingPaste } from '../supabase/functions/_shared/gamewireRankings';
import type { RankingList } from '../supabase/functions/_shared/gamewireRankings';

type Scope = Omit<RankingList, 'playerIds' | 'publishedAt'>;
type Entry = { playerId: string; input: string; error: string };
const failure = (cause: unknown) => cause instanceof Error ? cause.message : 'Weekly rankings could not be updated. Retry.';
export default function GamewireRankings() {
  const [open, setOpen] = useState(false), [directory, setDirectory] = useState<BotDirectory | null>(null);
  const [scope, setScope] = useState<Scope | null>(null), [entries, setEntries] = useState<Entry[]>([]);
  const [paste, setPaste] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const load = async (next?: Scope) => {
    if ((dirty || paste.trim()) && !window.confirm('Discard the unpublished ranking changes and load this list?')) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const timeout = window.setTimeout(() => request.abort(), 30_000);
    setBusy(true); setError(''); setNotice('');
    try {
      const roster = directory ?? await loadBotDirectory(request.signal);
      if (request.signal.aborted) return;
      setDirectory(roster);
      const selected = next ?? { season: roster.season, week: Math.min(roster.week, 18), format: 'ppr', position: 'QB' };
      const saved = await loadBotRankings(selected, request.signal);
      if (request.signal.aborted) return;
      setScope(selected); setEntries(saved.playerIds.map((playerId) => ({ playerId, input: '', error: '' })));
      setPaste(''); setSearch(''); setDirty(false);
      setNotice(saved.publishedAt ? `Published ${new Date(saved.publishedAt).toLocaleString()}.` : 'No list published for this week and scoring format.');
    } catch (cause) {
      if (controller.current === request) setError(request.signal.aborted ? 'Ranking editor timed out. Retry; your draft is unchanged.' : failure(cause));
    } finally { window.clearTimeout(timeout); if (controller.current === request) setBusy(false); }
  };
  const publish = async () => {
    if (!scope) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const timeout = window.setTimeout(() => request.abort(), 30_000);
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await saveBotRankings({ ...scope, playerIds: entries.map((entry) => entry.playerId) }, request.signal);
      if (request.signal.aborted) return;
      setDirty(false); setNotice(`Published ${saved.playerIds.length} ${scope.position} rankings for Week ${scope.week}. Refresh a player outlook to use the new list.`);
    } catch (cause) { setError(request.signal.aborted ? 'Publishing timed out. Reload to verify whether it completed; your draft is retained.' : failure(cause)); }
    finally { window.clearTimeout(timeout); if (controller.current === request) setBusy(false); }
  };
  const edit = (next: Entry[]) => { setEntries(next); setDirty(true); setNotice(''); };
  const move = (index: number, offset: number) => {
    const next = [...entries]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; edit(next);
  };
  const available = directory?.players.filter((player) => player.position === scope?.position && !entries.some((entry) => entry.playerId === player.id)
    && `${player.name} ${player.teamAbbr} ${player.team}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  const addPlayer = (playerId: string) => {
    if (busy || entries.length >= 30 || entries.some((entry) => entry.playerId === playerId)) return;
    edit([...entries, { playerId, input: '', error: '' }]); setSearch(''); searchInput.current?.focus();
  };
  return <details className="gai-ranking-editor" onToggle={(event) => {
    const expanded = event.currentTarget.open; setOpen(expanded);
    if (expanded && !directory && !busy) void load();
  }}>
    <summary>Admin · Weekly top-30 player rankings</summary>
    {open && <div>
      <p>Publish your weekly position order for Player Lab Start/Sit guidance and a bounded editorial adjustment to estimates. Lists are separate for each scoring format. You may publish fewer than 30; unlisted players are not automatically Sit.</p>
      {directory?.warnings.map((warning) => <p key={warning} className="feed-warning">{warning}</p>)}
      {!scope && !busy && <button onClick={() => void load()}>Load ranking editor</button>}
      {scope && <fieldset disabled={busy}><legend>Weekly ranking list · {scope.season}</legend>
        <label>Week<select value={scope.week} onChange={(event) => void load({ ...scope, week: Number(event.target.value) })}>
          {Array.from({ length: 18 }, (_, index) => <option key={index + 1} value={index + 1}>Week {index + 1}</option>)}</select></label>
        <label>Scoring<select value={scope.format} onChange={(event) => void load({ ...scope, format: event.target.value as Scope['format'] })}>
          <option value="ppr">PPR</option><option value="half">Half PPR</option><option value="standard">Standard</option></select></label>
        <label>Position<select value={scope.position} onChange={(event) => void load({ ...scope, position: event.target.value as Scope['position'] })}>
          {(['QB', 'RB', 'WR', 'TE'] as const).map((position) => <option key={position}>{position}</option>)}</select></label>
        <button type="button" onClick={() => void load(scope)}>Reload saved list</button>
      </fieldset>}
      {scope && directory && <fieldset disabled={busy}><legend>Ranked players · {dirty ? 'Unpublished changes' : 'Saved list'}</legend>
        <div className="gai-ranking-quick-add">
          <label htmlFor="gai-ranking-search">{entries.length >= 30 ? `${scope.position} top 30 complete` : `Add your next ${scope.position} · Rank #${entries.length + 1}`}
            <input id="gai-ranking-search" ref={searchInput} type="search" value={search} disabled={entries.length >= 30}
              placeholder="Type a player name or team…" autoComplete="off" aria-controls="gai-ranking-matches"
              onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); if (available.length === 1) addPlayer(available[0].id); }
              }} />
          </label>
          <p>{entries.length}/30 ranked · Search, then tap a name to add. Selected players are hidden from results. Use Up/Down to reorder.</p>
          {entries.length >= 30 ? <p role="status">Your top 30 is full. Remove a player to add someone else.</p>
            : search.trim() && <div id="gai-ranking-matches" className="gai-ranking-matches" role="group" aria-label="Players to add">
              {available.slice(0, 10).map((player) => <button key={player.id} type="button" onClick={() => addPlayer(player.id)}>
                <span>{player.name}<small>{player.teamAbbr} · {player.position}</small></span><b>Add #{entries.length + 1}</b>
              </button>)}
              {!available.length && <p role="status">No unranked {scope.position} matches. Try another name or team.</p>}
              {available.length > 10 && <p>Showing 10 of {available.length} matches. Keep typing to narrow the results.</p>}
            </div>}
        </div>
        <label className="gai-ranking-paste">Paste player names in rank order
          <textarea rows={5} value={paste} placeholder={'1. Player name\n2. Player name TEAM'} onChange={(event) => { setPaste(event.target.value); setNotice(''); }} /></label>
        <p>Already have a list? Paste up to 30 names, one per line (numbering optional). Matching replaces the draft below; review before publishing.</p>
        <button type="button" disabled={!paste.trim()} onClick={() => {
          try { edit(matchRankingPaste(paste, directory.players, scope.position)); setPaste(''); setError(''); }
          catch (cause) { setError(failure(cause)); }
        }}>Match pasted list</button>
        <ol className="gai-ranking-list">{entries.map((entry, index) => <li key={index}>
          <label>#{index + 1}
            {entry.playerId ? <span className="gai-ranking-player">{directory.players.find((player) => player.id === entry.playerId)?.name ?? entry.playerId}
              <small>{directory.players.find((player) => player.id === entry.playerId)?.teamAbbr}</small></span>
            : <select aria-label={`Rank ${index + 1} player`} value={entry.playerId} onChange={(event) => edit(entries.map((row, i) => i === index ? { playerId: event.target.value, input: '', error: '' } : row))}>
              <option value="">Choose {scope.position}</option>
              {directory.players.filter((player) => player.position === scope.position).map((player) =>
                <option key={player.id} value={player.id}>{player.name} · {player.teamAbbr}</option>)}
            </select>}
            {entry.error && <small className="feed-warning">{entry.input}: {entry.error}</small>}
          </label>
          <div><button type="button" aria-label={`Move rank ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>Up</button>
            <button type="button" aria-label={`Move rank ${index + 1} down`} disabled={index === entries.length - 1} onClick={() => move(index, 1)}>Down</button>
            <button type="button" aria-label={`Remove rank ${index + 1}`} onClick={() => edit(entries.filter((_, i) => i !== index))}>Remove</button></div>
        </li>)}</ol>
        {paste.trim() && <p role="status">Match your pasted list or clear the paste box before publishing.</p>}
        <button type="button" disabled={!dirty || !!paste.trim() || !entries.length || entries.some((entry) => !entry.playerId) || new Set(entries.map((entry) => entry.playerId)).size !== entries.length}
          onClick={() => void publish()}>Publish Week {scope.week} {scope.position} rankings ({entries.length}/30)</button>
        {new Set(entries.map((entry) => entry.playerId)).size !== entries.length && <p role="alert">Remove duplicate players before publishing.</p>}
      </fieldset>}
      {busy && <p role="status">Updating weekly rankings…</p>}
      {error && <p role="alert" className="feed-warning">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>}
  </details>;
}
