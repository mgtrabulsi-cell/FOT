import { useEffect, useState } from 'react';
import type { Game } from './services/sportsData';
import { fetchGameInjuries } from './services/gameInjuries';
import type { GameInjuryReport } from './services/gameInjuries';
import './pregame-injuries.css';

export default function PregameInjuries({ game }: { game: Game }) {
  const [report, setReport] = useState<GameInjuryReport | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setReport(null); setError('');
    async function refresh() {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const result = await fetchGameInjuries(game, controller.signal);
        if (!controller.signal.aborted) { setReport(result); setError(''); }
      } catch (cause) {
        if (!controller.signal.aborted) {
          console.error('Pregame injury report could not refresh', cause);
          setError(cause instanceof Error ? cause.message : 'The injury report could not load. Retry when connected.');
        }
      } finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000), reconnect = () => void refresh();
    window.addEventListener('online', reconnect); document.addEventListener('visibilitychange', reconnect);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('online', reconnect); document.removeEventListener('visibilitychange', reconnect); };
  }, [game.league, game.eventId, game.date, game.home.id, game.away.id, retry]);
  return <details className="pregame-injuries" aria-label="Pregame injury report">
    <summary><span><span aria-hidden="true">🏥 +</span> Injury report</span><span className="pregame-injury-toggle" aria-hidden="true">+</span></summary>
    <div className="pregame-injury-content">
    <header><span>{report ? `Checked ${new Date(report.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Pregame availability'}</span></header>
    <p>OUT means the provider explicitly reports the player out. Questionable or doubtful is not a confirmed absence. Designations can change before the game.</p>
    {!report && !error && <p role="status">Loading reported injuries...</p>}
    {error && <p role="alert">{report ? 'Could not refresh; the report below is from the checked time. ' : ''}{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry injury report</button></p>}
    {report && <div className="pregame-injury-teams">{[game.away, game.home].map(team => {
      const players = report.players.filter(player => player.teamId === team.id);
      return <section key={team.id}><h4>{team.abbr}</h4>{players.length ? <ul>{players.map(player =>
        <li key={player.id}><span>{player.name}</span><b className={player.status === 'OUT' ? 'is-out' : undefined}>{player.status}</b></li>)}</ul>
        : <p>No player injury designations were supplied for this team.</p>}</section>;
    })}</div>}
    <small>Source: ESPN matchup injury report. An empty list is not confirmation that every player is available.</small>
    </div>
  </details>;
}
