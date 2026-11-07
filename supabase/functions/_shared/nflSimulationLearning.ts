import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { array, numeric, object, text } from './gamewaire.ts';
import { learnAdjustment } from './gamewireLearning.ts';
import type { LearningSample } from './gamewireLearning.ts';
import { nflSimulationVersion } from './nflSimulation.ts';
import type { SimulationScenario, SimulationLearning, SimulationLearningMetric } from './nflSimulation.ts';

export const simulationLearningMetrics = ['score', 'passingYards', 'rushingYards'] as const;
export type { SimulationLearning } from './nflSimulation.ts';
export function neutralSimulationLearning(cutoff: number): SimulationLearning['adjustments'] {
  return Object.fromEntries(simulationLearningMetrics.map(metric => [metric, learnAdjustment([], 'stat', cutoff)])) as SimulationLearning['adjustments'];
}

export function simulationLearningBaselines(scenarios: SimulationScenario[]): SimulationLearning['baselines'] {
  return scenarios.filter(scenario => scenario.home && scenario.away).map(scenario => ({
    scenarioId: scenario.id, teams: [scenario.home!, scenario.away!].map(team => ({
      id: team.id, score: team.score.mean, passingYards: team.totals?.passingYards.mean ?? null,
      rushingYards: team.totals?.rushingYards.mean ?? null,
    })),
  }));
}

export async function loadSimulationLearning(admin: SupabaseClient, cutoff: number): Promise<SimulationLearning['adjustments']> {
  // v5 player production covers regulation only, while archived actuals are full-game.
  // Do not learn from incompatible outcomes until regulation actuals are archived.
  if (nflSimulationVersion === 'nfl-joint-bootstrap-v5') {
    return neutralSimulationLearning(cutoff);
  }
  const groups: Record<SimulationLearningMetric, LearningSample[]> = { score: [], passingYards: [], rushingYards: [] };
  for (let offset = 0; ; offset += 500) {
    const saved = await admin.from('gamewire_game_forecasts').select('event_id,event_start,payload,actuals,settled_at')
      .eq('model_version', nflSimulationVersion).not('settled_at', 'is', null)
      .lt('settled_at', new Date(cutoff).toISOString()).gt('event_start', new Date(cutoff - 365 * 86400000).toISOString())
      .order('event_start', { ascending: false }).order('event_id').range(offset, offset + 499);
    if (saved.error) throw new Error('Could not verify settled NFL simulation learning history.');
    for (const row of saved.data ?? []) {
      const payload = object(row.payload), actuals = object(row.actuals);
      const realized = array(actuals.realized).map(object);
      const scenario = array(payload.scenarios).map(object).find(scenario => realized.some(result => result.scenarioId === scenario.id));
      if (!scenario) continue;
      if (object(scenario.home).totals === null || object(scenario.away).totals === null) continue;
      const learning = object(payload.learning);
      const baseline = learning.version === 'simulation-walk-forward-v1'
        ? array(learning.baselines).map(object).find(baseline => baseline.scenarioId === scenario.id) : undefined;
      if (learning.version && !baseline) continue;
      const sides = baseline ? array(baseline.teams).map(object) : [scenario.home, scenario.away].map(value => {
        const team = object(value), totals = object(team.totals);
        return { id: team.id, score: numeric(object(team.score).mean),
          passingYards: numeric(object(totals.passingYards).mean), rushingYards: numeric(object(totals.rushingYards).mean) };
      });
      const finals = array(actuals.teams).map(object);
      if (sides.length !== 2 || finals.length !== 2 || new Set(sides.map(side => side.id)).size !== 2) continue;
      for (const metric of simulationLearningMetrics) {
        const predicted = sides.map(side => numeric(side[metric]));
        const observed = sides.map(side => numeric(finals.find(final => final.id === side.id)?.[metric === 'score' ? 'points' : metric]));
        if ([...predicted, ...observed].some(value => value === undefined || value < 0)) continue;
        groups[metric].push({ id: `${row.event_id}:${metric}`, eventId: row.event_id, start: row.event_start,
          recordedAt: text(payload.forecastAt), settledAt: row.settled_at,
          prediction: (predicted[0]! + predicted[1]!) / 2, actual: (observed[0]! + observed[1]!) / 2 });
      }
    }
    if ((saved.data?.length ?? 0) < 500) break;
  }
  return Object.fromEntries(simulationLearningMetrics.map(metric => [metric, learnAdjustment(groups[metric], 'stat', cutoff)])) as SimulationLearning['adjustments'];
}

export function simulationLearningFactors(adjustments: SimulationLearning['adjustments']) {
  return Object.fromEntries(simulationLearningMetrics.map(metric => [metric, adjustments[metric].active ? adjustments[metric].adjustment : 1])) as Record<SimulationLearningMetric, number>;
}
