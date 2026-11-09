import { array, object, text } from './gamewaire.ts';
import type { NFLGameSimulation, SimulationGame, SimulationPlayer } from './nflSimulation.ts';

export type SimulationQB = { id: string | null; name: string; confirmed: boolean; source: 'game-roster' | 'projected' | 'unavailable' };
export type SimulationQBMatchup = {
  scenarioId: string; home: SimulationQB; away: SimulationQB; checkedAt: string; lockAt: string;
  lockedAt: string | null; revision: number; revisionReason?: string;
};
export const simulationLockLead = 30 * 60000;

export function confirmedSimulationQBs(value: unknown, game: SimulationGame) {
  const data = object(value), header = object(data.header), competition = object(array(header.competitions)[0]);
  if (text(header.id) !== game.id || Date.parse(text(competition.date)) !== Date.parse(game.date)
    || text(object(object(competition.status).type).state) !== 'pre'
    || array(competition.competitors).length !== 2
    || ![game.home.id, game.away.id].every(id => array(competition.competitors).some(raw => text(object(object(raw).team).id) === id)))
    throw new Error('QB confirmation must come from the verified pregame roster for this game.');
  const results = new Map<string, SimulationQB>();
  for (const team of [game.home, game.away]) {
    const roster = array(data.rosters).map(object).find(row => text(object(row.team).id) === team.id);
    const box = array(object(data.boxscore).players).map(object).find(row => text(object(row.team).id) === team.id);
    const entries = [...array(roster?.entries), ...array(box?.statistics).flatMap(raw => array(object(raw).athletes))].map(object);
    const declared = entries.filter(row => row.starter === true && row.active !== false && row.inactive !== true
      && object(row.athlete).active !== false
      && (text(object(object(row.athlete).position).abbreviation) || text(object(row.position).abbreviation)) === 'QB');
    const unique = new Map(declared.map(row => {
      const athlete = object(row.athlete);
      return [text(athlete.id), athlete];
    }));
    if (unique.size > 1) throw new Error(`${team.abbr}: the game roster reports conflicting starting quarterbacks.`);
    const athlete = [...unique.values()][0];
    if (!athlete) continue;
    if (!/^\d{1,12}$/.test(text(athlete.id)) || !text(athlete.displayName))
      throw new Error(`${team.abbr}: a reported starting quarterback has incomplete identity.`);
    results.set(team.id, { id: text(athlete.id), name: text(athlete.displayName), confirmed: true, source: 'game-roster' });
  }
  return results;
}

export function simulationQBChoices(game: SimulationGame, players: SimulationPlayer[], confirmed: Map<string, SimulationQB>,
  previous?: NFLGameSimulation) {
  const choose = (teamId: string, side: 'home' | 'away'): SimulationQB => {
    const declared = confirmed.get(teamId);
    if (declared) return declared;
    if (previous?.qbMatchup?.lockedAt) return previous.qbMatchup[side];
    const prior = previous?.qbMatchup?.[side]?.id
      ?? previous?.scenarios.find(row => row.home && row.away)?.id.split(':')[side === 'home' ? 0 : 1];
    const candidates = players.filter(player => player.teamId === teamId && player.position === 'QB' && !player.excluded)
      .map((player, index) => ({ player, index }))
      .sort((a, b) => Number(a.player.role.match(/rank (\d+)/)?.[1] ?? 100) - Number(b.player.role.match(/rank (\d+)/)?.[1] ?? 100)
        || Number(b.player.id === prior) - Number(a.player.id === prior) || a.index - b.index);
    const player = candidates[0]?.player;
    return player ? { id: player.id, name: player.name, confirmed: false, source: 'projected' }
      : previous?.qbMatchup?.[side]?.id ? { ...previous.qbMatchup[side], confirmed: false, source: 'projected' }
      : { id: null, name: 'QB unconfirmed', confirmed: false, source: 'unavailable' };
  };
  return { home: choose(game.home.id, 'home'), away: choose(game.away.id, 'away') };
}

export function confirmedSimulationMatchupChanged(previous: NFLGameSimulation, choices: { home: SimulationQB; away: SimulationQB }) {
  return (['home', 'away'] as const).some(side => choices[side].confirmed && choices[side].id !== previous.qbMatchup?.[side].id);
}

export function applySimulationQBMatchup(forecast: NFLGameSimulation, choices: { home: SimulationQB; away: SimulationQB }, now: number) {
  if (forecast.status !== 'ready') return forecast;
  const target = `${choices.home.id}:${choices.away.id}`;
  const scenario = forecast.scenarios.find(row => row.id === target && row.home && row.away)
    ?? forecast.scenarios.find(row => row.id === 'team-only' && row.home && row.away);
  if (!scenario) throw new Error('The selected QB matchup needs verified player history. The prior simulation remains visible while a revision prepares.');
  const matchup: SimulationQBMatchup = { ...forecast.qbMatchup, ...choices, scenarioId: scenario.id, checkedAt: new Date(now).toISOString(),
    lockAt: new Date(Date.parse(forecast.kickoff) - simulationLockLead).toISOString(), lockedAt: forecast.qbMatchup?.lockedAt ?? null,
    revision: forecast.qbMatchup?.revision ?? 0 };
  return { ...forecast, qbMatchup: matchup,
    scenarios: [scenario, ...forecast.scenarios.filter(row => row.id !== scenario.id)] };
}
