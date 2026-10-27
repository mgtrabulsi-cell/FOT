import type { Game } from './sportsData.ts';
import type { NBASummary } from './nbaData.ts';

function progress(period: string, clock: string): number | null {
  const quarter = /^Q([1-4])$/.exec(period);
  const overtime = /^(?:OT(\d*)|(\d+)OT)$/.exec(period);
  const number = quarter ? Number(quarter[1]) : overtime ? 4 + Number(overtime[1] || overtime[2] || 1) : null;
  if (period === 'Halftime') return 2000;
  const remaining = /^(\d+):(\d{2}(?:\.\d+)?)$/.exec(clock);
  const seconds = remaining ? Number(remaining[1]) * 60 + Number(remaining[2]) : /^\d+(?:\.\d+)?$/.test(clock) ? Number(clock) : null;
  return number !== null && seconds !== null ? number * 1000 - seconds : null;
}

export function nbaLiveScore(game: Game, summary: NBASummary | null, refreshing: boolean) {
  const boardProgress = progress(game.period, game.clock);
  const summaryProgress = summary ? progress(summary.period, summary.clock) : null;
  const boardFinal = game.status === 'FINAL';
  const summaryFinal = summary?.status === 'post';
  const boardAhead = boardProgress !== null && summaryProgress !== null && boardProgress > summaryProgress;
  const useBoard = !summary || (boardFinal && !summaryFinal)
    || (game.status === 'LIVE' && !summaryFinal && (summary.status !== 'in' || boardAhead
      || (refreshing && (boardProgress === null || summaryProgress === null || boardProgress === summaryProgress))));
  return {
    awayScore: useBoard ? game.away.score : summary.awayScore ?? game.away.score,
    homeScore: useBoard ? game.home.score : summary.homeScore ?? game.home.score,
    period: useBoard ? game.period : summary.period || game.period,
    clock: useBoard ? game.clock : summary.clock || game.clock,
  };
}
