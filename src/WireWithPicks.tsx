import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Game } from './services/sportsData';
import type { Sport } from './services/gamewaire';
import type { WireTeamPicks } from './services/wireTeamPicks';

const WireTopPicks = lazy(() => import('./WireTopPicks'));

export default function WireWithPicks({ children, games, sport, userId, teamPicks = {}, gameOpen = false }: {
  children: ReactNode; games: Game[]; sport: Sport; userId?: string; teamPicks?: WireTeamPicks; gameOpen?: boolean;
}) {
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1100px)').matches);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (gameOpen) setExpanded(false); }, [gameOpen]);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1100px)');
    const update = () => { setDesktop(query.matches); setExpanded(false); };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const count = new Set(Object.values(teamPicks).map(pick => pick.eventId)).size;
  const panel = <Suspense fallback={<aside className="wire-picks-loading" role="status">Loading GamewAIre picks and breakdowns…</aside>}>
    <WireTopPicks key={`${userId ?? 'guest'}:${sport}`} games={games} sport={sport} userId={userId} desktop={desktop} teamPicks={teamPicks} />
  </Suspense>;
  return <div className={`wire-with-picks${gameOpen ? ' is-game-open' : ''}`}>
    {!gameOpen && !desktop && <details className="wire-mobile-picks" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary><span className="gamewaire-name">Gamew<strong>AI</strong>re</span> Picks &amp; Breakdowns <span className="wire-picks-count">{count ? `${count} auto picks` : 'View picks'}</span><small>Automatic matchup picks + published selections</small></summary>
      {expanded && panel}
    </details>}
    <div className="wire-score-content">{children}</div>
    {!gameOpen && desktop && panel}
  </div>;
}
