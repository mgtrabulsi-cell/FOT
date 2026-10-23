import { readFantasyGraphic, readFantasyGraphicRows } from './fantasyGraphics.ts';
import type { FantasyGraphic, FantasyGraphicRow } from './fantasyGraphics.ts';

export type FantasyGraphicDraft = {
  form: FantasyGraphic;
  editing: FantasyGraphicRow | null;
  dirty: boolean;
  queries: string[];
  postToX?: boolean;
};

const key = (userId: string, season: number, week: number) =>
  `gamewire-fantasy-graphic-draft:${userId}:${season}:${week}`;

function readDraft(value: unknown, season: number, week: number): FantasyGraphicDraft {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('form' in value) || !('editing' in value) || !('dirty' in value) || typeof value.dirty !== 'boolean'
    || !('queries' in value) || !Array.isArray(value.queries) || value.queries.length !== 4
    || !value.queries.every((query): query is string => typeof query === 'string')
    || ('postToX' in value && typeof value.postToX !== 'boolean')) {
    throw new Error('The saved Start/Sit draft is invalid. It was not overwritten.');
  }
  const editing = value.editing === null ? null : readFantasyGraphicRows([value.editing])[0];
  if (editing && (editing.season !== season || editing.week !== week)) {
    throw new Error('The saved Start/Sit draft belongs to a different week. It was not overwritten.');
  }
  return { form: readFantasyGraphic(value.form), editing, dirty: value.dirty, queries: value.queries,
    ...('postToX' in value && typeof value.postToX === 'boolean' ? { postToX: value.postToX } : {}) };
}

export function loadFantasyGraphicDraft(userId: string, season: number, week: number): FantasyGraphicDraft | undefined {
  const raw = localStorage.getItem(key(userId, season, week));
  return raw === null ? undefined : readDraft(JSON.parse(raw), season, week);
}

export function saveFantasyGraphicDraft(userId: string, season: number, week: number, draft: FantasyGraphicDraft): void {
  const value = { version: 1, ...draft };
  readDraft(value, season, week);
  // Text and ESPN URLs are small enough to save synchronously before a phone suspends the page.
  localStorage.setItem(key(userId, season, week), JSON.stringify(value));
}

export function clearFantasyGraphicDraft(userId: string, season: number, week: number): void {
  localStorage.removeItem(key(userId, season, week));
}
