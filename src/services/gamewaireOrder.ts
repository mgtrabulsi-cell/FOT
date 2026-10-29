import { rankTopPicks } from '../../supabase/functions/_shared/gamewaire.ts';
import type { Candidate } from '../../supabase/functions/_shared/gamewaire.ts';

export type PickOrder = { game_date: string; pick_keys: string[]; revision: number };
export const wirePickLimit = (desktop: boolean) => desktop ? 5 : 3;
export function pickOrderDate(start: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(start));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function orderedTopPicks<T extends Candidate>(picks: T[], orders: PickOrder[]): T[] {
  const ranked = rankTopPicks(picks);
  const positions = new Map(orders.flatMap((order) => order.pick_keys.map((key, index) =>
    [`${order.game_date}:${key}`, index] as const)));
  const position = (pick: T) => positions.get(`${pickOrderDate(pick.start)}:${pick.key}`) ?? Number.MAX_SAFE_INTEGER;
  return ranked.sort((a, b) => position(a) - position(b));
}
export function movePick<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
