import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Game } from './services/sportsData';
import type { Sport } from './services/gamewaire';

const WireTopPicks = lazy(() => import('./WireTopPicks'));

export default function WireWithPicks({ children, games, sport, userId }: {
  children: ReactNode; games: Game[]; sport: Sport; userId?: string;
}) {
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1100px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1100px)');
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return <div className="wire-with-picks">
    <div className="wire-score-content">{children}</div>
    {desktop && <Suspense fallback={<aside className="wire-picks-loading" role="status">Loading published Top Picks…</aside>}>
      <WireTopPicks key={`${userId ?? 'guest'}:${sport}`} games={games} sport={sport} userId={userId} />
    </Suspense>}
  </div>;
}
