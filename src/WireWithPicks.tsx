import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Game } from './services/sportsData';
import type { Sport } from './services/gamewaire';

const WireTopPicks = lazy(() => import('./WireTopPicks'));

export default function WireWithPicks({ children, games, sport, userId }: {
  children: ReactNode; games: Game[]; sport: Sport; userId?: string;
}) {
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1100px)').matches);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1100px)');
    const update = () => { setDesktop(query.matches); setExpanded(false); };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const panel = <Suspense fallback={<aside className="wire-picks-loading" role="status">Loading published Top Picks…</aside>}>
    <WireTopPicks key={`${userId ?? 'guest'}:${sport}`} games={games} sport={sport} userId={userId} desktop={desktop} />
  </Suspense>;
  return <div className="wire-with-picks">
    {!desktop && <details className="wire-mobile-picks" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary><span className="gamewaire-name">Gamew<strong>AI</strong>re</span> Top Picks</summary>
      {expanded && panel}
    </details>}
    <div className="wire-score-content">{children}</div>
    {desktop && panel}
  </div>;
}
