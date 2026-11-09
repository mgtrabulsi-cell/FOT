import { normalize } from './gamewaire.ts';
import type { Evidence, Quote } from './gamewaire.ts';
import { projectedSimulationScore, roundedSimulationBox, selectedSimulationScenario } from './nflSimulation.ts';
import type { NFLGameSimulation, SimulationScenario, SimulationStat } from './nflSimulation.ts';
import { forecastDistribution } from './gamewireBotIntelligence.ts';
import type { BotProjection } from './gamewireBotProjections.ts';

export function defaultSimulationScenario(forecast: NFLGameSimulation): SimulationScenario | undefined {
  return selectedSimulationScenario(forecast);
}

export function simulationAllowsMoneyline(pick: Quote, forecast: NFLGameSimulation | undefined): boolean {
  if (pick.sport !== 'NFL' || pick.market !== 'h2h') return true;
  if (!forecast || Date.parse(forecast.kickoff) !== Date.parse(pick.start)) return false;
  const scenario = defaultSimulationScenario(forecast);
  if (!scenario?.home || !scenario.away) return false;
  if (normalize(pick.home) !== normalize(scenario.home.name) || normalize(pick.away) !== normalize(scenario.away.name)) return false;
  const score = projectedSimulationScore(scenario);
  if (!score) return false;
  return normalize(pick.subject) === normalize(score.home > score.away ? scenario.home.name : scenario.away.name);
}

const projectionStats: Record<string, keyof SimulationStat> = {
  player_pass_yds: 'passingYards', player_rush_yds: 'rushingYards',
  player_reception_yds: 'receivingYards', player_receptions: 'receptions',
};
export function alignSimulationEvidence(quotes: Quote[], evidence: Map<string, Evidence>, forecast: NFLGameSimulation | undefined) {
  const aligned = new Map(evidence), scenario = forecast && defaultSimulationScenario(forecast);
  for (const quote of quotes) {
    if (quote.sport !== 'NFL' || !quote.market.startsWith('player_')) continue;
    const data = evidence.get(quote.key);
    if (!data) continue;
    const team = [scenario?.home, scenario?.away].find(row => row?.id === data.identifiers?.teamId);
    const playerId = data.identifiers?.playerId, stat = projectionStats[quote.market];
    const player = team?.players.find(row => row.id === playerId);
    const estimate = team?.totals && playerId && stat && player && !player.issue
      ? roundedSimulationBox({ ...team, totals: team.totals }).players[playerId]?.[stat] : undefined;
    const matches = forecast && scenario?.home && scenario.away && Date.parse(forecast.kickoff) === Date.parse(quote.start)
      && normalize(scenario.home.name) === normalize(quote.home) && normalize(scenario.away.name) === normalize(quote.away);
    aligned.set(quote.key, matches && estimate !== undefined ? { ...data, simulationProjection: estimate }
      : { ...data, eligible: false, reason: 'Matching saved GamewAIre player simulation unavailable; no conflicting prop was substituted.' });
  }
  return aligned;
}
export function reconcileSimulationProjections(projections: BotProjection[], forecast: NFLGameSimulation, teamId: string, playerId: string): BotProjection[] {
  const scenario = defaultSimulationScenario(forecast);
  const team = [scenario?.home, scenario?.away].find(row => row?.id === teamId);
  if (!team?.totals || !team.players.some(player => player.id === playerId && !player.issue)) return projections;
  const box = roundedSimulationBox({ ...team, totals: team.totals });
  return projections.map(projection => {
    const key = projectionStats[projection.market], estimate = key ? box.players[playerId]?.[key] : undefined;
    if (estimate === undefined) return projection;
    const originalEstimate = projection.simulation ? projection.simulation.originalEstimate : projection.estimate;
    return { ...projection, estimate, yards: projection.unit === 'yards' ? estimate : projection.yards,
      simulation: { eventId: forecast.eventId, scenarioId: scenario!.id, version: forecast.version, forecastAt: forecast.forecastAt!, originalEstimate },
      distribution: forecastDistribution(estimate, projection.evidence?.observations ?? [], projection.unit === 'receptions') ?? undefined,
      explanation: `${projection.explanation} Game-specific estimate reconciled to the saved GamewAIre simulation (${scenario!.label}). Rankings and Start/Sit editorial context remain independent.`,
    };
  });
}
