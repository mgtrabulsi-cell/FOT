import { supabase } from './supabaseClient';
import { array, numeric, object, text } from '../../supabase/functions/_shared/gamewaire';
import { savedNFLTouchdownOdds } from '../../supabase/functions/_shared/nflTouchdownOdds';
import type { NFLTouchdownOdds } from '../../supabase/functions/_shared/nflTouchdownOdds';
import type { Game } from './sportsData';

export async function loadSavedNFLTouchdownOdds(games: Game[], signal: AbortSignal): Promise<NFLTouchdownOdds[]> {
  if (!supabase) throw new Error('The saved touchdown odds service is not configured.');
  const client = supabase;
  const results = await Promise.all(games.map(async game => {
    const rows: NFLTouchdownOdds[] = [];
    for (let offset = 0; ; offset += 100) {
      const result = await client.from('gamewaire_runs').select('payload').eq('sport', 'NFL')
        .contains('payload', { anytimeTouchdownOdds: [{ eventId: game.eventId }] })
        .lt('finished_at', game.date).order('finished_at', { ascending: false })
        .order('id', { ascending: false }).range(offset, offset + 99).abortSignal(signal);
      if (result.error) throw new Error(`Saved touchdown odds could not load: ${result.error.message}`);
      for (const run of result.data ?? []) rows.push(...array(object(run.payload).anytimeTouchdownOdds).flatMap(value => {
        const raw = object(value);
        const row: NFLTouchdownOdds = { eventId: text(raw.eventId), kickoff: text(raw.kickoff), player: text(raw.player),
          provider: text(raw.provider), american: numeric(raw.american) ?? 0, updatedAt: text(raw.updatedAt), capturedAt: text(raw.capturedAt) };
        return savedNFLTouchdownOdds([row], game.eventId, game.date, row.player) ? [row] : [];
      }));
      if (!result.data || result.data.length < 100) break;
    }
    return rows;
  }));
  return results.flat();
}
