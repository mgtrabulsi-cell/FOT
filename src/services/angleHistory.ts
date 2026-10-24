import type { Game } from './sportsData';
import type { AngleSuggestion } from './theAngle';

export type HistoryMeeting = {
  id: string; date: string; homeId: string; awayId: string; homeScore: number; awayScore: number; neutralSite: boolean | null;
};

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const yearCache = new Map<number, { expires: number; meetings: HistoryMeeting[] }>();
const espnYearFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/New_York' });
const calendarYear = (time: number) => Number(espnYearFormat.format(time));

export function historyWindow(gameDate: string) {
  const end = new Date(gameDate);
  if (!Number.isFinite(end.getTime())) throw new Error('Matchup history needs a valid kickoff date.');
  const start = new Date(end);
  const month = start.getUTCMonth();
  start.setUTCFullYear(start.getUTCFullYear() - 5);
  if (start.getUTCMonth() !== month) start.setUTCDate(0);
  return { start: start.getTime(), end: end.getTime() };
}

export function readHistoryYear(value: unknown, year: number): HistoryMeeting[] {
  const data = object(value);
  if (!Array.isArray(data.events) || !data.events.length || data.events.length >= 1000) {
    throw new Error(`${year} game history is missing or may be truncated.`);
  }
  return data.events.flatMap((raw) => {
    const event = object(raw);
    const type = object(event.season).type;
    if (type === 1) return [];
    if (type !== 2 && type !== 3) throw new Error(`${year} game history has an unknown season type.`);
    const date = typeof event.date === 'string' ? event.date : '';
    if (!Number.isFinite(Date.parse(date)) || calendarYear(Date.parse(date)) !== year) {
      throw new Error(`${year} game history returned an invalid or wrong-year date.`);
    }
    const competitions = Array.isArray(event.competitions) ? event.competitions : [];
    const competition = object(competitions[0]);
    const status = object(object(competition.status ?? event.status).type);
    if (typeof status.completed !== 'boolean' || typeof status.state !== 'string') {
      throw new Error(`${year} game history is missing game completion status.`);
    }
    if (!status.completed || status.state !== 'post' || typeof status.name !== 'string' || !/^STATUS_FINAL(?:_|$)/.test(status.name)) return [];
    const entries = Array.isArray(competition.competitors) ? competition.competitors.map(object) : [];
    const home = entries.find((entry) => entry.homeAway === 'home');
    const away = entries.find((entry) => entry.homeAway === 'away');
    const teamId = (entry: Record<string, unknown> | undefined) => object(entry?.team).id ?? entry?.id;
    const homeId = teamId(home);
    const awayId = teamId(away);
    const score = (entry: Record<string, unknown> | undefined) => {
      const rawScore = entry?.score;
      const value = typeof rawScore === 'object' ? object(rawScore).value ?? object(rawScore).displayValue : rawScore;
      return (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) ? Number(value) : NaN;
    };
    const homeScore = score(home);
    const awayScore = score(away);
    if (typeof event.id !== 'string' || !/^\d+$/.test(event.id) || typeof homeId !== 'string' || !/^\d+$/.test(homeId)
      || typeof awayId !== 'string' || !/^\d+$/.test(awayId) || homeId === awayId || entries.length !== 2
      || !Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
      throw new Error(`${year} game history has an invalid final score or team identity.`);
    }
    return [{
      id: event.id, date, homeId, awayId, homeScore, awayScore,
      neutralSite: typeof competition.neutralSite === 'boolean' ? competition.neutralSite : null,
    }];
  });
}

export function matchupHistorySuggestions(game: Game, meetings: HistoryMeeting[], asOf = Date.now()) {
  const { start, end } = historyWindow(game.date);
  const unique = new Map<string, HistoryMeeting>();
  for (const meeting of meetings) {
    const time = Date.parse(meeting.date);
    if (meeting.id === game.eventId || time < start || time >= end || time > asOf
      || ![meeting.homeId, meeting.awayId].includes(game.home.id) || ![meeting.homeId, meeting.awayId].includes(game.away.id)) continue;
    const previous = unique.get(meeting.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(meeting)) throw new Error(`Conflicting scores or identities for game ${meeting.id}. Matchup leads were skipped.`);
    unique.set(meeting.id, meeting);
  }
  const history = [...unique.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const suggestions: AngleSuggestion[] = [];
  const errors: string[] = [];
  const range = `${new Date(start).toISOString()} to before kickoff ${game.date} (UTC)`;
  const result = (meeting: HistoryMeeting, id: string) => {
    const own = meeting.homeId === id ? meeting.homeScore : meeting.awayScore;
    const against = meeting.homeId === id ? meeting.awayScore : meeting.homeScore;
    return own > against ? 'W' : own < against ? 'L' : 'T';
  };
  const add = (team: Game['home'], opponent: Game['home'], sample: HistoryMeeting[], key: string, headline: string, context: string) => {
    const links = sample.map((meeting) => ({
      label: `${meeting.date.slice(0, 10)} UTC: ${meeting.awayId === team.id ? team.abbr : opponent.abbr} ${meeting.awayScore} @ ${meeting.homeId === team.id ? team.abbr : opponent.abbr} ${meeting.homeScore}${meeting.neutralSite === true ? ' (neutral)' : ''} · ${result(meeting, team.id)}`,
      url: `https://www.espn.com/nfl/game/_/gameId/${meeting.id}`,
    }));
    const evidence = `${context} Window: ${range}. Regular season + playoffs; preseason excluded. Wins / all meetings; ties are not wins.\n${links.map((link) => link.label).join('\n')}`;
    suggestions.push({
      key: `${game.id}:history:${team.id}:${key}`, game, category: 'Head-to-head history', subject: team.name,
      sourceLabel: 'Game history', history: { evidence, meetings: links },
      article: {
        id: `history:${game.eventId}:${team.id}:${key}`, favoriteKey: `team:${game.feedPath}:${team.id}`,
        favoriteName: team.name, favoriteType: 'team', published: sample[0].date, headline, description: context, url: links[0].url,
      },
    });
  };
  for (const [team, opponent] of [[game.home, game.away], [game.away, game.home]]) {
    const record = (sample: HistoryMeeting[]) => {
      const results = sample.map((meeting) => result(meeting, team.id));
      const wins = results.filter((item) => item === 'W').length;
      const losses = results.filter((item) => item === 'L').length;
      const ties = results.length - wins - losses;
      return { wins, losses, ties, text: `${wins}-${losses}-${ties} W-L-T` };
    };
    const all = record(history);
    if (history.length >= 4 && all.wins * 10 > history.length * 7) {
      const rate = Number((all.wins / history.length * 100).toFixed(1));
      add(team, opponent, history, 'win-rate', `${team.abbr}: ${rate}% wins vs ${opponent.abbr} in the last five years`,
        `${team.name}: ${all.text} against ${opponent.name} across ${history.length} meetings in the rolling five-year window (${rate}% wins, strictly above 70%). Includes neutral-site games.`);
    }
    const unbeaten = (sample: HistoryMeeting[], key: string, scope: string) => {
      const latest = sample.slice(0, 4);
      if (latest.length < 4 || latest.some((meeting) => result(meeting, team.id) === 'L')) return;
      add(team, opponent, latest, key, `${team.abbr} unbeaten in the latest four ${scope}meetings vs ${opponent.abbr}`,
        `${team.name}: ${record(latest).text} in the latest four ${scope}meetings with ${opponent.name} within the rolling five-year window. Unbeaten includes ties; this is not necessarily a four-game winning streak.`);
    };
    unbeaten(history, 'unbeaten', '');
    if (game.neutralSite === false && !history.some((meeting) => meeting.neutralSite === null)) {
      unbeaten(history.filter((meeting) => meeting.neutralSite === false && meeting.homeId === game.home.id),
        'venue-unbeaten', team.id === game.home.id ? 'home ' : 'away ');
    }
  }
  if (game.neutralSite === undefined || (game.neutralSite === false && history.some((meeting) => meeting.neutralSite === null))) {
    errors.push(`${game.away.abbr} @ ${game.home.abbr}: venue-specific history skipped because neutral-site information is missing.`);
  }
  return { suggestions, errors };
}

async function fetchHistoryYear(year: number, signal: AbortSignal) {
  const cached = yearCache.get(year);
  if (cached && cached.expires > Date.now()) return cached.meetings;
  const request = new AbortController();
  const cancel = () => request.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = globalThis.setTimeout(cancel, 25_000);
  try {
    if (signal.aborted) throw new Error('Matchup history scan cancelled.');
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${year}&limit=1000`, { signal: request.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`${year} game history returned HTTP ${response.status}.`);
    const meetings = readHistoryYear(await response.json(), year);
    if (!signal.aborted) {
      yearCache.delete(year);
      yearCache.set(year, { meetings, expires: Date.now() + 10 * 60_000 });
      if (yearCache.size > 12) yearCache.delete(yearCache.keys().next().value!);
    }
    return meetings;
  } finally {
    globalThis.clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}

export async function fetchMatchupHistorySuggestions(games: Game[], signal: AbortSignal) {
  const years = new Set<number>();
  const yearsFor = (game: Game) => {
    const { start, end } = historyWindow(game.date);
    return Array.from({ length: Math.max(0, calendarYear(Math.min(end, Date.now())) - calendarYear(start) + 1) },
      (_, index) => calendarYear(start) + index);
  };
  games.forEach((game) => yearsFor(game).forEach((year) => years.add(year)));
  const loaded = new Map<number, HistoryMeeting[]>();
  const errors: string[] = [];
  const suggestions: AngleSuggestion[] = [];
  const ordered = [...years].sort();
  for (let offset = 0; offset < ordered.length; offset += 3) {
    await Promise.all(ordered.slice(offset, offset + 3).map(async (year) => {
      try { loaded.set(year, await fetchHistoryYear(year, signal)); }
      catch (cause) {
        if (!signal.aborted) errors.push(`${year} game history: ${cause instanceof Error ? cause.message : 'History unavailable.'} Matchups needing this year were skipped, not calculated from partial history.`);
      }
    }));
    if (signal.aborted) return { suggestions: [], errors: [] };
  }
  for (const game of games) {
    const required = yearsFor(game);
    if (!required.length || required.some((year) => !loaded.has(year))) continue;
    try {
      const result = matchupHistorySuggestions(game, required.flatMap((year) => loaded.get(year)!), Date.now());
      suggestions.push(...result.suggestions); errors.push(...result.errors);
    } catch (cause) {
      errors.push(`${game.away.abbr} @ ${game.home.abbr}: ${cause instanceof Error ? cause.message : 'Invalid matchup history.'}`);
    }
  }
  return { suggestions, errors };
}
