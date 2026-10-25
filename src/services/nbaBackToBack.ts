import type { Game } from './sportsData.ts';
import { nbaCalendarDate, shiftNBACalendarDate } from './sportsData.ts';

export function nbaPreviousGame(game: Game, teamId: string, previousGames: Game[]): Game | undefined {
  const previousDate = shiftNBACalendarDate(nbaCalendarDate(new Date(game.date)), -1);
  return previousGames.find((previous) => previous.league === 'NBA' && previous.status === 'FINAL'
    && previous.eventId !== game.eventId && nbaCalendarDate(new Date(previous.date)) === previousDate
    && (previous.away.id === teamId || previous.home.id === teamId));
}
