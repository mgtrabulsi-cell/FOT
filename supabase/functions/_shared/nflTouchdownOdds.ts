import { array, normalize, numeric, object, text } from './gamewaire.ts';

export type NFLTouchdownOdds = {
  eventId: string; kickoff: string; player: string; provider: string;
  american: number; updatedAt: string; capturedAt: string;
};

export function readNFLTouchdownOdds(value: unknown, eventId: string, capturedAt: string): NFLTouchdownOdds[] {
  const event = object(value), kickoff = text(event.commence_time);
  if (!eventId || !Number.isFinite(Date.parse(capturedAt)) || Date.parse(capturedAt) >= Date.parse(kickoff)
    || !Number.isFinite(Date.parse(kickoff))) return [];
  return array(event.bookmakers).flatMap(raw => {
    const book = object(raw), provider = text(book.title);
    return array(book.markets).flatMap(raw => {
      const market = object(raw), updatedAt = text(market.last_update) || text(book.last_update);
      if (market.key !== 'player_anytime_td' || !provider || !Number.isFinite(Date.parse(updatedAt))
        || Date.parse(updatedAt) > Date.parse(capturedAt) || Date.parse(updatedAt) >= Date.parse(kickoff)) return [];
      return array(market.outcomes).flatMap(raw => {
        const outcome = object(raw), name = text(outcome.name);
        const player = text(outcome.description) || name, american = numeric(outcome.price);
        if (['no', 'under', 'over'].includes(normalize(name)) || ['yes', 'no'].includes(normalize(player))
          || !player || american === undefined || !Number.isInteger(american) || Math.abs(american) < 100) return [];
        return [{ eventId, kickoff, player, provider, american, updatedAt, capturedAt }];
      });
    });
  });
}

export function savedNFLTouchdownOdds(rows: NFLTouchdownOdds[], eventId: string, kickoff: string, player: string) {
  return rows.filter(row => row.eventId === eventId && Date.parse(row.kickoff) === Date.parse(kickoff)
    && normalize(row.player) === normalize(player) && row.provider && Number.isInteger(row.american)
    && Math.abs(row.american) >= 100 && Number.isFinite(Date.parse(row.updatedAt))
    && Date.parse(row.updatedAt) <= Date.parse(row.capturedAt) && Date.parse(row.capturedAt) < Date.parse(kickoff))
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)
      || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.provider.localeCompare(b.provider))[0];
}
