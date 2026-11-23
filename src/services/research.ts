import { createDraftStorage } from './draftStorage';

export type ResearchSection = { title: string; text?: string; rows: Array<{ label: string; value: string }> };
export type ResearchSnapshot = {
  league: 'NFL' | 'NBA'; kind: 'player' | 'matchup'; title: string;
  game: { eventId: string; kickoff: string; homeId: string; awayId: string; home: string; away: string } | null;
  player?: { id: string; teamId: string };
  forecastAt: string | null; identity: string; sections: ResearchSection[];
};
export type ResearchResult = { checkedAt: string; sections: ResearchSection[] };
export type SavedResearch = { id: string; savedAt: string; snapshot: ResearchSnapshot; note: string; result?: ResearchResult };
const storage = createDraftStorage('gamewire-personal-research');
const stopped = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();
const key = (scope: string) => `research:${scope}`;
function ordered<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);
  queue = next.catch(() => undefined);
  return next;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const validSections = (value: unknown): value is ResearchSection[] => Array.isArray(value) && value.every(section =>
  object(section) && typeof section.title === 'string' && (section.text === undefined || typeof section.text === 'string')
  && Array.isArray(section.rows) && section.rows.every(row => object(row) && typeof row.label === 'string' && typeof row.value === 'string'));
function valid(value: unknown): value is SavedResearch {
  if (!object(value) || typeof value.id !== 'string' || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))
    || typeof value.note !== 'string' || !object(value.snapshot)) return false;
  const snapshot = value.snapshot, game = snapshot.game;
  return ['NFL', 'NBA'].includes(String(snapshot.league)) && ['player', 'matchup'].includes(String(snapshot.kind))
    && typeof snapshot.title === 'string' && typeof snapshot.identity === 'string'
    && (snapshot.forecastAt === null || typeof snapshot.forecastAt === 'string')
    && (game === null || object(game) && ['eventId', 'kickoff', 'homeId', 'awayId', 'home', 'away'].every(field => typeof game[field] === 'string'))
    && (snapshot.player === undefined || object(snapshot.player) && typeof snapshot.player.id === 'string' && typeof snapshot.player.teamId === 'string')
    && validSections(snapshot.sections)
    && (value.result === undefined || object(value.result) && typeof value.result.checkedAt === 'string' && validSections(value.result.sections));
}
async function read(scope: string): Promise<SavedResearch[]> {
  const value = await storage.load(key(scope));
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(valid)) throw new Error('Saved research could not be read. Do not clear device storage; retry or contact support.');
  return value;
}
async function mutate(scope: string, change: (rows: SavedResearch[]) => SavedResearch[]): Promise<SavedResearch[]> {
  if (stopped.has(scope)) throw new Error('Research saving stopped after account deletion.');
  const rows = change(await read(scope));
  if (stopped.has(scope)) throw new Error('Research saving stopped after account deletion.');
  await storage.save(key(scope), rows);
  return rows;
}
export const loadResearch = (scope: string) => ordered(() => read(scope));
export function saveResearch(scope: string, snapshot: ResearchSnapshot, note: string): Promise<SavedResearch[]> {
  // Detach the snapshot before waiting for storage; live refreshes must never rewrite it.
  const entry: SavedResearch = { id: crypto.randomUUID(), savedAt: new Date().toISOString(), snapshot: structuredClone(snapshot), note };
  if (!valid(entry)) return Promise.reject(new Error('This research snapshot is incomplete and cannot be saved.'));
  return ordered(() => mutate(scope, rows => [entry, ...rows]));
}
export function updateResearch(scope: string, id: string, update: { note?: string; result?: ResearchResult }) {
  return ordered(() => mutate(scope, rows => {
    if (!rows.some(row => row.id === id)) throw new Error('This saved item no longer exists. Reload My Game Plan.');
    return rows.map(row => row.id === id ? { ...row, ...structuredClone(update) } : row);
  }));
}
export const removeResearch = (scope: string, id: string) => ordered(() => mutate(scope, rows => rows.filter(row => row.id !== id)));
export function deleteResearch(scope: string) {
  stopped.add(scope);
  return ordered(() => storage.deleteAccount([key(scope)]));
}
