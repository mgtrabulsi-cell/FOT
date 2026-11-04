import { betGraphicHeight, renderBetGraphic } from './betGraphicStyle';
import { isParlaySubject } from './parlayGraphic';
import type { ParlaySubject } from './parlayGraphic';
export type BestBetSubject = { type: 'player' | 'team'; subject: ParlaySubject };
export type BestBetEntry = { id: string; sport: string; selection: string; odds: string; result: 'pending' | 'hit' | 'miss'; participant?: BestBetSubject };
export type BestBetGraphic = { title: string; subtitle: string; entries: BestBetEntry[]; images?: boolean };
export const newBestBetEntry = (): BestBetEntry => ({ id: crypto.randomUUID(), sport: 'NFL', selection: '', odds: '', result: 'pending' });
export const newBestBetGraphic = (): BestBetGraphic => ({ title: 'BEST BETS', subtitle: '', entries: [newBestBetEntry()], images: true });
export function readBestBetGraphic(value: unknown): BestBetGraphic {
  if (!value || typeof value !== 'object' || !('title' in value) || typeof value.title !== 'string' || value.title.length > 48
    || !('subtitle' in value) || typeof value.subtitle !== 'string' || value.subtitle.length > 100
    || ('images' in value && typeof value.images !== 'boolean')
    || !('entries' in value) || !Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 8
    || !value.entries.every(row => row && typeof row.id === 'string' && typeof row.sport === 'string' && row.sport.length <= 20
      && typeof row.selection === 'string' && row.selection.length <= 200 && typeof row.odds === 'string' && row.odds.length <= 12
      && ['pending', 'hit', 'miss'].includes(row.result)
      && (row.participant === undefined || (row.participant && ['player', 'team'].includes(row.participant.type)
        && isParlaySubject(row.participant.subject))))
    || new Set(value.entries.map(row => row.id)).size !== value.entries.length) throw new Error('The saved Best Bet draft is invalid. It was not overwritten.');
  return { title: value.title, subtitle: value.subtitle, entries: value.entries, images: !('images' in value) || value.images === true };
}
export function bestBetGraphicError(value: BestBetGraphic): string | null {
  readBestBetGraphic(value);
  if (!value.title.trim()) return 'Enter a graphic title.';
  if (value.entries.some(row => !row.sport.trim() || !row.selection.trim())) return 'Enter a sport and selection for every straight bet.';
  if (value.entries.some(row => row.odds && (!/^[+-]\d{3,5}$/.test(row.odds) || Math.abs(Number(row.odds)) < 100))) return 'Use American odds such as -110 or +150, or leave odds blank.';
  return null;
}
export function bestBetGraphicHeight(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('Choose one to eight straight bets.');
  return betGraphicHeight(count);
}
export async function renderBestBetGraphic(value: BestBetGraphic): Promise<Blob> {
  const error = bestBetGraphicError(value);
  if (error) throw new Error(error);
  const settled = value.entries.filter(row => row.result !== 'pending'), wins = settled.filter(row => row.result === 'hit').length;
  return renderBetGraphic({
    title: value.title, subtitle: value.subtitle.trim(), scale: 2, typography: 'brand',
    rows: value.entries.map(row => ({ label: row.sport, name: row.participant?.subject.name ?? '',
      selection: row.selection.trim(), odds: row.odds, result: row.result })),
    summary: settled.length ? `${wins} / ${settled.length} STRAIGHTS HIT` : `${value.entries.length} BEST BET${value.entries.length === 1 ? '' : 'S'}`,
    note: settled.length ? 'Results manually entered / Pending excluded from hit total' : 'Separate straight selections / Not a parlay',
  });
}
