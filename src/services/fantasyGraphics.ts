import type { Game } from './sportsData';

export const graphicPositions = ['QB', 'RB', 'WR', 'TE'] as const;
export type GraphicPosition = typeof graphicPositions[number];
export const graphicPositionLabels: Record<GraphicPosition, string> = {
  QB: 'QUARTERBACKS', RB: 'RUNNING BACKS', WR: 'WIDE RECEIVERS', TE: 'TIGHT ENDS',
};
export type GraphicPlayer = {
  id: string; name: string; position: GraphicPosition; teamId: string; teamAbbr: string;
  headshot: string; opponent: string; opponentLogo: string; matchup: 'VS' | '@' | 'BYE' | 'TBD';
};
export type GraphicSlot = { player: GraphicPlayer | null; reason: string };
export type FantasyGraphic = { kind: 'start' | 'sit'; position: GraphicPosition; slots: GraphicSlot[] };
export type FantasyGraphicRow = {
  id: string; season: number; week: number; revision: number; updated_at: string;
  content: FantasyGraphic; published_content: FantasyGraphic | null;
};
export const emptyFantasyGraphic = (): FantasyGraphic => ({
  kind: 'start', position: 'QB', slots: Array.from({ length: 4 }, () => ({ player: null, reason: '' })),
});
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const image = (value: unknown): value is string => text(value, 2048) && (value === '' || /^https:\/\/a\.espncdn\.com\/[^\s]*$/.test(value));
export function readFantasyGraphic(value: unknown): FantasyGraphic {
  if (!isObject(value) || (value.kind !== 'start' && value.kind !== 'sit')
    || !Array.isArray(value.slots) || value.slots.length !== 4) throw new Error('The graphic has an invalid layout.');
  const position = graphicPositions.find((item) => item === value.position);
  if (!position) throw new Error('The graphic has an invalid position.');
  const ids = new Set<string>();
  const slots: GraphicSlot[] = [];
  for (const slot of value.slots) {
    if (!isObject(slot) || !text(slot.reason, 650)) throw new Error('Each player needs a reasoning field of up to 650 characters.');
    if (slot.player === null) { slots.push({ player: null, reason: slot.reason }); continue; }
    const player = slot.player;
    if (!isObject(player) || !/^\d{1,15}$/.test(String(player.id)) || typeof player.id !== 'string'
      || !/^\d{1,10}$/.test(String(player.teamId)) || typeof player.teamId !== 'string'
      || !text(player.name, 120) || !String(player.name).trim() || player.position !== value.position
      || !text(player.teamAbbr, 12) || !String(player.teamAbbr).trim()
      || !text(player.opponent, 12) || !image(player.headshot) || !image(player.opponentLogo)
      || (player.matchup !== 'VS' && player.matchup !== '@' && player.matchup !== 'BYE' && player.matchup !== 'TBD')) throw new Error('The graphic has an invalid player or matchup.');
    if (ids.has(player.id)) throw new Error('Choose each player only once.');
    ids.add(player.id);
    slots.push({ reason: slot.reason, player: {
      id: player.id, name: player.name, position, teamId: player.teamId, teamAbbr: player.teamAbbr,
      headshot: player.headshot, opponent: player.opponent, opponentLogo: player.opponentLogo, matchup: player.matchup,
    } });
  }
  return { kind: value.kind, position, slots };
}
export function fantasyGraphicPublishError(graphic: FantasyGraphic) {
  try { readFantasyGraphic(graphic); } catch (cause) { return cause instanceof Error ? cause.message : 'Invalid graphic.'; }
  if (graphic.slots.some((slot) => !slot.player || !slot.reason.trim())) return 'Select all four players and add reasoning for each before publishing or downloading.';
  if (graphic.slots.some((slot) => !slot.player?.headshot)) return 'A selected player has no headshot. Choose a player with a photo before publishing or downloading.';
  return '';
}
export function readFantasyGraphicRows(value: unknown): FantasyGraphicRow[] {
  if (!Array.isArray(value)) throw new Error('Could not read Fantasy Start/Sit graphics.');
  return value.map((row: unknown) => {
    if (!isObject(row) || typeof row.id !== 'string' || typeof row.season !== 'number' || !Number.isInteger(row.season)
      || typeof row.week !== 'number' || !Number.isInteger(row.week) || typeof row.revision !== 'number'
      || !Number.isInteger(row.revision) || row.revision < 1 || typeof row.updated_at !== 'string') {
      throw new Error('The server returned an invalid Fantasy Start/Sit graphic.');
    }
    return { id: row.id, season: row.season, week: row.week, revision: row.revision, updated_at: row.updated_at,
      content: readFantasyGraphic(row.content),
      published_content: row.published_content === null ? null : readFantasyGraphic(row.published_content) };
  });
}
export function graphicPlayerMatchup(teamId: string, games: Game[]): Pick<GraphicPlayer, 'opponent' | 'opponentLogo' | 'matchup'> {
  const game = games.find((item) => item.league === 'NFL' && [item.home.id, item.away.id].includes(teamId));
  if (!game) return { opponent: '', opponentLogo: '', matchup: 'TBD' };
  const home = game.home.id === teamId;
  const opponent = home ? game.away : game.home;
  return { opponent: opponent.abbr, opponentLogo: opponent.logo ?? '', matchup: home ? 'VS' : '@' };
}
