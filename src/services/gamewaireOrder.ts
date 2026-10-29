import { rankTopPicks } from '../../supabase/functions/_shared/gamewaire.ts';
import type { Candidate } from '../../supabase/functions/_shared/gamewaire.ts';

export type PickOrder = { game_date: string; pick_keys: string[]; revision: number };
export const wirePickLimit = (desktop: boolean) => desktop ? 5 : 3;
export function publishedSelections(publications: { picks: Candidate[] }[], leans: { team_lean: { pick: Candidate } | null }[]) {
  const selections = new Map<string, Candidate & { isGameLean: boolean; isPublishedLean: boolean }>();
  for (const game of publications) for (const pick of game.picks) selections.set(pick.key, { ...pick, isGameLean: false, isPublishedLean: false });
  for (const game of leans) {
    const pick = game.team_lean?.pick;
    if (!pick) continue;
    const shared = selections.get(pick.key);
    if (shared) shared.isPublishedLean = true;
    else selections.set(pick.key, { ...pick, isGameLean: true, isPublishedLean: true });
  }
  return [...selections.values()];
}
export function bestBetLabels(picks: { key: string; isGameLean: boolean; isPublishedLean?: boolean }[]) {
  const top = picks.find((pick) => !pick.isGameLean);
  const lean = picks.find((pick) => pick.isGameLean || pick.isPublishedLean);
  const labels = new Map<string, string>();
  if (top) labels.set(top.key, 'Top Pick');
  if (lean) labels.set(lean.key, lean.key === top?.key ? 'Top Pick + Game Lean' : 'Game Lean');
  return labels;
}
export function instagramBestBets(picks: ReturnType<typeof publishedSelections>, orders: PickOrder[], sport: Candidate['sport'], date: string) {
  const ranked = orderedTopPicks(picks.filter((pick) => pick.sport === sport && pickOrderDate(pick.start) === date), orders);
  const top = ranked.filter((pick) => !pick.isGameLean).slice(0, 3);
  const leans = ranked.filter((pick) => pick.isGameLean || pick.isPublishedLean).slice(0, 3);
  const keys = new Set([...top, ...leans].map((pick) => pick.key));
  return ranked.filter((pick) => keys.has(pick.key)).map((pick) => ({
    ...pick, instagramTopRank: top.findIndex((row) => row.key === pick.key) + 1 || null,
    instagramLeanRank: leans.findIndex((row) => row.key === pick.key) + 1 || null,
  }));
}
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
