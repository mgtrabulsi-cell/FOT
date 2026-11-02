import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { numeric, object, text } from './gamewaire.ts';
import { learnAdjustment, pickLearningKey } from './gamewireLearning.ts';
import type { LearningAdjustment, LearningSample } from './gamewireLearning.ts';
export async function loadPickLearning(admin: SupabaseClient, sport: string, baseModel: string, cutoff: number) {
  const groups = new Map<string, LearningSample[]>();
  for (let offset = 0; ; offset += 500) {
    const saved = await admin.from('gamewaire_picks').select('id,event_id,event_start,created_at,settled_at,probability,push_probability,result,market,side,data')
      .eq('sport', sport).eq('withdrawn', false).or('is_top_pick.eq.true,is_game_lean.eq.true')
      .in('result', ['win', 'loss']).lt('settled_at', new Date(cutoff).toISOString())
      .gt('event_start', new Date(cutoff - 365 * 86400000).toISOString())
      .order('event_start', { ascending: false }).order('id').range(offset, offset + 499);
    if (saved.error) throw new Error('Could not verify settled game-pick learning history.');
    for (const row of saved.data) {
      const data = object(row.data), learning = object(data.learning);
      if ((text(learning.baseModelVersion) || text(data.modelVersion)) !== baseModel) continue;
      const push = numeric(row.push_probability), probability = numeric(row.probability);
      const prediction = numeric(learning.baseConditional) ?? (push !== undefined && push < 1 && probability !== undefined ? probability / (1 - push) : undefined);
      if (prediction === undefined) continue;
      const key = pickLearningKey(text(row.market), text(row.side)), samples = groups.get(key) ?? [];
      const mirrored = key.endsWith(':team') && prediction < .5;
      samples.push({ id: row.id, eventId: row.event_id, start: row.event_start, recordedAt: row.created_at,
        settledAt: row.settled_at, prediction: mirrored ? 1 - prediction : prediction,
        actual: (row.result === 'win') !== mirrored ? 1 : 0 });
      groups.set(key, samples);
    }
    if (saved.data.length < 500) break;
  }
  return new Map<string, LearningAdjustment>([...groups].map(([key, samples]) => [key, learnAdjustment(samples, 'probability', cutoff)]));
}
