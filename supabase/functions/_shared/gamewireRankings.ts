import { normalize, object, text } from './gamewaire.ts';
import type { BotDirectory, BotPlayer } from './gamewireBot.ts';

export type RankingList = { season: number; week: number; format: 'ppr' | 'half' | 'standard'; position: BotPlayer['position']; playerIds: string[]; publishedAt: string | null };
export function rankingScope(input: Record<string, unknown>) {
  if (!Number.isInteger(input.season) || Number(input.season) < 2000 || Number(input.season) > 2200
    || !Number.isInteger(input.week) || Number(input.week) < 1 || Number(input.week) > 18
    || !['ppr', 'half', 'standard'].includes(text(input.format)) || !['QB', 'RB', 'WR', 'TE'].includes(text(input.position)))
    throw new Error('Choose a valid season, regular-season week, scoring format and position.');
  return { season: Number(input.season), week: Number(input.week), format: input.format as RankingList['format'], position: input.position as BotPlayer['position'] };
}
export function rankingPlayers(ids: unknown, directory: BotDirectory, position: BotPlayer['position']) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length)
    throw new Error('Publish between 1 and 30 distinct players in rank order.');
  return ids.map((id) => {
    const player = directory.players.find((player) => player.id === id && player.position === position);
    if (!player) throw new Error('Every ranked player must match the current verified roster and selected position.');
    return player;
  });
}
export function matchRankingPaste(value: string, players: BotPlayer[], position: BotPlayer['position']) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 30) throw new Error('Paste 1 to 30 player names, one per line.');
  return lines.map((line) => {
    const name = normalize(line.replace(/^\s*\d{1,2}\s*[.)\-:]?\s*/, ''));
    const matches = players.filter((player) => player.position === position && [player.name, `${player.name} ${player.teamAbbr}`, `${player.name} ${player.team}`, `${player.name} ${position} ${player.teamAbbr}`]
      .some((candidate) => normalize(candidate) === name));
    return { input: line, playerId: matches.length === 1 ? matches[0].id : '', error: matches.length > 1 ? 'Ambiguous name: choose a player.' : matches.length ? '' : 'No exact roster match: choose a player.' };
  });
}
export function readRankingList(value: unknown): RankingList {
  const row = object(value), scope = rankingScope(row);
  if (!Array.isArray(row.playerIds) || row.playerIds.length > 30 || row.playerIds.some((id) => typeof id !== 'string' || !/^\d{1,12}$/.test(id))
    || new Set(row.playerIds).size !== row.playerIds.length || row.publishedAt !== null && !Number.isFinite(Date.parse(text(row.publishedAt))))
    throw new Error('The saved weekly ranking list is incomplete. Reload before editing.');
  return { ...scope, playerIds: row.playerIds as string[], publishedAt: row.publishedAt as string | null };
}
