import { array, markets, normalize, numeric, object, text } from './gamewaire.ts';
import type { Evidence, Observation, Quote, Sport } from './gamewaire.ts';

const paths = { NBA: 'basketball/nba', NFL: 'football/nfl' };
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
export async function publicJSON(url: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json', 'User-Agent': ua } });
  if (!response.ok) throw new Error(`Sports data provider returned HTTP ${response.status}.`);
  return response.json();
}
export type Matchup = { eventId: string; season: number; home: { id: string; name: string }; away: { id: string; name: string } };
export async function resolveMatchup(quote: Quote, fetcher: typeof fetch = fetch): Promise<Matchup> {
  const date = new Date(Date.parse(quote.start) - 6 * 60 * 60_000).toISOString().slice(0, 10).replace(/-/g, '');
  const end = new Date(Date.parse(quote.start) + 6 * 60 * 60_000).toISOString().slice(0, 10).replace(/-/g, '');
  const data = object(await publicJSON(`https://site.api.espn.com/apis/site/v2/sports/${paths[quote.sport]}/scoreboard?dates=${date}-${end}&limit=100`, fetcher));
  const matches = array(data.events).map(object).flatMap((event) => {
    const competition = object(array(event.competitions)[0]);
    const sides = array(competition.competitors).map(object);
    const home = object(sides.find((side) => side.homeAway === 'home')?.team);
    const away = object(sides.find((side) => side.homeAway === 'away')?.team);
    if (normalize(text(home.displayName)) !== normalize(quote.home) || normalize(text(away.displayName)) !== normalize(quote.away)
      || Math.abs(Date.parse(text(event.date)) - Date.parse(quote.start)) > 6 * 60 * 60_000) return [];
    if (object(object(competition.status).type).state !== 'pre') throw new Error('The game is no longer pregame.');
    const season = numeric(object(event.season).year);
    if (!season || !text(event.id) || !text(home.id) || !text(away.id)) throw new Error('Matchup identifiers are incomplete.');
    return [{ eventId: text(event.id), season, home: { id: text(home.id), name: text(home.displayName) }, away: { id: text(away.id), name: text(away.displayName) } }];
  });
  if (matches.length !== 1) throw new Error('Could not unambiguously match the sportsbook event to the sports-data event.');
  return matches[0];
}
export function teamSamples(value: unknown, teamId: string, now: number): Array<Observation & { margin: number; total: number }> {
  const result: Array<Observation & { margin: number; total: number }> = [];
  for (const raw of array(object(value).events)) {
    const event = object(raw), competition = object(array(event.competitions)[0]), sides = array(competition.competitors).map(object);
    if (!object(object(competition.status).type).completed || Date.parse(text(event.date)) >= now
      || (numeric(object(event.seasonType).type) ?? numeric(object(event.season).type) ?? numeric(object(value).seasonType)) !== 2) continue;
    const own = sides.find((side) => text(object(side.team).id) === teamId), other = sides.find((side) => text(object(side.team).id) !== teamId);
    const score = (value: unknown) => numeric(value) ?? numeric(object(value).value);
    const a = score(own?.score), b = score(other?.score);
    if (a === undefined || b === undefined || !Number.isFinite(Date.parse(text(event.date)))) continue;
    result.push({ eventId: text(event.id) || undefined, date: text(event.date), value: a - b, margin: a - b, total: a + b,
      opponent: text(object(other?.team).displayName), location: text(own?.homeAway) });
  }
  return result.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
const statNames: Record<string, string[]> = {
  player_points: ['PTS', 'points'], player_rebounds: ['REB', 'totalRebounds'], player_assists: ['AST', 'assists'],
  player_threes: ['3PM', 'threePointFieldGoalsMade', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'], player_pass_yds: ['passingYards'],
  player_rush_yds: ['rushingYards'], player_reception_yds: ['receivingYards'], player_receptions: ['receptions'],
};
export function playerSamples(value: unknown, market: string, now: number): Observation[] {
  const data = object(value), names = array(data.names).map(text), events = object(data.events);
  if (!Array.isArray(data.seasonTypes) || !Array.isArray(data.names) || !data.events) throw new Error('Player logs are incomplete.');
  const columns = statNames[market] ?? [];
  const index = names.findIndex((name) => columns.includes(name));
  if (index < 0) throw new Error(`Player log does not report ${market}.`);
  const minutesIndex = names.findIndex((name) => ['MIN', 'minutes'].includes(name));
  const result = new Map<string, Observation>();
  for (const rawType of array(data.seasonTypes)) {
    const type = object(rawType);
    if (numeric(type.type) !== 2 && !/regular season/i.test(text(type.displayName))) continue;
    for (const rawCategory of array(type.categories)) {
      for (const raw of array(object(rawCategory).events)) {
        const row = object(raw), id = text(row.eventId), event = object(events[id]), date = text(event.gameDate);
        const stats = array(row.stats), rawValue = stats[index];
        const value = names[index].includes('-') && typeof rawValue === 'string' && /^\d+-\d+$/.test(rawValue)
          ? numeric(rawValue.split('-')[0]) : numeric(rawValue);
        if (!id || value === undefined || !Number.isFinite(Date.parse(date)) || Date.parse(date) >= now) continue;
        const min = stats[minutesIndex], parsed = typeof min === 'string' && /^\d+:\d{2}$/.test(min)
          ? Number(min.split(':')[0]) + Number(min.split(':')[1]) / 60 : numeric(min);
        result.set(id, { eventId: id, date, value, minutes: parsed, opponent: text(object(event.opponent).displayName), location: text(event.atVs) });
      }
    }
  }
  return [...result.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
export async function collectEvidence(quotes: Quote[], matchup: Matchup, now: number, fetcher: typeof fetch = fetch) {
  const sport = quotes[0].sport, path = paths[sport], base = `https://site.api.espn.com/apis/site/v2/sports/${path}`;
  const fetchedAt = new Date(now).toISOString(), evidence = new Map<string, Evidence>(), warnings: string[] = [];
  const memo = new Map<string, Promise<unknown>>();
  const get = (url: string) => {
    let task = memo.get(url); if (!task) { task = publicJSON(url, fetcher); memo.set(url, task); }
    return task;
  };
  const teamData = await Promise.all([matchup.away, matchup.home].map(async (team) => {
    const [schedule, roster] = await Promise.all([
      get(`${base}/teams/${team.id}/schedule?season=${matchup.season}&seasontype=2`),
      get(`${base}/teams/${team.id}/roster?season=${matchup.season}`),
    ]);
    const athletes = array(object(roster).athletes).flatMap((row) => Array.isArray(object(row).items) ? array(object(row).items) : [row]).map(object);
    return { team, games: teamSamples(schedule, team.id, now), athletes };
  }));
  const players = [...new Set(quotes.filter((quote) => quote.market.startsWith('player_')).map((quote) => quote.subject))].slice(0, 24);
  const logs = new Map<string, unknown>();
  const identities = new Map<string, { playerId: string; teamId: string }>();
  for (let start = 0; start < players.length; start += 4) {
    await Promise.all(players.slice(start, start + 4).map(async (name) => {
      const matches = teamData.flatMap((group) => group.athletes.filter((athlete) => normalize(text(athlete.displayName)) === normalize(name)).map((athlete) => ({ athlete, team: group.team })));
      if (matches.length !== 1) { warnings.push(`${name}: no unambiguous current matchup roster match.`); return; }
      const { athlete, team } = matches[0], status = object(athlete.status);
      if (!(status.type === 'active' || status.name === 'Active' || status.id === '1') || array(athlete.injuries).some((raw) => {
        const injury = object(raw); return text(injury.status) && !/^(active|healthy)$/i.test(text(injury.status));
      })) { warnings.push(`${name}: active status or injury availability is uncertain.`); return; }
      try {
        const data = await get(`https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${encodeURIComponent(text(athlete.id))}/gamelog?season=${matchup.season}`);
        logs.set(name, data);
        identities.set(name, { playerId: text(athlete.id), teamId: team.id });
      } catch {
        warnings.push(`${name}: player game logs could not be retrieved.`);
      }
    }));
  }
  for (const quote of quotes) {
    const risks = ['Experimental, uncalibrated baseline; not a promise of profit.', 'Cross-player and team correlations are not fully modeled.',
      'No verified historical ATS, positional-defense, travel or injury-impact adjustment is available.'];
    let samples: Observation[] = [], adjustment = 0;
    if (quote.market.startsWith('player_')) {
      const data = logs.get(quote.subject);
      if (!data) { evidence.set(quote.key, { eligible: false, reason: 'Player identity, active status or logs unavailable (24-player evaluation limit).', samples, fetchedAt, quality: 0, risks }); continue; }
      try { samples = playerSamples(data, quote.market, now); }
      catch (error) {
        evidence.set(quote.key, { eligible: false, reason: error instanceof Error ? error.message : 'Player logs unavailable.', samples, fetchedAt, quality: 0, risks }); continue;
      }
      if (sport === 'NBA') {
        const minutes = samples.slice(0, 10).map((row) => row.minutes);
        const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
        if (minutes.length < 10 || minutes.some((value) => value === undefined)
          || mean(minutes.slice(0, 5) as number[]) < 12
          || Math.abs(mean(minutes.slice(0, 5) as number[]) / mean(minutes as number[]) - 1) > 0.2) {
          evidence.set(quote.key, { eligible: false, reason: 'Playing time is missing, low or unstable.', samples, fetchedAt, quality: 0.5, risks }); continue;
        }
      } else {
        risks.push('Snap share and confirmed future role are unavailable; current-season opportunity can change.');
      }
      risks.push('Current roster status is not a confirmed starting lineup; recheck before tipoff/kickoff.');
    } else {
      const own = teamData.find((row) => normalize(row.team.name) === normalize(quote.side));
      const away = teamData[0], home = teamData[1];
      if (quote.market === 'totals') {
        if (teamData.some((row) => row.games.length < (sport === 'NBA' ? 12 : 8))) {
          evidence.set(quote.key, { eligible: false, reason: 'Both teams need a sufficient current-season sample for totals.', samples, fetchedAt, quality: 0, risks }); continue;
        }
        const seen = new Set<string>();
        samples = [...away.games, ...home.games].filter((row) => {
          const identity = row.eventId ?? `${row.date}:${row.opponent}:${row.location}`;
          if (seen.has(identity)) return false;
          seen.add(identity); return true;
        }).map((row) => ({ ...row, value: row.total }));
      } else if (own) {
        const opponent = teamData.find((row) => row !== own)!;
        samples = own.games;
        if (opponent.games.length < (sport === 'NBA' ? 12 : 8)) samples = [];
        else adjustment = -opponent.games.reduce((sum, row) => sum + row.margin, 0) / opponent.games.length / 2;
        risks.push('Opponent season scoring margin adjustment is a simple baseline, not opponent-adjusted efficiency.');
        risks.push('Adjusted scoring margins are rounded to whole points. NBA moneyline ties split equally between win and loss, not pushes.');
      }
      risks.push('No home-court/home-field coefficient is assumed without fitted historical evidence.');
    }
    evidence.set(quote.key, { eligible: true, samples, fetchedAt, quality: sport === 'NFL' && quote.market.startsWith('player_') ? 0.75 : 0.8, risks, adjustment,
      identifiers: { espnEventId: matchup.eventId, ...identities.get(quote.subject) } });
  }
  return { evidence, warnings, coverage: { supportedMarkets: markets[sport], playerLimit: 24, playerCount: players.length, season: matchup.season } };
}
export const oddsSport: Record<Sport, string> = { NFL: 'americanfootball_nfl', NBA: 'basketball_nba' };
