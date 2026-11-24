import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { loadBotDirectory, readDirectorySnapshot } from './services/gamewireBot';
import type { BotFormat, BotReport } from './services/gamewireBot';
import { loadNBAPlayerLabDirectory, readNBAPlayerLabDirectory } from './services/nbaPlayerLab';
import { findLabPlayers, labFollowup, labPlayerKey, loadLabAnswer, startOpinion } from './services/playerLabChat';
import { isHitQuestion, isStartQuestion, teamHitReport } from './services/playerLabResearch';
import type { LabAnswer, LabPlayer } from './services/playerLabChat';
import { NBAPlayerCard } from './PlayerLabCards';
import { subscribeRenderSnapshots } from './services/renderSnapshots';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';

type Message = { id: number; role: 'user' | 'assistant'; text: string[]; player?: LabPlayer; answer?: LabAnswer; choices?: LabPlayer[]; question?: string };
const initialPlayers = (): LabPlayer[] => {
  const nfl = readDirectorySnapshot(), nba = readNBAPlayerLabDirectory();
  return [...(nfl?.players.map(player => ({ sport: 'NFL' as const, player })) ?? []),
    ...(nba ? nba.players.map(player => ({ sport: 'NBA' as const, player, season: nba.season })) : [])];
};
export default function PlayerLabChat({ renderNFL, initiallyOpen = false }: { renderNFL: (report: BotReport, remove: () => void) => ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen), [input, setInput] = useState(''), [players, setPlayers] = useState(initialPlayers);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<LabPlayer | null>(null), [format, setFormat] = useState<BotFormat>('ppr');
  const [loadingDirectory, setLoadingDirectory] = useState(false), [busy, setBusy] = useState(false), [issues, setIssues] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const nextId = useRef(0), request = useRef<AbortController | null>(null), pending = useRef(false), end = useRef<HTMLDivElement>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; pending.current = false; }, []);
  useEffect(() => subscribeRenderSnapshots(() => {
    const saved = initialPlayers();
    setPlayers(previous => [...new Map([...previous, ...saved].map(player => [labPlayerKey(player), player])).values()]);
  }, { kind: 'nbaRoster' }), []);
  useEffect(() => {
    if (!open) return;
    return subscribeForegroundRefresh(() => { if (!pending.current) setRevision(value => value + 1); });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController();
    const failures: string[] = [];
    const timer = setTimeout(() => { controller.abort(); if (active) {
      setLoadingDirectory(false); setIssues(previous => [...previous, 'Player search refresh timed out. Saved players remain available; use Refresh players.']);
    } }, 90_000);
    setLoadingDirectory(true); setIssues([]);
    function merge(rows: LabPlayer[], sport: LabPlayer['sport']) {
      if (!active || controller.signal.aborted) return;
      setPlayers(previous => [...new Map([...previous.filter(row => row.sport !== sport), ...rows].map(row => [labPlayerKey(row), row])).values()]);
    }
    const nfl = loadBotDirectory(controller.signal).then(result => {
      merge(result.players.map(player => ({ sport: 'NFL', player })), 'NFL');
      failures.push(...result.warnings.map(issue => `NFL: ${issue}`));
    }, cause => { if (!controller.signal.aborted) failures.push(`NFL search: ${cause instanceof Error ? cause.message : 'Unavailable'}`); });
    const nba = loadNBAPlayerLabDirectory(controller.signal, result => {
      merge(result.players.map(player => ({ sport: 'NBA', player, season: result.season })), 'NBA');
    }).then(result => { failures.push(...result.issues.map(issue => `NBA: ${issue}`)); },
      cause => { if (!controller.signal.aborted) failures.push(`NBA search: ${cause instanceof Error ? cause.message : 'Unavailable'}`); });
    void Promise.all([nfl, nba]).finally(() => {
      clearTimeout(timer);
      if (active && !controller.signal.aborted) { setLoadingDirectory(false); setIssues(failures); }
    });
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [open, revision]);
  useEffect(() => {
    if (open && messages.length) end.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [open, messages.length, busy]);
  function append(message: Omit<Message, 'id'>) {
    const id = ++nextId.current;
    setMessages(previous => [...previous, { ...message, id }]);
  }
  async function answer(question: string, entries: LabPlayer[]) {
    if (pending.current) return;
    const controller = new AbortController(); request.current = controller; pending.current = true; setBusy(true);
    const timer = setTimeout(() => {
      controller.abort();
      if (request.current === controller) {
        append({ role: 'assistant', text: ['Player analysis timed out. Your conversation is kept; retry the question.'] });
        request.current = null; pending.current = false; setBusy(false);
      }
    }, 75_000);
    try {
      if (!entries.length) {
        const hitRates = await teamHitReport(question, controller.signal);
        if (!controller.signal.aborted) append({ role: 'assistant', text: [`${hitRates.name}: last ${hitRates.request.games} completed games. Historical hit rates are not forecast probabilities.`], answer: { text: [], hitRates } });
        return;
      }
      const results = await Promise.allSettled(entries.map(async entry => ({ entry, response: await loadLabAnswer(entry, question, format, controller.signal) })));
      if (controller.signal.aborted) return;
      for (let index = 0; index < results.length; index++) {
        const result = results[index], entry = entries[index];
        if (result.status === 'fulfilled') append({ role: 'assistant', player: entry, answer: result.value.response, text: result.value.response.text });
        else append({ role: 'assistant', player: entry, text: [`${entry.player.name}'s analysis could not load: ${result.reason instanceof Error ? result.reason.message : 'Source unavailable'}. Retry this question.`] });
      }
      if (entries.length === 1) setSelected(entries[0]);
      else {
        setSelected(null);
        if (isStartQuestion(question)) {
          if (results.some(result => result.status === 'rejected')) append({ role: 'assistant', text: ['One or more player reports failed. I cannot fairly recommend a starter until every named player has a supported projection.'] });
          else {
            const answers = results.flatMap(result => result.status === 'fulfilled' ? [result.value.response] : []);
            const text = await startOpinion(answers, format, controller.signal);
            if (!controller.signal.aborted) append({ role: 'assistant', text });
          }
        } else append({ role: 'assistant', text: ['Players are shown using their own sport and scoring context. Name a player in your follow-up to choose one.'] });
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        console.error('Player Lab research request failed', cause);
        append({ role: 'assistant', text: [cause instanceof Error ? cause.message : 'Research could not load. Retry this question.'] });
      }
    } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; pending.current = false; setBusy(false); } }
  }
  function send() {
    const question = input.trim();
    if (!question || pending.current) return;
    setInput(''); append({ role: 'user', text: [question] });
    if (isStartQuestion(question) || /\b(?:compare|vs|versus)\b/i.test(question)) {
      const names = question.split(/\s*(?:,|\bor\b|\band\b|\bvs\.?\b|\bversus\b)\s*/i).filter(name => name.trim());
      const groups = names.map(name => findLabPlayers(name, players));
      const entries = [...new Map(groups.flat().map(player => [labPlayerKey(player), player])).values()];
      if (isStartQuestion(question) && groups.length === 1 && entries.length === 1) { void answer(question, entries); return; }
      if (groups.some(group => group.length !== 1) || entries.length < 2) {
        append({ role: 'assistant', text: ['Name each player clearly, separated by “or” or commas—for example, “Should I start Tee Higgins, Ja’Marr Chase or A.J. Brown?” Ambiguous or unmatched names are not skipped.'] }); return;
      }
      void answer(question, entries); return;
    }
    const matches = findLabPlayers(question, players);
    if (matches.length === 1) { void answer(question, matches); return; }
    if (matches.length === 2 && /\b(compare|vs|versus|and)\b/i.test(question)) { void answer(question, matches); return; }
    if (matches.length) {
      append({ role: 'assistant', text: ['Which player did you mean?'], choices: matches.slice(0, 10), question }); return;
    }
    if (selected && labFollowup(question)) { void answer(question, [selected]); return; }
    if (isHitQuestion(question)) { void answer(question, []); return; }
    append({ role: 'assistant', text: [loadingDirectory ? 'Player lists are still refreshing. Try a full name in a moment, or select a saved player below.' : 'Include an NFL or NBA player’s full name or surname. I can explain recorded stats, matchup projections, availability and supported stat lines.'],
      choices: players.filter(entry => `${entry.player.name} ${entry.sport}`.toLowerCase().includes(question.toLowerCase())).slice(0, 8), question });
  }
  const suggestions = input.trim().length >= 2 ? findLabPlayers(input, players).slice(0, 8) : [];
  return <section className="gwb" aria-label="GamewAIre player analysis">
    <header className="gwb-chat-heading"><div><span className="gwb-hero-kicker">NFL + NBA / ONE CONVERSATION</span><h3>GamewAIre Player Lab</h3>
      <p>Player cards, projections, hit rates and start/sit advice. NFL + NBA in one conversation.</p></div><button type="button" aria-expanded={open} aria-controls="gwb-chat-panel" onClick={() => setOpen(value => !value)}>{open ? 'Close chat' : 'Open chat'}</button></header>
    {open && <div id="gwb-chat-panel" className="gwb-chat-panel">
      <div className="gwb-chat-tools"><label>NFL scoring<select value={format} disabled={busy} onChange={event => {
        const value = event.target.value; if (value === 'ppr' || value === 'half' || value === 'standard') setFormat(value);
      }}><option value="ppr">PPR</option><option value="half">Half PPR</option><option value="standard">Standard</option></select></label>
        <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh players</button>
        <button type="button" disabled={busy} onClick={() => { setMessages([]); setSelected(null); }}>New conversation</button></div>
      {loadingDirectory && <p role="status">Refreshing NFL and NBA players / {players.length} saved players searchable.</p>}
      {!!issues.length && <details className="gwb-warning"><summary>Some player sources could not refresh</summary>{issues.map((issue, index) => <p key={index}>{issue}</p>)}</details>}
      <div className="gwb-chat-thread" role="log" aria-label="NFL and NBA conversation" aria-live="polite" aria-relevant="additions">
        {!messages.length && <p className="gwb-muted">Try “Show me LeBron James’s matchup”, “Josh Allen passing yards”, then “What about his recent stats?” or “Over 30.5 PRA?”</p>}
        {messages.map(message => <article key={message.id} className={`gwb-chat-message is-${message.role}`}>
          <strong>{message.role === 'user' ? 'You' : message.player ? `GamewAIre / ${message.player.sport} / ${message.player.player.name}` : 'GamewAIre'}</strong>
          {message.text.filter(Boolean).map((text, index) => <p key={index}>{text}</p>)}
          {message.answer?.hitRates && <section aria-label={`${message.answer.hitRates.name} historical hit rates`}>
            <div className="gwb-chat-table"><table>
              <caption>{message.answer.hitRates.metric} · {message.answer.hitRates.request.comparison} each threshold</caption>
              <thead><tr><th scope="col">Threshold</th><th scope="col">Games hit</th><th scope="col">Hit rate</th></tr></thead>
              <tbody>{message.answer.hitRates.rows.map(row => <tr key={row.level}><th scope="row">{row.level}</th>
                <td>{row.hits} / {row.sample}</td><td>{row.percent === null ? 'Unavailable' : `${row.percent.toFixed(1)}%`}</td></tr>)}</tbody>
            </table></div>
            {message.answer.hitRates.issues.map((issue, index) => <p className="gwb-warning" key={index}>{issue}</p>)}
            <details><summary>Games used</summary><div className="gwb-chat-table"><table><thead><tr><th>Date</th><th>{message.answer.hitRates.metric}</th></tr></thead>
              <tbody>{message.answer.hitRates.games.map(game => <tr key={game.id}><th>{new Date(game.date).toLocaleDateString()}</th><td>{game.value ?? 'Unavailable'}</td></tr>)}</tbody>
            </table></div></details>
          </section>}
          {!!message.choices?.length && <div className="gwb-chat-choices">{message.choices.map(entry => <button key={labPlayerKey(entry)} type="button" disabled={busy} onClick={() => {
            append({ role: 'user', text: [`${entry.player.name} / ${entry.sport}`] }); void answer(message.question ?? entry.player.name, [entry]);
          }}>{entry.player.name}<small>{entry.sport} / {entry.sport === 'NFL' ? entry.player.teamAbbr : entry.player.team.abbr} / {entry.player.position}</small></button>)}</div>}
          {message.answer?.nfl && renderNFL(message.answer.nfl, () => setMessages(previous => previous.filter(row => row.id !== message.id)))}
          {message.answer?.nba && <NBAPlayerCard report={message.answer.nba} onClear={() => setMessages(previous => previous.filter(row => row.id !== message.id))} />}
        </article>)}
        {busy && <p role="status">Checking recorded stats and the saved matchup model...</p>}<div ref={end} />
      </div>
      {selected && <p className="gwb-chat-context">Following {selected.player.name} / {selected.sport}. Name another player anytime.</p>}
      <form className="gwb-chat-composer" onSubmit={event => { event.preventDefault(); send(); }}>
        <label htmlFor="gwb-chat-question">Ask about NFL/NBA players or teams</label><textarea id="gwb-chat-question" value={input} maxLength={1000} rows={2}
          placeholder="T Higgins receiving yards hit rates last 10 games at 50, 75, 100—or should I start Higgins, Chase or Brown?" onChange={event => setInput(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
          }} />
        <button type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
      {!!suggestions.length && <div className="gwb-chat-choices" aria-label="Matching NFL and NBA players">{suggestions.map(entry => <button type="button" key={labPlayerKey(entry)} disabled={busy} onClick={() => {
        const question = input.trim(); setInput(''); append({ role: 'user', text: [question] }); void answer(question, [entry]);
      }}>{entry.player.name}<small>{entry.sport} / {entry.player.position}</small></button>)}</div>}
      <p className="gwb-muted">Answers use recorded sports data and existing GamewAIre models, not an unrestricted AI or paid chat provider. Missing data stays unavailable; projections are experimental.</p>
    </div>}
  </section>;
}
