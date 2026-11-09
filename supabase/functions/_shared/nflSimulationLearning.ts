import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { array, numeric, object, text } from './gamewaire.ts';
import { learnAdjustment } from './gamewireLearning.ts';
import type { LearningSample } from './gamewireLearning.ts';
import { nflSimulationVersion, simulationStatKeys } from './nflSimulation.ts';
import type { SimulationScenario, SimulationLearning, SimulationLearningMetric, SimulationPlayerLearningKey } from './nflSimulation.ts';

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
      players: team.players.map(player => ({ id: player.id, position: player.position,
        stats: Object.fromEntries(Object.entries(player.stats).map(([key, range]) => [key, range.mean])) })),
    })),
  }));
}

export type SimulationLearningInput = Pick<SimulationLearning, 'adjustments' | 'playerAdjustments'>;
export async function loadSimulationLearning(admin: SupabaseClient, cutoff: number): Promise<SimulationLearningInput> {
  const groups: Record<SimulationLearningMetric, LearningSample[]> = { score: [], passingYards: [], rushingYards: [] };
  const playerGroups = new Map<SimulationPlayerLearningKey, LearningSample[]>();
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
      const baseline = ['simulation-walk-forward-v1', 'simulation-walk-forward-v2'].includes(String(learning.version))
        ? array(learning.baselines).map(object).find(baseline => baseline.scenarioId === scenario.id) : undefined;
      if (learning.version && !baseline) continue;
      const sides = baseline ? array(baseline.teams).map(object) : [scenario.home, scenario.away].map(value => {
        const team = object(value), totals = object(team.totals);
        return { id: team.id, score: numeric(object(team.score).mean),
          passingYards: numeric(object(totals.passingYards).mean), rushingYards: numeric(object(totals.rushingYards).mean) };
      });
      const finals = array(actuals.teams).map(object);
      if (sides.length !== 2 || finals.length !== 2 || new Set(sides.map(side => side.id)).size !== 2
        || new Set(finals.map(side => side.id)).size !== 2 || !sides.every(side => finals.some(final => final.id === side.id))) continue;
      const sample = (metric: string, observations: NonNullable<LearningSample['observations']>): LearningSample => ({
        id: `${row.event_id}:${metric}`, eventId: row.event_id, start: row.event_start,
        recordedAt: text(payload.forecastAt), settledAt: row.settled_at,
        prediction: observations.reduce((sum, value) => sum + value.prediction, 0) / observations.length,
        actual: observations.reduce((sum, value) => sum + value.actual, 0) / observations.length, observations,
      });
      for (const metric of simulationLearningMetrics) {
        if (metric !== 'score' && actuals.regulationOnly !== true) continue;
        const predicted = sides.map(side => numeric(side[metric]));
        const observed = sides.map(side => numeric(finals.find(final => final.id === side.id)?.[metric === 'score' ? 'points' : metric]));
        if ([...predicted, ...observed].some(value => value === undefined || value < 0)) continue;
        const observations = predicted.flatMap((prediction, index) => prediction! > 0 ? [{ prediction: prediction!, actual: observed[index]! }] : []);
        if (observations.length === 2) groups[metric].push(sample(metric, observations));
      }
      const neutralLegacy = learning.version === 'simulation-walk-forward-v1' && simulationLearningMetrics.every(metric => {
        const adjustment = object(object(learning.adjustments)[metric]);
        return adjustment.active === false && adjustment.adjustment === 1;
      });
      if ((!neutralLegacy && learning.version !== 'simulation-walk-forward-v2') || actuals.regulationOnly !== true) continue;
      const perGame = new Map<SimulationPlayerLearningKey, NonNullable<LearningSample['observations']>>();
      for (const side of sides) {
        const actualPlayers = object(finals.find(final => final.id === side.id)?.players);
        const originalTeam = [scenario.home, scenario.away].map(object).find(team => team.id === side.id);
        const players = array(neutralLegacy ? originalTeam?.players : object(side).players).map(object);
        if (new Set(players.map(player => player.id)).size !== players.length) continue;
        for (const player of players) {
          if (!['QB', 'RB', 'WR', 'TE'].includes(text(player.position)) || !text(player.id)) continue;
          const stats = object(player.stats), actual = object(actualPlayers[text(player.id)]);
          for (const stat of simulationStatKeys) {
            const prediction = numeric(neutralLegacy ? object(stats[stat]).mean : stats[stat]), observed = numeric(actual[stat]);
            if (prediction === undefined || prediction <= 0 || observed === undefined || observed < 0) continue;
            const key = `${player.position}:${stat}` as SimulationPlayerLearningKey;
            const observations = perGame.get(key) ?? [];
            observations.push({ prediction, actual: observed }); perGame.set(key, observations);
          }
        }
      }
      for (const [key, observations] of perGame) {
        const samples = playerGroups.get(key) ?? [];
        samples.push(sample(key, observations)); playerGroups.set(key, samples);
      }
    }
    if ((saved.data?.length ?? 0) < 500) break;
  }
  return {
    adjustments: Object.fromEntries(simulationLearningMetrics.map(metric => [metric, learnAdjustment(groups[metric], 'stat', cutoff)])) as SimulationLearning['adjustments'],
    playerAdjustments: Object.fromEntries([...playerGroups].map(([key, samples]) => [key, learnAdjustment(samples, 'stat', cutoff)])),
  };
}

export function simulationLearningFactors(adjustments: SimulationLearning['adjustments']) {
  return Object.fromEntries(simulationLearningMetrics.map(metric => [metric, adjustments[metric].active ? adjustments[metric].adjustment : 1])) as Record<SimulationLearningMetric, number>;
}
