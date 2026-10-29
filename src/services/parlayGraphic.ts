import type { AnglePick } from './anglePicks';

export type ParlaySport = 'NBA' | 'NFL';
export type ParlaySubject = { id: string; name: string; image: string; teamId: string; teamName: string; teamLogo: string; color: string };
export type ParlayLeg = {
  id: string; sport: string; type: 'player' | 'spread' | 'moneyline' | 'custom'; subject: ParlaySubject;
  market: string; side: 'Over' | 'Under' | 'At least'; line: string;
};
export type ParlayGraphic = {
  version: 1; pickId: string; title: 'PARLAY' | 'SAME GAME PARLAY' | 'CROSS GAME PARLAY';
  subtitle: string; odds: string; images: boolean; legs: ParlayLeg[]; image_path?: string;
};
export const parlayMarkets: Record<ParlaySport, string[]> = {
  NBA: ['Points', 'Rebounds', 'Assists', 'Made threes', 'Points + rebounds + assists', 'Points + rebounds', 'Points + assists', 'Rebounds + assists', 'Steals', 'Blocks', 'Steals + blocks', 'Turnovers', 'Double-double', 'Triple-double'],
  NFL: ['Passing yards', 'Passing touchdowns', 'Completions', 'Pass attempts', 'Interceptions', 'Rushing yards', 'Rush attempts', 'Rushing touchdowns', 'Receiving yards', 'Receptions', 'Receiving touchdowns', 'Rush + receiving yards', 'Anytime touchdown', 'First touchdown', 'Touchdowns', 'Field goals', 'Kicking points'],
};
export const parlayMarketOptions = (sport: string) => sport === 'NBA' || sport === 'NFL' ? parlayMarkets[sport] : [];
export function newManualParlayLeg(): ParlayLeg {
  return { id: crypto.randomUUID(), sport: 'NHL', type: 'custom',
    subject: { id: crypto.randomUUID(), name: '', image: '', teamId: '', teamName: '', teamLogo: '', color: '151f2e' },
    market: '', side: 'At least', line: '' };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit;
const imageUrl = (value: unknown): value is string => bounded(value, 500) && (!value || /^https:\/\//.test(value));
export function readParlayGraphic(value: unknown): ParlayGraphic {
  if (!object(value) || value.version !== 1 || typeof value.pickId !== 'string' || !uuid.test(value.pickId)
    || !['PARLAY', 'SAME GAME PARLAY', 'CROSS GAME PARLAY'].includes(String(value.title))
    || !bounded(value.subtitle, 100) || !bounded(value.odds, 12) || typeof value.images !== 'boolean'
    || (value.image_path !== undefined && !bounded(value.image_path, 500))
    || !Array.isArray(value.legs) || value.legs.length > 8) throw new Error('The saved parlay graphic is invalid. It was not overwritten.');
  const ids = new Set<string>();
  for (const leg of value.legs) {
    if (!object(leg) || typeof leg.id !== 'string' || !uuid.test(leg.id) || ids.has(leg.id)
      || !bounded(leg.sport, 32) || !['player', 'spread', 'moneyline', 'custom'].includes(String(leg.type))
      || (leg.type !== 'custom' && !['NBA', 'NFL'].includes(leg.sport))
      || !object(leg.subject) || !bounded(leg.subject.id, 100) || !bounded(leg.subject.name, 80)
      || !bounded(leg.subject.teamId, 100) || !bounded(leg.subject.teamName, 80)
      || !imageUrl(leg.subject.image) || !imageUrl(leg.subject.teamLogo)
      || !bounded(leg.subject.color, 7) || !/^[0-9a-f]{6}$/i.test(leg.subject.color)
      || !bounded(leg.market, 50) || !bounded(leg.line, 12) || !['Over', 'Under', 'At least'].includes(String(leg.side))) {
      throw new Error('A saved parlay leg is invalid. It was not overwritten.');
    }
    ids.add(leg.id);
  }
  return value as ParlayGraphic;
}
export const newParlayGraphic = (): ParlayGraphic => ({
  version: 1, pickId: crypto.randomUUID(), title: 'PARLAY', subtitle: '', odds: '', images: true, legs: [],
});
export function parlayLegLabel(leg: ParlayLeg) {
  if (leg.type === 'custom') return leg.market.trim();
  if (leg.type === 'moneyline') return 'Moneyline';
  if (leg.type === 'spread') return `Spread ${Number(leg.line) > 0 && !leg.line.trim().startsWith('+') ? '+' : ''}${leg.line.trim()}`;
  if (['Anytime touchdown', 'First touchdown', 'Double-double', 'Triple-double'].includes(leg.market)) return leg.market;
  return leg.side === 'At least' ? `${leg.line}+ ${leg.market}` : `${leg.side} ${leg.line} ${leg.market}`;
}
export function parlayPickText(graphic: ParlayGraphic) {
  return [graphic.odds.trim() ? `${graphic.title} (${graphic.odds.trim()})` : graphic.title,
    ...graphic.legs.map((leg) => `${leg.subject.name} ${parlayLegLabel(leg)}`)].join('\n');
}
export function withParlayPick(picks: AnglePick[], graphic: ParlayGraphic) {
  const text = parlayPickText(graphic);
  const previous = picks.find((pick) => pick.id === graphic.pickId);
  const next: AnglePick = { id: graphic.pickId, category: 'parlay', text,
    result: previous?.text === text ? previous.result : 'pending' };
  return [...picks.filter((pick) => pick.id !== graphic.pickId), next];
}
export function parlayGraphicError(graphic: ParlayGraphic) {
  readParlayGraphic(graphic);
  if (graphic.legs.length < 2) return 'Add at least two legs to your parlay.';
  if (graphic.odds.trim() && (!/^[+-]?\d+$/.test(graphic.odds.trim()) || Math.abs(Number(graphic.odds)) < 100)) return 'Use actual American sportsbook odds, such as +1360 or -110, or leave odds blank.';
  const seen = new Set<string>();
  for (const [index, leg] of graphic.legs.entries()) {
    if (!leg.sport.trim()) return `Enter a sport or league for leg ${index + 1}.`;
    if (!leg.subject.id || !leg.subject.name.trim()) return `Choose a player or team for leg ${index + 1}.`;
    if (leg.type === 'custom' && !leg.market.trim()) return `Enter the selection for manual leg ${index + 1}.`;
    if (leg.type === 'player' && !leg.market.trim()) return `Choose a stat for leg ${index + 1}.`;
    const needsLine = leg.type === 'spread' || leg.type === 'player' && !['Anytime touchdown', 'First touchdown', 'Double-double', 'Triple-double'].includes(leg.market);
    if (needsLine && (!/^[+-]?\d+(?:\.\d+)?$/.test(leg.line.trim()) || !Number.isFinite(Number(leg.line))
      || leg.type === 'player' && Number(leg.line) < 0)) return `Enter a valid ${leg.type === 'spread' ? 'spread' : 'stat line'} for leg ${index + 1}.`;
    const key = `${leg.sport}:${leg.type}:${leg.type === 'custom' ? leg.subject.name.trim() : leg.subject.id}:${parlayLegLabel(leg)}`.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return `Leg ${index + 1} duplicates another leg. Remove the duplicate.`;
    seen.add(key);
  }
  if (parlayPickText(graphic).length > 500) return 'The tracked parlay exceeds 500 characters. Shorten custom stat labels or use fewer legs.';
  return '';
}
