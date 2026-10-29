import { array, isNFLPrimetime, markets, normalize, numeric, object, text } from './gamewaire.ts';
import type { Evidence, FormRecord, NBARotation, Observation, OpponentContext, Quote, Sport, TeamForm } from './gamewaire.ts';

const paths = { NBA: 'basketball/nba', NFL: 'football/nfl' };
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
export const teamNameKey = (name: string) => normalize(name).replace(/^losangeles/, 'la');
export function defensiveStandings(value: unknown, sport: Sport, season: number, fetchedAt: string): Map<string, OpponentContext> {
  if (numeric(object(object(value).season).year) !== season) throw new Error('Defensive standings returned the wrong season.');
  const teams = new Map<string, { team: string; teamId?: string; games: number; pointsAllowed: number; pointsScored: number }>();
  const visit = (value: unknown) => {
    const row = object(value);
    for (const raw of array(object(row.standings).entries)) {
      const entry = object(raw), stats = array(entry.stats).map(object), team = text(object(entry.team).displayName);
      const stat = (name: string) => numeric(stats.find((item) => item.name === name)?.value);
      const wins = stat('wins'), losses = stat('losses'), ties = stat('ties') ?? 0;
      const against = stat('pointsAgainst'), scored = stat('pointsFor');
      if (!team || wins === undefined || losses === undefined || wins < 0 || losses < 0 || ties < 0
        || against === undefined || scored === undefined || against < 0 || scored < 0) continue;
      const games = wins + losses + ties;
      if (!Number.isInteger(games) || !games) continue;
      teams.set(teamNameKey(team), { team, teamId: text(object(entry.team).id) || undefined, games, pointsAllowed: against / games, pointsScored: scored / games });
    }
    array(row.children).forEach(visit);
  };
  visit(value);
  const leagueSize = sport === 'NBA' ? 30 : 32;
  if (teams.size !== leagueSize) throw new Error(`Defensive league ranking requires all ${leagueSize} teams with recorded games.`);
  const entries = [...teams.entries()];
  return new Map(entries.map(([key, team]) => [key, { ...team, leagueSize, season, fetchedAt,
    rank: 1 + entries.filter(([, other]) => other.pointsAllowed < team.pointsAllowed - 1e-8).length,
    tied: entries.some(([otherKey, other]) => otherKey !== key && Math.abs(other.pointsAllowed - team.pointsAllowed) < 1e-8) }]));
}
export function nflOpponentYardage(value: unknown, teamId: string, season: number, expectedGames?: number) {
  const data = object(value);
  if (text(object(data.team).id) !== teamId || numeric(object(data.season).year) !== season || numeric(object(data.season).type) !== 2) throw new Error('NFL defense statistics returned a different team or season.');
  const stats = array(object(data.results).opponent).flatMap((category) => array(object(category).stats)).map(object);
  if (expectedGames !== undefined) {
    const counts = stats.filter((stat) => stat.name === 'gamesPlayed' || stat.name === 'teamGamesPlayed').map((stat) => numeric(stat.value));
    if (!counts.length || counts.some((count) => count !== expectedGames)) throw new Error('NFL defense statistics do not match the recorded game count.');
  }
  const result: Partial<Record<'receiving' | 'passing' | 'rushing', number>> = {};
  for (const [category, name] of [['receiving', 'receivingYardsPerGame'], ['passing', 'netPassingYardsPerGame'], ['rushing', 'rushingYardsPerGame']] as const) {
    const values = stats.filter((stat) => stat.name === name).map((stat) => numeric(stat.value));
    if (values.length && values.every((value) => value !== undefined && value >= 0 && value === values[0])) result[category] = values[0];
  }
  if (!Object.keys(result).length) throw new Error('NFL opponent yardage statistics are unavailable.');
  return result;
}
export function teamSituationalForm(games: Observation[], season: number): TeamForm | undefined {
  const ordered = games.filter((row) => row.season === season || row.season === season - 1)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  if (!ordered.some((row) => row.season === season)) return undefined;
  const empty = (): FormRecord => ({ wins: 0, losses: 0, ties: 0 });
  const result: TeamForm = { afterLoss: empty(), afterWin: empty(), primetime: empty(),
    latestResult: ordered[ordered.length - 1].value > 0 ? 'win' : ordered[ordered.length - 1].value < 0 ? 'loss' : 'tie',
    seasons: [...new Set(ordered.map((row) => row.season!))].sort() };
  const add = (record: FormRecord, value: number) => { if (value > 0) record.wins++; else if (value < 0) record.losses++; else record.ties++; };
  ordered.forEach((row, index) => {
    const previous = ordered[index - 1];
    if (previous?.season === row.season && previous.value !== 0) add(previous.value < 0 ? result.afterLoss : result.afterWin, row.value);
    if (isNFLPrimetime(row.date)) add(result.primetime, row.value);
  });
  return result;
}
export async function publicJSON(url: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json', 'User-Agent': ua } });
  if (!response.ok) throw new Error(`Sports data provider returned HTTP ${response.status}.`);
  return response.json();
}
export type Matchup = { eventId: string; season: number; home: { id: string; name: string }; away: { id: string; name: string } };
export async function resolveMatchup(quote: Quote, fetcher: typeof fetch = fetch): Promise<Matchup> {
  const date = new Date(Date.parse(quote.start) - 6 * 60 * 60_000).toISOString().slice(0, 10).replace(/-/g, '');
  const end = new Date(Date.parse(quote.start) + 6 * 60 * 60_000).toISOString().slice(0, 10).replace(/-/g, '');
  const boards = await Promise.all([...new Set([date, end])].map((day) =>
    publicJSON(`https://site.api.espn.com/apis/site/v2/sports/${paths[quote.sport]}/scoreboard?dates=${day}&limit=100`, fetcher)));
  const events = new Map(boards.flatMap((data) => array(object(data).events).map(object)).map((event) => [text(event.id), event]));
  const matches = [...events.values()].flatMap((event) => {
    const competition = object(array(event.competitions)[0]);
    const sides = array(competition.competitors).map(object);
    const home = object(sides.find((side) => side.homeAway === 'home')?.team);
    const away = object(sides.find((side) => side.homeAway === 'away')?.team);
    if (teamNameKey(text(home.displayName)) !== teamNameKey(quote.home) || teamNameKey(text(away.displayName)) !== teamNameKey(quote.away)
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
      opponent: text(object(other?.team).displayName), location: text(own?.homeAway), pointsFor: a, pointsAgainst: b });
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
  const attempt = (stats: unknown[], direct: string, combined: string) => {
    const directIndex = names.indexOf(direct), combinedIndex = names.indexOf(combined);
    if (directIndex >= 0) return numeric(stats[directIndex]);
    const value = stats[combinedIndex];
    return typeof value === 'string' && /^\d+-\d+$/.test(value) ? numeric(value.split('-')[1]) : undefined;
  };
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
        const fga = attempt(stats, 'fieldGoalsAttempted', 'fieldGoalsMade-fieldGoalsAttempted');
        const fta = attempt(stats, 'freeThrowsAttempted', 'freeThrowsMade-freeThrowsAttempted');
        const turnovers = numeric(stats[names.indexOf('turnovers')]);
        const offensiveInvolvement = fga !== undefined && fta !== undefined && turnovers !== undefined
          ? fga + 0.44 * fta + turnovers : undefined;
        result.set(id, { eventId: id, date, value, minutes: parsed, offensiveInvolvement,
          opponent: text(object(event.opponent).displayName), location: text(event.atVs) });
      }
    }
  }
  return [...result.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
export function nbaSeasonBlend<T extends Observation>(current: T[], previous: T[], season: number): T[] {
  const tagged = current.map((row) => ({ ...row, season }));
  if (current.length >= 12) return tagged;
  if (!current.length || previous.length < 12) return [];
  return [...tagged.map((row) => ({ ...row, weight: 0.5 / current.length })),
    ...previous.map((row) => ({ ...row, season: season - 1, weight: 0.5 / previous.length }))];
}
export function nflSeasonSupplement<T extends Observation>(current: T[], previous: T[], season: number): T[] {
  const tagged = current.map((row) => ({ ...row, season }));
  if (!current.length || current.length >= 8) return tagged;
  const ids = new Set(current.map((row) => row.eventId ?? row.date));
  const prior = previous.filter((row) => !ids.has(row.eventId ?? row.date))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 8 - current.length);
  return [...tagged, ...prior.map((row) => ({ ...row, season: season - 1 }))];
}
export function nbaRotationPool(players: Array<{ name: string; teamId: string; samples: Observation[] }>) {
  const result = new Map<string, NBARotation>();
  const ranked = players.flatMap((player) => {
    const recent = player.samples.slice(0, 5);
    if (!recent.length || recent.some((row) => row.minutes === undefined || !Number.isFinite(row.minutes))) return [];
    const minutes = recent.reduce((sum, row) => sum + row.minutes!, 0) / recent.length;
    const involvement = recent.every((row) => row.offensiveInvolvement !== undefined)
      ? recent.reduce((sum, row) => sum + row.offensiveInvolvement!, 0) / recent.length : undefined;
    return [{ ...player, minutes, involvement }];
  }).sort((a, b) => b.minutes - a.minutes || (b.involvement ?? 0) - (a.involvement ?? 0));
  const teams = new Map<string, number>();
  for (const player of ranked) {
    const rank = (teams.get(player.teamId) ?? 0) + 1;
    teams.set(player.teamId, rank);
    if (rank <= 5 && player.minutes >= 24) result.set(player.name, { label: 'Core rotation', minutes: player.minutes, involvement: player.involvement });
    else if (player.minutes >= 18 && player.involvement !== undefined && player.involvement >= 12)
      result.set(player.name, { label: 'High-usage rotation', minutes: player.minutes, involvement: player.involvement });
  }
  return result;
}
export async function collectEvidence(quotes: Quote[], matchup: Matchup, now: number, fetcher: typeof fetch = fetch) {
  const sport = quotes[0].sport, path = paths[sport], base = `https://site.api.espn.com/apis/site/v2/sports/${path}`;
  const fetchedAt = new Date(now).toISOString(), evidence = new Map<string, Evidence>(), warnings: string[] = [];
  const memo = new Map<string, Promise<unknown>>();
  const get = (url: string) => {
    let task = memo.get(url); if (!task) { task = publicJSON(url, fetcher); memo.set(url, task); }
    return task;
  };
  let defense = new Map<string, OpponentContext>();
  try {
    defense = defensiveStandings(await get(`https://site.web.api.espn.com/apis/v2/sports/${path}/standings?season=${matchup.season}&type=0&level=2`), sport, matchup.season, fetchedAt);
  } catch (cause) {
    warnings.push(`Opponent defensive ranking unavailable: ${cause instanceof Error ? cause.message : 'request failed'}. No defensive rank is assumed.`);
  }
  if (sport === 'NFL') {
    const teams = [...defense.values()];
    const yardage = new Map<string, ReturnType<typeof nflOpponentYardage>>();
    for (let start = 0; start < teams.length; start += 8) {
      await Promise.all(teams.slice(start, start + 8).map(async (team) => {
        if (!team.teamId) return;
        try { yardage.set(team.team, nflOpponentYardage(await get(`${base}/teams/${team.teamId}/statistics?season=${matchup.season}`), team.teamId, matchup.season, team.games)); }
        catch (cause) { warnings.push(`${team.team}: NFL defensive yardage unavailable: ${cause instanceof Error ? cause.message : 'request failed'}`); }
      }));
    }
    for (const category of ['receiving', 'passing', 'rushing'] as const) {
      if (yardage.size !== 32 || [...yardage.values()].some((row) => row[category] === undefined)) {
        warnings.push(`NFL ${category}-yards defense rankings unavailable: all 32 verified team statistics are required.`);
        continue;
      }
      for (const team of teams) {
        const perGame = yardage.get(team.team)![category]!;
        team.yardage = { ...team.yardage, [category]: { perGame, rank: 1 + [...yardage.values()].filter((row) => row[category]! < perGame - 1e-8).length } };
      }
    }
    warnings.push('Verified historical sportsbook lines are unavailable; ATS and after-loss ATS trends are not inferred from game scores.');
  }
  const players = [...new Set(quotes.filter((quote) => quote.market.startsWith('player_')).map((quote) => quote.subject))].slice(0, 24);
  const teamData = await Promise.all([matchup.away, matchup.home].map(async (team) => {
    const [schedule, roster] = await Promise.all([
      get(`${base}/teams/${team.id}/schedule?season=${matchup.season}&seasontype=2`),
      players.length ? get(`${base}/teams/${team.id}/roster?season=${matchup.season}`) : Promise.resolve(null),
    ]);
    const athletes = array(object(roster).athletes).flatMap((row) => Array.isArray(object(row).items) ? array(object(row).items) : [row]).map(object);
    const current = teamSamples(schedule, team.id, now);
    let games = current, form: TeamForm | undefined;
    if (sport === 'NBA') {
      let previous: typeof current = [];
      if (current.length > 0 && current.length < 12) {
        try { previous = teamSamples(await get(`${base}/teams/${team.id}/schedule?season=${matchup.season - 1}&seasontype=2`), team.id, now); }
        catch (cause) { warnings.push(`${team.name}: previous-season schedule unavailable: ${cause instanceof Error ? cause.message : 'request failed'}`); }
      }
      games = nbaSeasonBlend(current, previous, matchup.season);
    } else {
      let previous: typeof current = [];
      if (current.length > 0) {
        try { previous = teamSamples(await get(`${base}/teams/${team.id}/schedule?season=${matchup.season - 1}&seasontype=2`), team.id, now); }
        catch (cause) { warnings.push(`${team.name}: previous-season schedule unavailable: ${cause instanceof Error ? cause.message : 'request failed'}`); }
      }
      games = nflSeasonSupplement(current, previous, matchup.season);
      form = teamSituationalForm([...current.map((row) => ({ ...row, season: matchup.season })),
        ...previous.map((row) => ({ ...row, season: matchup.season - 1 }))], matchup.season);
    }
    return { team, games, current, athletes, form };
  }));
  const logs = new Map<string, unknown>();
  const previousLogs = new Map<string, unknown>();
  const rotationSamples = new Map<string, Observation[]>();
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
        if (sport === 'NBA') rotationSamples.set(name, playerSamples(data, 'player_points', now));
      } catch (cause) {
        warnings.push(`${name}: player game logs could not be verified: ${cause instanceof Error ? cause.message : 'request failed'}`);
      }
    }));
  }
  const rotation = nbaRotationPool([...rotationSamples].map(([name, samples]) => ({ name, samples, teamId: identities.get(name)!.teamId })));
  {
    const eligible = players.filter((name) => sport === 'NBA'
      ? rotation.has(name) && (rotationSamples.get(name)?.length ?? 0) < 12 : logs.has(name));
    for (let start = 0; start < eligible.length; start += 4) {
      await Promise.all(eligible.slice(start, start + 4).map(async (name) => {
        try { previousLogs.set(name, await get(`https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${encodeURIComponent(identities.get(name)!.playerId)}/gamelog?season=${matchup.season - 1}`)); }
        catch (cause) { warnings.push(`${name}: previous-season logs unavailable: ${cause instanceof Error ? cause.message : 'request failed'}`); }
      }));
    }
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
        if (!rotation.has(quote.subject)) {
          evidence.set(quote.key, { eligible: false, reason: 'Outside the core/high-usage rotation: requires top-five recent minutes (24+), or 18+ minutes with 12+ offensive involvement.', samples: [], fetchedAt, quality: 0, risks }); continue;
        }
        const minutes = samples.slice(0, 10).map((row) => row.minutes);
        const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
        if (!minutes.length || minutes.some((value) => value === undefined)
          || mean(minutes.slice(0, 5) as number[]) < 12
          || Math.abs(mean(minutes.slice(0, 5) as number[]) / mean(minutes as number[]) - 1) > 0.2) {
          evidence.set(quote.key, { eligible: false, reason: 'Playing time is missing, low or unstable.', samples, fetchedAt, quality: 0.5, risks }); continue;
        }
        try {
          const previous = previousLogs.get(quote.subject);
          samples = nbaSeasonBlend(samples, previous ? playerSamples(previous, quote.market, now) : [], matchup.season);
        } catch (cause) {
          evidence.set(quote.key, { eligible: false, reason: `Previous-season baseline unavailable: ${cause instanceof Error ? cause.message : 'invalid logs'}`, samples: [], fetchedAt, quality: 0, risks }); continue;
        }
      } else {
        try {
          const previous = previousLogs.get(quote.subject);
          samples = nflSeasonSupplement(samples, samples.length > 0 && samples.length < 8 && previous ? playerSamples(previous, quote.market, now) : [], matchup.season);
        } catch (cause) {
          warnings.push(`${quote.subject}: previous-season ${quote.market} baseline unavailable: ${cause instanceof Error ? cause.message : 'invalid logs'}`);
        }
        risks.push('Snap share and confirmed future role are unavailable; current-season opportunity can change.');
      }
      risks.push('Current roster status is not a confirmed starting lineup; recheck before tipoff/kickoff.');
    } else {
      const own = teamData.find((row) => teamNameKey(row.team.name) === teamNameKey(quote.side));
      const away = teamData[0], home = teamData[1];
      if (quote.market === 'totals') {
        if (teamData.some((row) => row.games.length < (sport === 'NBA' ? 12 : 8))) {
          evidence.set(quote.key, { eligible: false, reason: 'Both teams need a sufficient verified regular-season sample for totals.', samples, fetchedAt, quality: 0, risks }); continue;
        }
        const blended = [...away.games, ...home.games].some((row) => row.weight !== undefined);
        const seen = new Map<string, Observation>();
        for (const [index, row] of [...away.games, ...home.games].entries()) {
          const identity = row.eventId ?? `${row.date}:${row.opponent}:${row.location}`;
          const weight = blended ? (row.weight ?? 1 / (index < away.games.length ? away.games.length : home.games.length)) / 2 : undefined;
          const existing = seen.get(identity);
          if (existing) { if (weight !== undefined) existing.weight = (existing.weight ?? 0) + weight; }
          else seen.set(identity, { ...row, value: row.total, weight });
        }
        samples = [...seen.values()];
      } else if (own) {
        const opponent = teamData.find((row) => row !== own)!;
        samples = own.games;
        if (opponent.games.length < (sport === 'NBA' ? 12 : 8)) samples = [];
        else adjustment = -opponent.games.reduce((sum, row) => sum + row.margin * (row.weight ?? 1 / opponent.games.length), 0) / 2;
        risks.push('Opponent season scoring margin adjustment is a simple baseline, not opponent-adjusted efficiency.');
        risks.push('Adjusted scoring margins are rounded to whole points. NBA moneyline ties split equally between win and loss, not pushes.');
      }
      risks.push('No home-court/home-field coefficient is assumed without fitted historical evidence.');
    }
    if (sport === 'NBA' && quote.market.startsWith('player_')) risks.push('Rotation is ranked by recent minutes among matched offered players, not a confirmed starting five. Offensive involvement is FGA + 0.44 × FTA + turnovers, not official usage percentage.');
    if (sport === 'NFL' && (samples.some((row) => row.season === matchup.season - 1) || !quote.market.startsWith('player_') && teamData.some((row) => row.games.some((game) => game.season === matchup.season - 1)))) {
      risks.push('Early-season NFL baseline supplements current games with verified previous-season games. Prior roles, teammates, coaching and team strength may differ; carryover increases uncertainty.');
    }
    const ownTeam = quote.market.startsWith('player_') ? identities.get(quote.subject)?.teamId
      : teamData.find((row) => teamNameKey(row.team.name) === teamNameKey(quote.side))?.team.id;
    const opponents = teamData.filter((row) => quote.market === 'totals' || ownTeam && row.team.id !== ownTeam)
      .flatMap((row) => { const stats = defense.get(teamNameKey(row.team.name)); return stats ? [stats] : []; });
    const teamForm = !quote.market.startsWith('player_') && quote.market !== 'totals' ? teamData.find((row) => row.team.id === ownTeam)?.form : undefined;
    const matchupForm = !quote.market.startsWith('player_') && quote.market !== 'totals' ? teamData.map((row) => ({
      team: row.team.name, season: matchup.season, record: { wins: row.current.filter((game) => game.value > 0).length,
        losses: row.current.filter((game) => game.value < 0).length, ties: row.current.filter((game) => game.value === 0).length },
      recent: row.current.slice(0, 3),
    })) : undefined;
    evidence.set(quote.key, { eligible: true, samples, fetchedAt, quality: sport === 'NFL' && quote.market.startsWith('player_') ? 0.75 : 0.8, risks, adjustment, currentSeason: matchup.season, rotation: sport === 'NBA' && quote.market.startsWith('player_') ? rotation.get(quote.subject) : undefined, teamForm,
      opponents, matchupForm, identifiers: { espnEventId: matchup.eventId, ...identities.get(quote.subject) } });
  }
  return { evidence, warnings: [...new Set(warnings)], coverage: { supportedMarkets: markets[sport], playerLimit: 24, playerCount: players.length, season: matchup.season } };
}
export const oddsSport: Record<Sport, string> = { NFL: 'americanfootball_nfl', NBA: 'basketball_nba' };
