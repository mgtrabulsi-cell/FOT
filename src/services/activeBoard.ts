import { pickCategories } from './anglePicks';
import type { PickCategory } from './anglePicks';

export type ManualActiveBet = {
  id: string;
  text: string;
  sport: string;
  category: PickCategory;
  matchup: string;
  createdAt: string;
};

const keyFor = (userId: string) => `gamewire:manual-active-bets:v1:${userId}`;
const sports = ['NFL', 'NBA', 'NHL', 'UCL', 'Soccer', 'CFB', 'UFC', 'Combo'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const manualActiveBetSports = sports;
export function readManualActiveBets(userId: string): ManualActiveBet[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 40) return [];
    return value.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const bet = row as Record<string, unknown>;
      if (typeof bet.id !== 'string' || !uuid.test(bet.id) || typeof bet.text !== 'string' || !bet.text.trim()
        || bet.text.length > 500 || typeof bet.sport !== 'string' || !sports.includes(bet.sport as typeof sports[number])
        || !pickCategories.some((category) => category === bet.category) || typeof bet.matchup !== 'string'
        || bet.matchup.length > 80 || typeof bet.createdAt !== 'string' || !Number.isFinite(Date.parse(bet.createdAt))) {
        return [];
      }
      return [{ id: bet.id, text: bet.text.trim(), sport: bet.sport, category: bet.category as PickCategory,
        matchup: bet.matchup.trim(), createdAt: bet.createdAt }];
    });
  } catch {
    return [];
  }
}

export function writeManualActiveBets(userId: string, rows: ManualActiveBet[]) {
  localStorage.setItem(keyFor(userId), JSON.stringify(rows));
}
