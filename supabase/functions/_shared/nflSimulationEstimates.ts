import type { SimulationBox, SimulationGame, SimulationObservation, SimulationPlayer, SimulationStat } from './nflSimulation.ts';

const markets = [
  { positions: ['QB'], keys: ['passingAttempts', 'completions', 'passingYards', 'passingTouchdowns'] },
  { positions: ['QB', 'RB'], keys: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'] },
  { positions: ['RB', 'WR', 'TE'], keys: ['receptions', 'receivingYards', 'receivingTouchdowns'] },
] satisfies Array<{ positions: string[]; keys: Array<keyof SimulationStat> }>;

export function withTeamPositionEstimates(game: SimulationGame, players: SimulationPlayer[], roster: SimulationPlayer[],
  history: { home: SimulationBox[]; away: SimulationBox[] }, actuals: Map<string, SimulationObservation[]>) {
  const result = new Map(actuals), positions = new Map(roster.map(player => [player.id, player.position]));
  for (const player of players.filter(player => !player.excluded)) {
    const observed = actuals.get(player.id) ?? [];
    const missing = markets.filter(market => market.positions.includes(player.position)
      && observed.filter(row => market.keys.every(key => row.player[key] !== undefined)
        && (market.keys[0] !== 'passingAttempts' || (row.player.passingAttempts ?? 0) >= 10)).length < 4);
    if (!missing.length) continue;
    const estimates: SimulationObservation[] = [];
    const seen = new Set<string>();
    for (const box of history[player.teamId === game.home.id ? 'home' : 'away']) {
      if (seen.has(box.id) || box.regulationOnly !== true || Date.parse(box.date) >= Date.parse(game.date)) continue;
      seen.add(box.id);
      const team = box.teams.find(side => side.id === player.teamId), opponent = box.teams.find(side => side.id !== player.teamId);
      if (!team || !opponent) continue;
      const stats: Partial<SimulationStat> = {};
      for (const market of missing) {
        if (observed.some(row => row.eventId === box.id && market.keys.every(key => row.player[key] !== undefined)
          && (market.keys[0] !== 'passingAttempts' || (row.player.passingAttempts ?? 0) >= 10))) continue;
        const samples = market.keys[0] === 'passingAttempts'
          ? team.passingAttempts >= 10 ? [team] : []
          : Object.entries(team.players).filter(([id, line]) => (positions.get(id) === player.position
            || player.position === 'QB' && (line.passingAttempts ?? 0) >= 10)
            && market.keys.every(key => line[key] !== undefined)).map(([, line]) => line);
        if (!samples.length) continue;
        for (const key of market.keys) stats[key] = samples.reduce((sum, line) => sum + line[key]!, 0) / samples.length;
      }
      if (Object.keys(stats).length) estimates.push({ eventId: box.id, date: box.date, teamId: team.id,
        opponentId: opponent.id, player: stats, team, basis: 'team-position-average-v1' });
    }
    // A prior requires its own minimum cohort; three personal games plus one estimate are not four verified appearances.
    const supported = missing.filter(market => estimates.filter(row => market.keys.every(key => row.player[key] !== undefined)).length >= 4);
    const keys = new Set(supported.flatMap(market => market.keys));
    const usable = estimates.map(row => ({ ...row, player: Object.fromEntries(
      Object.entries(row.player).filter(([key]) => keys.has(key as keyof SimulationStat))) }))
      .filter(row => Object.keys(row.player).length);
    if (usable.length) result.set(player.id, [...observed, ...usable].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)));
  }
  return result;
}
