import { supabase } from './supabaseClient';
import type { BotDirectory, BotFormat, BotPlayer, BotReport } from '../../supabase/functions/_shared/gamewireBot';
export type { BotDirectory, BotFormat, BotPlayer, BotReport } from '../../supabase/functions/_shared/gamewireBot';

async function request<T>(body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  if (!supabase) throw new Error('Account services are not configured.');
  const { data: session, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session.session) throw new Error('Sign in to use GamewAIre player analysis.');
  const { data, error } = await supabase.functions.invoke<T>('gamewire-bot', { body, signal,
    headers: { Authorization: `Bearer ${session.session.access_token}` } });
  if (error) {
    if (error.context instanceof Response) {
      const detail: unknown = await error.context.json();
      if (detail && typeof detail === 'object' && 'error' in detail && typeof detail.error === 'string') throw new Error(detail.error);
    }
    throw new Error(error.message || 'The verified player breakdown could not load. Retry.');
  }
  if (!data) throw new Error('The Bot returned an empty response. Retry.');
  return data;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof value[key] === 'string');
const list = (value: unknown, check: (item: unknown) => boolean) => Array.isArray(value) && value.every(check);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function validPlayer(value: unknown): value is BotPlayer {
 const row = object(value);
 return strings(row, ['id', 'name', 'position', 'teamId', 'team', 'teamAbbr']) && /^\d{1,12}$/.test(String(row.id))
   && /^\d{1,2}$/.test(String(row.teamId)) && ['QB', 'RB', 'WR', 'TE'].includes(String(row.position));
}
function validReport(value: unknown): value is BotReport {
 const row = object(value), editorial = object(row.editorial), ranking = object(editorial.ranking), matchup = object(row.matchup);
 const stats = (item: unknown) => { const stat = object(item); return strings(stat, ['label']) && finite(stat.average) && Number.isInteger(stat.games) && Number(stat.games) > 0; };
 return validPlayer(row.player) && strings(row, ['checkedAt', 'summary', 'matchupText', 'availability', 'propNote'])
   && Number.isFinite(Date.parse(String(row.checkedAt))) && Number.isInteger(row.season) && Number.isInteger(row.week)
   && ['ppr', 'half', 'standard'].includes(String(row.format)) && typeof row.eligibleForGuidance === 'boolean'
   && ['Must Start', 'Start', 'Flex', 'Sit', 'Must Sit', 'Monitor', 'No upcoming game', 'Game locked'].includes(String(row.indication))
   && list(row.workload, stats) && list(row.production, stats) && (row.fantasyAverage === null || finite(row.fantasyAverage))
   && list(row.warnings, (item) => typeof item === 'string')
   && list(row.dataIssues, (item) => typeof item === 'string')
   && list(row.projections, (item) => {
     const projection = object(item);
     return strings(projection, ['market', 'label', 'context', 'explanation']) && ['yards', 'receptions'].includes(String(projection.unit))
       && (projection.estimate === null || finite(projection.estimate))
       && ['baseline', 'defenseAverage', 'share', 'historyAverage', 'contenderAverage'].every((key) => projection[key] === null || finite(projection[key]))
       && ['playerGames', 'defenseGames', 'historyGames', 'contenderGames'].every((key) => Number.isInteger(projection[key]))
       && list(projection.sourceGames, (item) => { const game = object(item); return strings(game, ['id', 'date']) && /^\d+$/.test(String(game.id)) && ['team', 'opponent'].includes(String(game.role)); })
       && list(projection.warnings, (warning) => typeof warning === 'string');
   })
   && (row.matchup === null || strings(matchup, ['eventId', 'start', 'opponentId', 'opponent']) && typeof matchup.home === 'boolean' && ['pre', 'in', 'post'].includes(String(matchup.state)))
   && list(row.props, (item) => { const prop = object(item); return strings(prop, ['selection', 'book', 'savedAt', 'breakdown']) && finite(prop.american); })
   && list(editorial.graphics, (item) => { const graphic = object(item); return strings(graphic, ['id', 'reason', 'updatedAt']) && ['start', 'sit'].includes(String(graphic.kind)); })
   && (editorial.ranking === null || strings(ranking, ['position', 'format', 'publishedAt']) && Number.isInteger(ranking.rank) && Number(ranking.rank) >= 1 && Number(ranking.rank) <= 30);
}
export function readBotReport(value: unknown): BotReport {
 if (!validReport(value)) throw new Error('The Bot returned an incomplete player breakdown. Refresh the preview and retry.');
 return value;
}
function validDirectory(value: unknown): value is BotDirectory {
 const row = object(value);
 return list(row.players, validPlayer) && Number.isInteger(row.season) && Number.isInteger(row.week)
   && Number.isInteger(row.seasonType) && typeof row.checkedAt === 'string' && list(row.warnings, (item) => typeof item === 'string');
}
export async function loadBotDirectory(signal: AbortSignal) {
 const data = await request<unknown>({ action: 'directory' }, signal);
 if (!validDirectory(data)) throw new Error('The Bot returned an invalid NFL directory. Retry player search.');
 return data;
}
export async function loadBotReport(playerId: string, format: BotFormat, signal: AbortSignal) {
 const data = await request<unknown>({ action: 'breakdown', playerId, format }, signal);
 return readBotReport(object(data).report);
}
