import { fetchTeamRegularGameLog, fetchTeamLogDirectory, teamLogResult, teamSeasonLabel } from './teamGameLogs';
import type { TeamLogEntry, TeamLogLeague } from './teamGameLogs';
import type { Team } from './sportsData';
import { fetchStaticSports } from './sportsDatabase';

export type LabTeam = { league: TeamLogLeague; season: number; team: Team };
export type TeamRecord = { label: string; wins: number; losses: number; ties: number; games: number; percent: number | null };
export type TeamTrendReport = { scope: LabTeam; seasons: number[]; rows: TeamRecord[]; issues: string[]; checkedAt: string; byeSupported: boolean };
export const isTeamTrendQuestion = (question: string) => !/\b(points?|yards?|rebounds?|assists?|pra|threes?|3pm|receptions?|receiving|rushing|passing|touchdowns?)\b/i.test(question)
  && /\brecords?\b(?!\s+\d)|\bhome\b|\baway\b|\broad\b|\bbye\b|\b(?:after|off|following)\b.*\b(?:loss|losses|losing)\b/i.test(question);
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export async function resolveLabTeam(question: string, signal: AbortSignal, context?: LabTeam): Promise<LabTeam> {
  const leagues: TeamLogLeague[] = /\bnba\b/i.test(question) ? ['NBA'] : /\bnfl\b/i.test(question) ? ['NFL'] : ['NFL', 'NBA'];
  const matches: LabTeam[] = [], failures: string[] = [];
  for (const league of leagues) {
    try {
      const directory = await fetchTeamLogDirectory(league, signal), query = ` ${normalize(question)} `;
      for (const team of directory.teams) if ([team.name, team.abbr, team.name.split(' ').at(-1)!]
        .some(name => query.includes(` ${normalize(name)} `))) matches.push({ league, season: directory.season, team });
    } catch (cause) {
      signal.throwIfAborted();
      console.error('Team research directory failed', league, cause);
      failures.push(`${league}: ${cause instanceof Error ? cause.message : 'Team directory unavailable'}`);
    }
  }
  if (failures.length) throw new Error(`Team identity could not be fully verified. ${failures.join(' ')} Specify NFL or NBA and retry.`);
  if (!matches.length && context) return context;
  if (matches.length !== 1) throw new Error(matches.length ? 'Use the full team name and NFL or NBA to disambiguate this request.'
    : 'Name an NFL or NBA team—for example, “NFL Bengals home record after a loss”.');
  return matches[0];
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function readOfficialBye(value: unknown, teamId: string, season: number): { week: number; nextGameId: string } {
  const data = object(value), requested = object(data.requestedSeason ?? data.season);
  if (String(object(data.team).id) !== teamId || Number(requested.year) !== season || Number(requested.type) !== 2
    || !Array.isArray(data.events) || data.events.length !== 17) throw new Error('A complete 17-game regular-season schedule is required to verify the official bye.');
  const weeks = new Map<number, string>();
  for (const raw of data.events) {
    const event = object(raw), week = Number(object(event.week).number), competitions = event.competitions;
    const competition = object(Array.isArray(competitions) ? competitions[0] : undefined), competitors = competition.competitors;
    if (!Number.isInteger(week) || week < 1 || week > 18 || weeks.has(week) || !/^\d+$/.test(String(event.id))
      || !Array.isArray(competitors) || competitors.length !== 2
      || !competitors.some(row => String(object(object(row).team).id) === teamId)) throw new Error('The official bye schedule has incomplete or conflicting weeks/team identities.');
    weeks.set(week, String(event.id));
  }
  const missing = Array.from({ length: 18 }, (_, index) => index + 1).filter(week => !weeks.has(week));
  if (missing.length !== 1 || missing[0] === 1 || missing[0] === 18 || !weeks.has(missing[0] + 1)) throw new Error('The official regular-season bye could not be confirmed.');
  return { week: missing[0], nextGameId: weeks.get(missing[0] + 1)! };
}
export function buildTeamRecords(scope: LabTeam, seasons: { season: number; entries: TeamLogEntry[]; byeGameId?: string }[], question: string): TeamRecord[] {
  const hasHome = /\bhome\b/i.test(question), hasAway = /\baway\b|\broad\b/i.test(question);
  const venue = hasHome !== hasAway ? hasHome ? 'Home ' : 'Away ' : '';
  const rows: TeamRecord[] = ['Overall', 'Home', 'Away', `${venue}After a loss`, `${venue}After 2+ consecutive losses`,
    ...(scope.league === 'NFL' ? [`${venue}After official bye`] : [])]
    .map(label => ({ label, wins: 0, losses: 0, ties: 0, games: 0, percent: null }));
  const add = (row: TeamRecord, result: string) => {
    row.games++; if (result === 'W') row.wins++; else if (result === 'L') row.losses++; else row.ties++;
    row.percent = (row.wins + row.ties * .5) / row.games * 100;
  };
  for (const season of seasons) {
    const entries = [...new Map(season.entries.filter(row => row.seasonType === 2 && row.game.status === 'FINAL'
      && row.game.seasonYear === season.season && Date.parse(row.game.date) < Date.now()
      && [row.game.home.id, row.game.away.id].includes(scope.team.id)).map(row => [row.game.eventId, row])).values()]
      .sort((a, b) => Date.parse(a.game.date) - Date.parse(b.game.date));
    let losses = 0;
    for (const { game } of entries) {
      const result = teamLogResult(game, scope.team.id), home = !game.neutralSite && game.home.id === scope.team.id;
      const away = !game.neutralSite && game.away.id === scope.team.id, venueMatches = venue === '' || (hasHome ? home : away);
      add(rows[0], result);
      if (home) add(rows[1], result);
      if (away) add(rows[2], result);
      if (venueMatches && losses >= 1) add(rows[3], result);
      if (venueMatches && losses >= 2) add(rows[4], result);
      if (scope.league === 'NFL' && venueMatches && game.eventId === season.byeGameId) add(rows[5], result);
      losses = result === 'L' ? losses + 1 : 0;
    }
  }
  return rows;
}
export async function teamTrendReport(question: string, signal: AbortSignal, context?: LabTeam): Promise<TeamTrendReport> {
  const scope = await resolveLabTeam(question, signal, context), years = [scope.season, scope.season - 1, scope.season - 2], issues: string[] = [];
  const seasons: { season: number; entries: TeamLogEntry[]; byeGameId?: string }[] = [];
  let byes = 0;
  await Promise.all(years.map(async season => {
    let entries: TeamLogEntry[];
    try { entries = await fetchTeamRegularGameLog(scope.league, scope.team.id, season, signal); }
    catch (cause) {
      signal.throwIfAborted();
      console.error('Team research season failed', scope.team.id, season, cause);
      issues.push(`${teamSeasonLabel(scope.league, season)} season unavailable: ${cause instanceof Error ? cause.message : 'Game logs could not load'}`);
      return;
    }
    const row: typeof seasons[number] = { season, entries };
    if (scope.league === 'NFL') {
      try {
        const response = await fetchStaticSports(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${scope.team.id}/schedule?season=${season}&seasontype=2&limit=1000`,
          AbortSignal.any([signal, AbortSignal.timeout(15000)]));
        if (!response.ok) throw new Error(`Schedule returned HTTP ${response.status}`);
        row.byeGameId = readOfficialBye(await response.json(), scope.team.id, season).nextGameId;
        byes++;
      } catch (cause) {
        signal.throwIfAborted();
        console.error('Official bye verification failed', scope.team.id, season, cause);
        issues.push(`${season} bye unavailable: ${cause instanceof Error ? cause.message : 'Official schedule could not be verified'}`);
      }
    }
    seasons.push(row);
  }));
  signal.throwIfAborted();
  if (!seasons.length) throw new Error(`No verified team seasons loaded. ${issues.join(' ')}`);
  const rows = buildTeamRecords(scope, seasons, question);
  if (scope.league === 'NFL' && byes === 0) rows[5].percent = null;
  return { scope, seasons: years, rows, issues, checkedAt: new Date().toISOString(), byeSupported: scope.league === 'NFL' && byes > 0 };
}
