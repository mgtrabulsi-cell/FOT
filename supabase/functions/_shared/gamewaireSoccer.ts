import { array, bestPlusMoneyProp, decimalOdds, expectedValue, fairAmericanOdds, impliedProbability, isAllowedPickSide, isAllowedPropPrice, isSoccer, normalize, numeric, object, rankTopPicks, soccerModelVersion, text, valueClassification } from './gamewaire.ts';
import type { Candidate, Evaluation, Evidence, Observation, Quote, Settings, SoccerSport, TeamLean } from './gamewaire.ts';
import { publicJSON } from './gamewaireSources.ts';
import type { Matchup } from './gamewaireSources.ts';

export const soccerPaths: Record<SoccerSport, string> = { EPL: 'soccer/eng.1', 'Serie A': 'soccer/ita.1', 'La Liga': 'soccer/esp.1', Bundesliga: 'soccer/ger.1', 'Champions League': 'soccer/uefa.champions' };
const aliases: Record<string, string> = {
  manchesterunited: 'manchesterunited', manunited: 'manchesterunited', manchestercity: 'manchestercity', mancity: 'manchestercity',
  wolverhamptonwanderers: 'wolves', wolves: 'wolves', tottenhamhotspur: 'tottenham', tottenham: 'tottenham',
  nottinghamforest: 'nottinghamforest', nottingham: 'nottinghamforest', brightonandhovealbion: 'brighton', brighton: 'brighton',
  afcbournemouth: 'bournemouth', bournemouth: 'bournemouth', westhamunited: 'westham', westham: 'westham',
  inter: 'internazionale', intermilan: 'internazionale', internazionale: 'internazionale', acmilan: 'milan', milan: 'milan',
  atleticomadrid: 'atleticomadrid', atleticodemadrid: 'atleticomadrid', bayernmunich: 'bayernmunich', bayernmunchen: 'bayernmunich',
  athleticclub: 'athleticbilbao', athleticbilbao: 'athleticbilbao', deportivoalaves: 'alaves', alaves: 'alaves',
  '1fcunionberlin': 'unionberlin', unionberlin: 'unionberlin', '1fckoln': 'cologne', fccologne: 'cologne', cologne: 'cologne',
  mainz05: 'mainz', '1fsvmainz05': 'mainz', mainz: 'mainz', eintrachtfrankfurt: 'frankfurt', frankfurt: 'frankfurt',
  brightonhovealbion: 'brighton', elchecf: 'elche', elche: 'elche',
  atalantabc: 'atalanta', atalanta: 'atalanta', caosasuna: 'osasuna', osasuna: 'osasuna',
  realracingclubdesantander: 'racingsantander', racingsantander: 'racingsantander',
  fsvmainz05: 'mainz', hamburgersv: 'hamburgsv', hamburgsv: 'hamburgsv',
  augsburg: 'augsburg', fcaugsburg: 'augsburg', fcschalke04: 'schalke04', schalke04: 'schalke04',
  scpaderborn: 'paderborn', scpaderborn07: 'paderborn', elversberg: 'elversberg', svelversberg: 'elversberg',
  deportivolacoruna: 'deportivo', deportivo: 'deportivo',
};
export const soccerName = (name: string) => aliases[normalize(name)] ?? normalize(name);
export async function resolveSoccerMatchup(quote: Quote, fetcher: typeof fetch = fetch): Promise<Matchup> {
  if (!isSoccer(quote.sport)) throw new Error('A supported soccer league is required.');
  const date = new Date(quote.start).toISOString().slice(0, 10).replace(/-/g, '');
  const board = object(await publicJSON(`https://site.api.espn.com/apis/site/v2/sports/${soccerPaths[quote.sport]}/scoreboard?dates=${date}&limit=100`, fetcher));
  const matches = array(board.events).map(object).filter(event => {
    const competition = object(array(event.competitions)[0]), sides = array(competition.competitors).map(object);
    return soccerName(text(object(sides.find(side => side.homeAway === 'home')?.team).displayName)) === soccerName(quote.home)
      && soccerName(text(object(sides.find(side => side.homeAway === 'away')?.team).displayName)) === soccerName(quote.away)
      && Math.abs(Date.parse(text(event.date)) - Date.parse(quote.start)) <= 5 * 60_000;
  });
  if (matches.length !== 1) throw new Error('Soccer league/team identity or kickoff cannot be matched unambiguously within five minutes.');
  const event = matches[0], competition = object(array(event.competitions)[0]), sides = array(competition.competitors).map(object);
  if (object(object(competition.status).type).state !== 'pre') throw new Error('Only pregame league fixtures are supported.');
  const side = (location: string) => { const team = object(sides.find(row => row.homeAway === location)?.team); return { id: text(team.id), name: text(team.displayName) }; };
  const home = side('home'), away = side('away'), season = numeric(object(event.season).year);
  if (!home.id || !away.id || !season || !text(event.id)) throw new Error('Soccer matchup identifiers are incomplete.');
  return { eventId: text(event.id), season, home, away };
}
export function soccerTeamSamples(value: unknown, teamId: string, sport: SoccerSport, season: number, cutoff: number): Observation[] {
  const data = object(value), league = soccerPaths[sport].split('/')[1];
  if (numeric(object(data.requestedSeason ?? data.season).year) !== season) throw new Error('Soccer schedule season mismatch.');
  const seen = new Set<string>();
  return array(data.events).flatMap(raw => {
    const event = object(raw), c = object(array(event.competitions)[0]), status = object(c.status), sides = array(c.competitors).map(object);
    const own = sides.find(row => text(object(row.team).id) === teamId), other = sides.find(row => text(object(row.team).id) !== teamId);
    const score = numeric(object(own?.score).value) ?? numeric(own?.score), against = numeric(object(other?.score).value) ?? numeric(other?.score);
    const id = text(event.id), date = text(event.date), refs = sides.map(row => text(object(row.score).$ref));
    if (!id || seen.has(id) || !Number.isFinite(Date.parse(date)) || Date.parse(date) >= cutoff
      || numeric(object(event.season).year) !== season || object(status.type).name !== 'STATUS_FULL_TIME'
      || object(status.type).completed !== true || numeric(status.period) !== 2
      || !own || !other || score === undefined || against === undefined || !Number.isInteger(score) || !Number.isInteger(against)
      || score < 0 || against < 0 || !refs.every(ref => ref.includes(`/leagues/${league}/`))) return [];
    seen.add(id);
    return [{ eventId: id, date, season, value: score - against, pointsFor: score, pointsAgainst: against,
      total: score + against, location: text(own.homeAway), opponent: text(object(other.team).displayName) }];
  }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 20);
}
const statNames: Record<string, string> = { player_shots: 'totalShots', player_shots_on_target: 'shotsOnTarget', player_assists: 'goalAssists' };
export function soccerPlayerObservation(value: unknown, quote: Quote, game: Observation, teamId: string): (Observation & { playerId: string }) | undefined {
  const data = object(value), header = object(data.header), competition = object(array(header.competitions)[0]);
  const eventDate = text(header.date) || text(competition.date);
  if (text(header.id) !== game.eventId || !Number.isFinite(Date.parse(eventDate))
    || Math.abs(Date.parse(eventDate) - Date.parse(game.date)) > 5 * 60_000
    || object(object(competition.status).type).name !== 'STATUS_FULL_TIME'
    || numeric(object(competition.status).period) !== 2) return;
  const roster = array(data.rosters).map(object).find(row => text(object(row.team).id) === teamId);
  const players = array(roster?.roster).map(object).filter(row => normalize(text(object(row.athlete).displayName)) === normalize(quote.subject));
  if (players.length !== 1) return;
  const player = players[0], stats = array(player.stats).map(object), playerId = text(object(player.athlete).id);
  if (!playerId) return;
  if (numeric(stats.find(row => row.name === 'appearances')?.value) !== 1) return;
  const valueStat = numeric(stats.find(row => row.name === statNames[quote.market])?.value);
  if (valueStat === undefined || !Number.isInteger(valueStat) || valueStat < 0) return;
  return { eventId: game.eventId, date: game.date, season: game.season, value: valueStat, playerId };
}
export async function collectSoccerEvidence(quotes: Quote[], matchup: Matchup, now: number, fetcher: typeof fetch = fetch) {
  const sport = quotes[0].sport;
  if (!isSoccer(sport) || quotes.some(row => row.sport !== sport)) throw new Error('Soccer league evidence cannot be mixed.');
  const cutoff = Math.min(now, Date.parse(quotes[0].start)), path = soccerPaths[sport];
  const seasons = sport === 'Champions League' ? [matchup.season, matchup.season - 1, matchup.season - 2] : [matchup.season];
  const warnings: string[] = ['Experimental soccer analysis; probabilities are not calibrated guarantees. Only the selected competition is used. Regulation time (90 minutes plus stoppage time) only; extra time and shootouts excluded.'];
  if (seasons.length > 1) warnings.push(`Champions League evidence uses seasons ${seasons.join(', ')} only, with at least eight verified games per team/player. Domestic games are excluded; prior-season squads and opponent strength may differ. Team records and season averages remain current-season only.`);
  const teams = await Promise.all([matchup.home, matchup.away].map(async team => {
    const histories = await Promise.all(seasons.map(async season => {
      try {
        return soccerTeamSamples(await publicJSON(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${team.id}/schedule?season=${season}`, fetcher), team.id, sport, season, cutoff);
      } catch (cause) {
        if (season === matchup.season) throw cause;
        warnings.push(`${team.name}: Champions League season ${season} unavailable (${cause instanceof Error ? cause.message : String(cause)}). No replacement games or zeros were supplied.`);
        return [];
      }
    }));
    const games = [...new Map(histories.flat().map(game => [game.eventId!, game])).values()]
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 20);
    return { team, games };
  }));
  const summaries = new Map<string, unknown>();
  const offered = [...new Set(quotes.filter(row => row.market.startsWith('player_')).map(row => row.subject))];
  if (quotes.some(row => row.priceCoverage === 'single-sided')) warnings.push('Some player markets provide only one side. These use actual offered prices and verified appearance statistics; opposite odds and no-vig comparisons remain unavailable.');
  if (offered.length > 24) warnings.push('Only the first 24 offered player identities are checked; other props are explicitly excluded.');
  if (offered.length) {
    const games = [...new Map(teams.flatMap(row => row.games.slice(0, 12)).map(game => [game.eventId!, game])).values()];
    for (let index = 0; index < games.length; index += 4) await Promise.all(games.slice(index, index + 4).map(async game => {
      try { summaries.set(game.eventId!, await publicJSON(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${game.eventId}`, fetcher)); }
      catch { warnings.push(`Individual completed-game statistics unavailable for ${game.eventId}; no zero was substituted.`); }
    }));
  }
  const evidence = new Map<string, Evidence>();
  for (const quote of quotes) {
    let samples: Observation[] = [], playerId: string | undefined;
    if (quote.market.startsWith('player_') && offered.slice(0, 24).includes(quote.subject)) {
      const byTeam = teams.map(row => row.games.slice(0, 12).flatMap(game => {
        const sample = soccerPlayerObservation(summaries.get(game.eventId!), quote, game, row.team.id);
        return sample ? [sample] : [];
      }));
      if (byTeam.filter(rows => rows.length).length === 1) {
        const found = byTeam.find(rows => rows.length)!;
        if (new Set(found.map(row => row.playerId)).size === 1) { samples = found; playerId = found[0].playerId; }
      }
    } else if (!quote.market.startsWith('player_')) samples = [...new Map(teams.flatMap(row => row.games.map(game => ({
      ...game, value: quote.market === 'totals' ? game.total! : game.value,
    }))).map(row => [row.eventId!, row])).values()];
    const eligible = teams.every(row => row.games.length >= 8 && now - Date.parse(row.games[0].date) <= 35 * 86_400_000)
      && (!quote.market.startsWith('player_') || samples.length >= 8 && now - Date.parse(samples[0].date) <= 21 * 86_400_000);
    evidence.set(quote.key, { eligible, soccerLeague: sport, soccerSeasons: seasons, reason: eligible ? undefined : `Insufficient verified same-competition completed games or individual appearances in seasons ${seasons.join(', ')} (minimum eight per team/player). Missing statistics and non-playing games are excluded.`,
      samples, fetchedAt: new Date(now).toISOString(), quality: .75, currentSeason: matchup.season,
      risks: [...warnings.slice(0, 1), 'Unfitted scoring baseline; opponent strength, injuries and confirmed upcoming lineups are not modeled. Individual stats describe verified appearances, not future playing time.'],
      identifiers: { espnEventId: matchup.eventId, playerId },
      matchupForm: teams.map(row => ({ team: row.team.name, season: matchup.season, record: {
        wins: row.games.filter(game => game.season === matchup.season && game.value > 0).length, losses: row.games.filter(game => game.season === matchup.season && game.value < 0).length, ties: row.games.filter(game => game.season === matchup.season && game.value === 0).length,
      }, recent: row.games })),
    });
  }
  return { evidence, warnings, coverage: { league: sport, season: matchup.season, seasons, teamGames: teams.map(row => ({ team: row.team.name, games: row.games.length,
    currentSeasonGames: row.games.filter(game => game.season === matchup.season).length })),
    playerCount: offered.length, playerLimit: 24, supportedMarkets: ['h2h', 'totals', ...Object.keys(statNames)], settlement: '90 minutes plus stoppage time' } };
}
export function soccerScoreDistribution(homeRate: number, awayRate: number) {
  if (![homeRate, awayRate].every(rate => Number.isFinite(rate) && rate > 0 && rate <= 10)) throw new Error('Invalid verified scoring rates.');
  const poisson = (rate: number) => { const p = [Math.exp(-rate)]; for (let i = 1; i <= 40; i++) p.push(p[i - 1] * rate / i); return p; };
  const home = poisson(homeRate), away = poisson(awayRate), rows = home.flatMap((p, h) => away.map((q, a) => ({ home: h, away: a, probability: p * q })));
  const sum = rows.reduce((total, row) => total + row.probability, 0);
  return rows.map(row => ({ ...row, probability: row.probability / sum }));
}
export function evaluateSoccer(quotes: Quote[], evidence: Map<string, Evidence>, settings: Settings, now: number, minimumPlayerPicks: 0 | 4 = 0): Evaluation {
  const rejected: Evaluation['rejected'] = [], supported: Candidate[] = [], best = new Map<string, Quote>();
  for (const quote of quotes) {
    if (!isSoccer(quote.sport)) throw new Error('Two-way sports must not use the soccer evaluator.');
    if (!settings.markets.includes(quote.market) && quote.market !== 'h2h') continue;
    if (settings.player && quote.market.startsWith('player_') && !normalize(quote.subject).includes(normalize(settings.player))) continue;
    if (!isAllowedPickSide(quote)) { rejected.push({ key: quote.key, reason: 'GamewAIre totals and player props are Over-only; Under selections are excluded.' }); continue; }
    if (!isAllowedPropPrice(quote)) { rejected.push({ key: quote.key, reason: 'Player props require valid finite American odds with absolute value at least 100.' }); continue; }
    if (settings.direction !== 'both' && quote.market !== 'h2h' && quote.side.toLowerCase() !== settings.direction) continue;
    const reject = (reason: string) => rejected.push({ key: quote.key, reason });
    if (!Number.isFinite(Date.parse(quote.start)) || Date.parse(quote.start) <= now) { reject('Only upcoming regulation-time fixtures are eligible.'); continue; }
    if (!Number.isFinite(Date.parse(quote.updatedAt)) || now - Date.parse(quote.updatedAt) > 600_000 || Date.parse(quote.updatedAt) > now + 60_000) { reject('Stale or future odds.'); continue; }
    const singleSided = quote.market.startsWith('player_') && quote.priceCoverage === 'single-sided' && quote.noVig === null;
    if (!singleSided && (quote.noVig === null || !Number.isFinite(quote.noVig) || quote.noVig <= 0 || quote.noVig >= 1)) { reject('Complete matched three-way match-winner or two-way over/under sportsbook prices required; a verified single-sided player price is also supported.'); continue; }
    if (quote.market !== 'h2h' && (quote.line === null || quote.line < 0 || quote.line * 2 % 1 !== 0 || !['Over', 'Under'].includes(quote.side))) { reject('Only whole/half-goal or stat over/under lines are supported; quarter lines require split settlement.'); continue; }
    try { decimalOdds(quote.american); } catch { reject('Invalid sportsbook price.'); continue; }
    if (!best.has(quote.key) || decimalOdds(quote.american) > decimalOdds(best.get(quote.key)!.american)) best.set(quote.key, quote);
  }
  for (const quote of best.values()) {
    const data = evidence.get(quote.key), reject = (reason: string) => rejected.push({ key: quote.key, reason });
    if (!data?.eligible || data.soccerLeague !== quote.sport) { reject(data?.reason ?? 'Verified same-league soccer evidence unavailable.'); continue; }
    const allowedSeasons = quote.sport === 'Champions League' ? [data.currentSeason, data.currentSeason! - 1, data.currentSeason! - 2] : [data.currentSeason];
    const seasons = data.soccerSeasons ?? [data.currentSeason];
    if (!seasons.length || new Set(seasons).size !== seasons.length || seasons.some(season => !Number.isInteger(season) || !allowedSeasons.includes(season))) { reject('Invalid competition history seasons.'); continue; }
    if (!Number.isFinite(data.quality) || data.quality > 1 || data.quality < settings.minQuality || !Number.isFinite(Date.parse(data.fetchedAt)) || now - Date.parse(data.fetchedAt) > 3_600_000 || Date.parse(data.fetchedAt) > now + 60_000
      || data.samples.some(row => !Number.isFinite(row.value) || !Number.isFinite(Date.parse(row.date)) || Date.parse(row.date) >= Math.min(now, Date.parse(quote.start)) || !seasons.includes(row.season))) { reject('Stale, future, invalid or wrong-season evidence.'); continue; }
    const currentSamples = data.samples.filter(row => row.season === data.currentSeason);
    if (!currentSamples.length) { reject('At least one verified current-season observation is required; no current-season average is invented.'); continue; }
    let win = 0, push = 0, projection = 0;
    const average = (rows: Observation[], key: 'pointsFor' | 'pointsAgainst') => rows.reduce((sum, row) => sum + row[key]!, 0) / rows.length;
    if (quote.market === 'h2h' || quote.market === 'totals') {
      const home = data.matchupForm?.find(row => soccerName(row.team) === soccerName(quote.home))?.recent;
      const away = data.matchupForm?.find(row => soccerName(row.team) === soccerName(quote.away))?.recent;
      if (!home || !away || home.length < 8 || away.length < 8 || [...home, ...away].some(row => !seasons.includes(row.season)
        || !Number.isFinite(Date.parse(row.date)) || Date.parse(row.date) >= Math.min(now, Date.parse(quote.start)) || !Number.isFinite(row.pointsFor) || !Number.isFinite(row.pointsAgainst))) { reject('Both same-league verified scoring histories are required.'); continue; }
      const h = Math.max(.1, (average(home, 'pointsFor') + average(away, 'pointsAgainst')) / 2);
      const a = Math.max(.1, (average(away, 'pointsFor') + average(home, 'pointsAgainst')) / 2);
      const distribution = soccerScoreDistribution(h, a);
      projection = quote.market === 'totals' ? h + a : quote.side === 'Draw' ? 0 : soccerName(quote.side) === soccerName(quote.home) ? h - a : a - h;
      for (const row of distribution) {
        if (quote.market === 'h2h') {
          if (quote.side === 'Draw' ? row.home === row.away : soccerName(quote.side) === soccerName(quote.home) ? row.home > row.away : row.away > row.home) win += row.probability;
        } else {
          const total = row.home + row.away;
          if (total === quote.line) push += row.probability;
          else if (quote.side === 'Over' ? total > quote.line! : total < quote.line!) win += row.probability;
        }
      }
    } else {
      if (!statNames[quote.market] || data.samples.length < 8) { reject('Unsupported or incomplete individual game statistics.'); continue; }
      projection = data.samples.reduce((sum, row) => sum + row.value, 0) / data.samples.length;
      const wins = data.samples.filter(row => quote.side === 'Over' ? row.value > quote.line! : row.value < quote.line!).length;
      const pushes = data.samples.filter(row => row.value === quote.line).length;
      const integer = Number.isInteger(quote.line);
      const denominator = data.samples.length + (integer ? 3 : 2);
      win = (wins + 1) / denominator; push = integer ? (pushes + 1) / denominator : 0;
    }
    const n = quote.market.startsWith('player_') ? data.samples.length : Math.min(...data.matchupForm!.map(row => row.recent.length));
    const conditional = win / (1 - push), uncertainty = Math.max(.08, 1.96 * Math.sqrt(conditional * (1 - conditional) / n));
    const conservativeEV = expectedValue(Math.max(0, conditional - uncertainty) * (1 - push), push, quote.american);
    const implied = impliedProbability(quote.american), edge = conditional - implied, ev = expectedValue(win, push, quote.american);
    const facts = [`Experimental ${quote.sport} regulation-time estimate: ${(win * 100).toFixed(1)}% win, ${(push * 100).toFixed(1)}% push.`,
      `${n} verified same-competition observations per limiting team/player in seasons ${seasons.join(', ')}; scoring baseline is not a fitted or calibrated forecasting model.`,
      `Projection ${projection.toFixed(2)}; sportsbook ${quote.book} at ${quote.american > 0 ? '+' : ''}${quote.american}.`];
    const observedAverage = (count: number) => {
      const rows = [...data.samples].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, count);
      return rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
    };
    const priceRisks = quote.priceCoverage === 'single-sided'
      ? [...data.risks, 'Single-sided sportsbook player market: no opposite price was supplied. No no-vig probability or opposite selection is inferred. The verified appearance estimate, not the offered price or EV, determines ranking.'] : data.risks;
    const pick: Candidate = { ...quote, modelVersion: soccerModelVersion, probability: win, pushProbability: push, implied, edge, ev, conservativeEV,
      projection, sampleSize: data.samples.length, effectiveSample: n, last5: observedAverage(5), last10: observedAverage(10),
      seasonAverage: currentSamples.reduce((sum, row) => sum + row.value, 0) / currentSamples.length,
      quality: data.quality, dataAt: data.fetchedAt, samples: data.samples, risks: priceRisks, facts, explanation: [...facts, ...priceRisks].join(' '),
      identifiers: data.identifiers, matchupForm: data.matchupForm, fairAmerican: fairAmericanOdds(conditional), noVigEdge: quote.noVig === null ? null : conditional - quote.noVig,
      baseline: `Experimental same-competition scoring/appearance baseline for seasons ${seasons.join(', ')}; no guarantee.` };
    pick.valueClass = valueClassification(pick);
    supported.push(pick);
  }
  const qualified = (pick: Candidate) => pick.market === 'h2h' || pick.line !== null && pick.projection > pick.line + 1e-8;
  const ordered = rankTopPicks(supported);
  const leans = ordered.filter(pick => pick.market === 'h2h');
  const teamLean: TeamLean | undefined = leans[0] ? { pick: leans[0], qualifies: true, reason: 'Highest supported regulation-time outcome probability, including draw. EV and odds value do not determine selection; not a recommendation or guarantee.' } : undefined;
  const plusMoneyProp = bestPlusMoneyProp(ordered.filter(pick => settings.markets.includes(pick.market) && qualified(pick)));
  const picks: Candidate[] = plusMoneyProp ? [plusMoneyProp] : [], subjects = new Set<string>(plusMoneyProp ? [normalize(plusMoneyProp.subject)] : []);
  let gameMarket = false;
  for (const pick of ordered.filter(pick => settings.markets.includes(pick.market) && qualified(pick))) {
    if (pick.key === plusMoneyProp?.key) continue;
    const player = pick.market.startsWith('player_'), identity = normalize(pick.subject);
    if (minimumPlayerPicks === 4 && (!player || subjects.size >= 4)) continue;
    if (player ? subjects.has(identity) : gameMarket) continue;
    picks.push(pick);
    if (player) subjects.add(identity); else gameMarket = true;
    if (picks.length === 8) break;
  }
  if (minimumPlayerPicks === 4 && teamLean) picks.push(teamLean.pick);
  for (const pick of supported.filter(pick => !qualified(pick))) rejected.push({ key: pick.key, reason: 'The model projection does not support the selected Over.' });
  return { status: picks.length ? 'completed' : supported.length ? 'no_qualifying' : 'insufficient_data', picks: rankTopPicks(picks), rejected, teamLean, winnerLean: teamLean, ...(plusMoneyProp ? { plusMoneyProp } : {}) };
}
