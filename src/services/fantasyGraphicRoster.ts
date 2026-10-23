import { readNFLActiveSkillRoster } from './sportsData';
import { publicSupabaseConfig } from './supabaseClient';
import type { Game } from './sportsData';
import { graphicPlayerMatchup, graphicPositions } from './fantasyGraphics';
import type { GraphicPlayer } from './fantasyGraphics';

// Keep bye-week teams searchable without ESPN's browser-blocked directory.
const teams = [
  { id: '22', abbreviation: 'ARI' }, { id: '1', abbreviation: 'ATL' },
  { id: '33', abbreviation: 'BAL' }, { id: '2', abbreviation: 'BUF' },
  { id: '29', abbreviation: 'CAR' }, { id: '3', abbreviation: 'CHI' },
  { id: '4', abbreviation: 'CIN' }, { id: '5', abbreviation: 'CLE' },
  { id: '6', abbreviation: 'DAL' }, { id: '7', abbreviation: 'DEN' },
  { id: '8', abbreviation: 'DET' }, { id: '9', abbreviation: 'GB' },
  { id: '34', abbreviation: 'HOU' }, { id: '11', abbreviation: 'IND' },
  { id: '30', abbreviation: 'JAX' }, { id: '12', abbreviation: 'KC' },
  { id: '13', abbreviation: 'LV' }, { id: '24', abbreviation: 'LAC' },
  { id: '14', abbreviation: 'LAR' }, { id: '15', abbreviation: 'MIA' },
  { id: '16', abbreviation: 'MIN' }, { id: '17', abbreviation: 'NE' },
  { id: '18', abbreviation: 'NO' }, { id: '19', abbreviation: 'NYG' },
  { id: '20', abbreviation: 'NYJ' }, { id: '21', abbreviation: 'PHI' },
  { id: '23', abbreviation: 'PIT' }, { id: '25', abbreviation: 'SF' },
  { id: '26', abbreviation: 'SEA' }, { id: '27', abbreviation: 'TB' },
  { id: '10', abbreviation: 'TEN' }, { id: '28', abbreviation: 'WSH' },
];
export async function fetchFantasyGraphicRoster(season: number, games: Game[], signal: AbortSignal) {
  if (!publicSupabaseConfig) throw new Error('Player search is unavailable: account services are not configured.');
  const endpoint = `${publicSupabaseConfig.url}/functions/v1/fantasy-roster`;
  const players: GraphicPlayer[] = [], failures: string[] = [];
  for (let start = 0; start < teams.length; start += 6) {
    if (signal.aborted) throw new Error('Player search was cancelled.');
    await Promise.all(teams.slice(start, start + 6).map(async (team) => {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const url = new URL(endpoint);
        url.searchParams.set('team', team.id); url.searchParams.set('season', String(season));
        const request = fetch(url, { signal }).then(async (response) => {
          if (!response.ok) {
            const body: unknown = await response.json();
            const detail = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `Roster returned HTTP ${response.status}`;
            throw new Error(detail);
          }
          return readNFLActiveSkillRoster(await response.json());
        });
        const roster = await Promise.race([request, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Roster request timed out')), 15_000);
        })]).finally(() => clearTimeout(timer));
        for (const player of roster) {
          const position = graphicPositions.find((item) => item === player.position);
          if (position) players.push({ id: player.id, name: player.name, position, teamId: team.id, teamAbbr: team.abbreviation,
            headshot: player.headshot ?? '', ...graphicPlayerMatchup(team.id, games) });
        }
      } catch (cause) { failures.push(`${team.abbreviation}: ${cause instanceof Error ? cause.message : 'Roster unavailable'}`); }
    }));
  }
  if (signal.aborted) throw new Error('Player search was cancelled or timed out. Retry player search.');
  if (!players.length) throw new Error(`No active players could be loaded. Retry player search. ${failures.join(' ')}`);
  return { players: [...new Map(players.map((player) => [player.id, player])).values()].sort((a, b) => a.name.localeCompare(b.name)),
    warning: failures.length ? `Some players are unavailable. ${failures.join(' ')}` : '' };
}
