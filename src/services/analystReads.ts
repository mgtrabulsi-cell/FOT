export type AnalystKind = 'angle' | 'news' | 'picks';
export type AnalystItem = { kind: AnalystKind; key: string };
export const analystGuestKey = 'gamewire-analyst-guest-reads';

export function picksReadKey(season: number, week: number, revision: number, playerId: string) {
  return `${season}:${week}:${revision}:${playerId}`;
}

export function readAnalystItems(value: unknown): AnalystItem[] {
  if (!Array.isArray(value) || !value.every((item) => item && typeof item === 'object'
    && (((item.kind === 'angle' || item.kind === 'news') && typeof item.key === 'string' && /^[0-9a-f-]{36}$/i.test(item.key))
      || (item.kind === 'picks' && typeof item.key === 'string' && /^\d{4}:\d{1,2}:[1-9]\d*:(?:\d{1,15}|empty)$/.test(item.key))))) {
    throw new Error('The server returned invalid Analyst Desk read status.');
  }
  return value;
}

export function guestAnalystReads(): Set<string> {
  const value: unknown = JSON.parse(localStorage.getItem(analystGuestKey) ?? '[]');
  if (!Array.isArray(value) || !value.every((key) => typeof key === 'string')) throw new Error('Saved Analyst Desk read status is invalid.');
  return new Set(value);
}

export function analystReceiptKey(item: AnalystItem) {
  return `${item.kind}:${item.key}`;
}
