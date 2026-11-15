import { normalize, object } from './gamewaire.ts';
import type { Evidence, Quote } from './gamewaire.ts';
import { projectedSimulationScore, roundedSimulationBox, selectedSimulationScenario } from './nflSimulation.ts';
import type { NFLGameSimulation, SimulationScenario, SimulationStat } from './nflSimulation.ts';
import { forecastDistribution } from './gamewireBotIntelligence.ts';
import type { BotProjection } from './gamewireBotProjections.ts';

export function defaultSimulationScenario(forecast: NFLGameSimulation): SimulationScenario | undefined {
  return selectedSimulationScenario(forecast);
}
export function simulationAlignmentStamp(forecast: NFLGameSimulation | undefined) {
  const scenario = forecast && defaultSimulationScenario(forecast);
  return forecast && scenario ? { eventId: forecast.eventId, version: forecast.version,
    forecastAt: forecast.forecastAt, scenarioId: scenario.id } : null;
}
export function matchesSimulationAlignment(value: unknown, forecast: NFLGameSimulation | undefined) {
  const expected = simulationAlignmentStamp(forecast), saved = object(value);
  return expected !== null && Object.entries(expected).every(([key, entry]) => saved[key] === entry);
}

export function simulationAllowsMoneyline(pick: Quote, forecast: NFLGameSimulation | undefined): boolean {
  return pick.market !== 'h2h' || simulationAllowsTeamPick(pick, forecast);
}

const projectionStats: Record<string, keyof SimulationStat> = {
  player_pass_yds: 'passingYards', player_rush_yds: 'rushingYards',
  player_reception_yds: 'receivingYards', player_receptions: 'receptions',
};
function simulationTeamProjection(quote: Quote, forecast: NFLGameSimulation | undefined): number | undefined {
  const scenario = forecast && defaultSimulationScenario(forecast);
  if (!forecast || !scenario?.home || !scenario.away || Date.parse(forecast.kickoff) !== Date.parse(quote.start)
    || normalize(scenario.home.name) !== normalize(quote.home) || normalize(scenario.away.name) !== normalize(quote.away)) return undefined;
  const score = projectedSimulationScore(scenario);
  if (!score) return undefined;
  if (quote.market === 'totals') return score.home + score.away;
  if (!['h2h', 'spreads'].includes(quote.market)) return undefined;
  if (normalize(quote.subject) === normalize(scenario.home.name)) return score.home - score.away;
  if (normalize(quote.subject) === normalize(scenario.away.name)) return score.away - score.home;
  return undefined;
}
export function simulationAllowsTeamPick(quote: Quote, forecast: NFLGameSimulation | undefined): boolean {
  if (quote.sport !== 'NFL' || !['h2h', 'spreads', 'totals'].includes(quote.market)) return true;
  const projection = simulationTeamProjection(quote, forecast);
  if (projection === undefined) return false;
  if (quote.market === 'h2h') return projection > 0;
  if (quote.line === null || !Number.isFinite(quote.line)) return false;
  return quote.market === 'spreads' ? projection + quote.line > 0
    : (quote.side === 'Under' ? -1 : 1) * (projection - quote.line) > 0;
}
export function alignSimulationEvidence(quotes: Quote[], evidence: Map<string, Evidence>, forecast: NFLGameSimulation | undefined) {
  const aligned = new Map(evidence), scenario = forecast && defaultSimulationScenario(forecast);
  for (const quote of quotes) {
    if (quote.sport !== 'NFL') continue;
    const data = evidence.get(quote.key);
    if (!data) continue;
    if (!quote.market.startsWith('player_')) {
      const estimate = simulationTeamProjection(quote, forecast);
      aligned.set(quote.key, estimate !== undefined && (!data.identifiers?.espnEventId || data.identifiers.espnEventId === forecast?.eventId)
        ? { ...data, simulationProjection: estimate }
        : { ...data, eligible: false, reason: 'Matching saved GamewAIre team simulation unavailable; no conflicting team pick was substituted.' });
      continue;
    }
    const team = [scenario?.home, scenario?.away].find(row => row?.id === data.identifiers?.teamId);
    const playerId = data.identifiers?.playerId, stat = projectionStats[quote.market];
    const player = team?.players.find(row => row.id === playerId);
    const estimate = team?.totals && playerId && stat && player && !player.issue
      ? roundedSimulationBox({ ...team, totals: team.totals }).players[playerId]?.[stat] : undefined;
    const matches = forecast && (!data.identifiers?.espnEventId || data.identifiers.espnEventId === forecast.eventId)
      && scenario?.home && scenario.away && Date.parse(forecast.kickoff) === Date.parse(quote.start)
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
