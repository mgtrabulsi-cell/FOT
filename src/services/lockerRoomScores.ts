import type { FavoriteTarget, Game } from './sportsData';
import type { DenScoreItem } from '../useLockerRoomHistory';

export function completedScoreUpdates(game: Game, favorite: FavoriteTarget): DenScoreItem[] {
  if (game.status === 'UPCOMING') return [];
  const checkpoints = (game.completedPeriods ?? []).map((period) => ({
    key: `period:${period.period}`, label: `End of ${period.period <= 4 ? `Q${period.period}` : period.period === 5 ? 'OT' : `OT${period.period - 4}`}`,
    awayScore: period.awayScore, homeScore: period.homeScore, final: false,
  }));
  if (game.status === 'FINAL') checkpoints.push({
    key: 'final', label: 'Final', awayScore: game.away.score, homeScore: game.home.score, final: true,
  });
  return checkpoints.map((checkpoint): DenScoreItem => ({
    id: `score:${game.id}:${checkpoint.key}`, kind: 'score', checkpoint: true,
    favoriteKey: favorite.key, favoriteName: favorite.name, timestamp: game.date || new Date().toISOString(),
    league: game.league, away: { ...game.away, score: checkpoint.awayScore }, home: { ...game.home, score: checkpoint.homeScore },
    status: checkpoint.final ? 'FINAL' : 'LIVE', period: checkpoint.label, clock: '',
  }));
}
