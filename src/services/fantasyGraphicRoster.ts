import { fetchNFLActiveSkillRoster } from './sportsData';
import type { Game } from './sportsData';
import { graphicPlayerMatchup, graphicPositions } from './fantasyGraphics';
import type { GraphicPlayer } from './fantasyGraphics';

type Team = { id: string; abbreviation: string };
function readTeams(value: unknown): Team[] {
  if (!value || typeof value !== 'object' || !('sports' in value) || !Array.isArray(value.sports)) throw new Error('ESPN returned an invalid NFL team directory.');
  const teams: Team[] = [];
  for (const sport of value.sports) {
    if (!sport || !Array.isArray(sport.leagues)) throw new Error('ESPN returned an invalid NFL league.');
    for (const league of sport.leagues) {
      if (!Array.isArray(league.teams)) throw new Error('ESPN returned an invalid NFL team list.');
      for (const entry of league.teams) {
        const team = entry?.team;
        if (!team || typeof team.id !== 'string' || !/^\d+$/.test(team.id) || typeof team.abbreviation !== 'string') throw new Error('ESPN returned an invalid NFL team.');
        teams.push({ id: team.id, abbreviation: team.abbreviation });
      }
    }
  }
  if (!teams.length) throw new Error('No NFL teams were available for player search.');
  return teams;
}
export async function fetchFantasyGraphicRoster(season: number, games: Game[], signal: AbortSignal) {
  const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=32', { signal });
  if (!response.ok) throw new Error(`NFL team search returned HTTP ${response.status}.`);
  const teams = readTeams(await response.json());
  const players: GraphicPlayer[] = [], failures: string[] = [];
  for (let start = 0; start < teams.length; start += 6) {
    if (signal.aborted) throw new Error('Player search was cancelled.');
    await Promise.all(teams.slice(start, start + 6).map(async (team) => {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const request = fetchNFLActiveSkillRoster('football/nfl', team.id, season);
        const roster = await Promise.race([request, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Roster request timed out')), 15_000);
        })]).finally(() => clearTimeout(timer));
        for (const player of roster) {
          const position = graphicPositions.find((item) => item === player.position);
          if (position) players.push({ id: player.id, name: player.name, position, teamId: team.id, teamAbbr: team.abbreviation,
            headshot: player.headshot ?? '', ...graphicPlayerMatchup(team.id, games) });
        }
        if (signal.aborted) throw new Error('Player search was cancelled or timed out. Retry player search.');
        if (!players.length) throw new Error(`No active players could be loaded. ${failures.join(' ')}`);
      } catch (cause) { failures.push(`${team.abbreviation}: ${cause instanceof Error ? cause.message : 'Roster unavailable'}`); }
    }));
  }
  return { players: [...new Map(players.map((player) => [player.id, player])).values()].sort((a, b) => a.name.localeCompare(b.name)),
    warning: failures.length ? `Some players are unavailable. ${failures.join(' ')}` : '' };
}
