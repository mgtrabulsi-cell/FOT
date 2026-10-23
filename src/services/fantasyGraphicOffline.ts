import { emptyFantasyGraphic, readFantasyGraphic, readFantasyGraphicRows } from './fantasyGraphics.ts';
import type { FantasyGraphicRow, GraphicPlayer } from './fantasyGraphics.ts';

type Workspace = { admin: boolean; season: number | null; week: number | null };
const prefix = 'gamewire-fantasy-offline:';
const read = (key: string): unknown => {
  const raw = localStorage.getItem(`${prefix}${key}`);
  return raw === null ? undefined : JSON.parse(raw);
};
const write = (key: string, value: unknown) => localStorage.setItem(`${prefix}${key}`, JSON.stringify(value));

export function loadFantasyWorkspace(userId: string): Workspace | undefined {
  const value = read(`workspace:${userId}`);
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || !('admin' in value) || typeof value.admin !== 'boolean'
    || !('season' in value) || !('week' in value)
    || (value.season !== null && (typeof value.season !== 'number' || !Number.isInteger(value.season) || value.season < 2000 || value.season > 2200))
    || (value.week !== null && (typeof value.week !== 'number' || !Number.isInteger(value.week) || value.week < 1 || value.week > 18))) {
    throw new Error('The saved Start/Sit workspace is invalid. Reconnect to reload it.');
  }
  return { admin: value.admin, season: value.season, week: value.week };
}

export function saveFantasyWorkspace(userId: string, workspace: Workspace): void {
  write(`workspace:${userId}`, workspace);
}

export function loadFantasyRoster(season: number): GraphicPlayer[] {
  const value = read(`roster:${season}`);
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3000) throw new Error('The saved Start/Sit player search is invalid. Reconnect to reload it.');
  return value.map((player: unknown) => {
    if (!player || typeof player !== 'object' || !('position' in player)) throw new Error('The saved Start/Sit player is invalid.');
    const graphic = readFantasyGraphic({ ...emptyFantasyGraphic(), position: player.position,
      slots: [{ player, reason: '' }, ...emptyFantasyGraphic().slots.slice(1)] });
    const restored = graphic.slots[0].player;
    if (!restored) throw new Error('The saved Start/Sit player is invalid.');
    return restored;
  });
}

export function saveFantasyRoster(season: number, players: GraphicPlayer[]): void {
  write(`roster:${season}`, players);
}

export function loadFantasySharedDrafts(userId: string, season: number, week: number): FantasyGraphicRow[] {
  const value = read(`shared:${userId}:${season}:${week}`);
  const rows = value === undefined ? [] : readFantasyGraphicRows(value);
  if (rows.some((row) => row.season !== season || row.week !== week)) throw new Error('The saved Start/Sit graphics belong to a different week.');
  return rows;
}

export function saveFantasySharedDrafts(userId: string, season: number, week: number, rows: FantasyGraphicRow[]): void {
  write(`shared:${userId}:${season}:${week}`, rows);
}
