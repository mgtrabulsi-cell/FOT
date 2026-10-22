export type AnglePick = { id: string; text: string; result: 'pending' | 'hit' | 'miss' };
export function readAnglePicks(value: unknown): AnglePick[] {
  if (!Array.isArray(value) || !value.every((pick) => pick && typeof pick === 'object'
    && typeof pick.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pick.id)
    && typeof pick.text === 'string' && pick.text.trim().length > 0 && pick.text.length <= 500
    && ['pending', 'hit', 'miss'].includes(pick.result))
    || new Set(value.map((pick) => pick.id.toLowerCase())).size !== value.length) throw new Error('The server returned invalid admin picks. Please reload.');
  return value;
}
export function anglePicks(angle: { id: string; pick: string; picks?: AnglePick[] }): AnglePick[] {
  return angle.picks ?? (angle.pick.trim() ? [{ id: angle.id, text: angle.pick, result: 'pending' }] : []);
}
export const angleSports = [
  { key: 'NBA', label: 'NBA', emoji: '🏀' },
  { key: 'NHL', label: 'NHL', emoji: '🏒' },
  { key: 'UCL', label: 'UCL', emoji: '⚽' },
  { key: 'SOCCER', label: 'Soccer', emoji: '⚽' },
] as const;
export type AngleSportKey = 'NFL' | typeof angleSports[number]['key'];
export const nflSport = { key: 'NFL', label: 'NFL', emoji: '🏈' } as const;
export function angleSport(gameId: string): { key: AngleSportKey; label: string; emoji: string } {
  const prefix = gameId.split(':')[0];
  return angleSports.find((sport) => sport.key === prefix) ?? nflSport;
}
