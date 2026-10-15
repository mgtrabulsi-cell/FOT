export type Sport = 'Basketball' | 'Football' | 'Soccer' | 'Hockey';
export type GameStatus = 'LIVE' | 'UPCOMING' | 'FINAL';

export type FavoriteTarget = {
  key: string;
  type: 'team' | 'player';
  id: string;
  name: string;
  shortName: string;
  feedPath: string;
  teamName?: string;
  teamAbbr?: string;
  teamId?: string;
  position?: string;
  headshot?: string;
  logo?: string;
};

export type DenNewsItem = {
  id: string;
  favoriteKey: string;
  favoriteName: string;
  favoriteType: FavoriteTarget['type'];
  headline: string;
  description: string;
  published: string;
  url?: string;
  image?: string;
};

export type NFLFavoritePlay = {
  id: string;
  favoriteKey: string;
  favoriteName: string;
  favoriteType: 'player' | 'team';
  headshot?: string;
  teamLogo?: string;
  teamAbbr: string;
  opponentAbbr: string;
  timestamp: string;
  playLabel: string;
  description: string;
  yards: number;
  isTouchdown: boolean;
  isDefensive: boolean;
};

export type Team = {
  id: string;
  name: string;
  abbr: string;
  score: number;
  record: string;
  color: string;
  logo?: string;
  featuredPlayers?: NFLFeaturedPlayer[];
};

export type NFLFeaturedPlayer = {
  id: string;
  name: string;
  category: string;
  statLine: string;
  seasonStats: Partial<Record<NFLPlayerStatKey, number>>;
  position: string;
  jersey: string;
  headshot?: string;
};

export type NFLPlayerStatKey =
  | 'passingYards'
  | 'passingTouchdowns'
  | 'interceptions'
  | 'completions'
  | 'attempts'
  | 'carries'
  | 'rushingYards'
  | 'rushingTouchdowns'
  | 'rushingReceivingTouchdowns'
  | 'receptions'
  | 'targets'
  | 'receivingYards'
  | 'receivingTouchdowns'
  | 'totalYards';

export type NFLMarket = {
  provider: string;
  spread: number | null;
  total: number | null;
  favoriteTeamId: string;
  homeMoneyline: string;
  awayMoneyline: string;
};

export type Game = {
  id: string;
  eventId: string;
  feedPath: string;
  sport: Sport;
  league: string;
  status: GameStatus;
  period: string;
  clock: string;
  date: string;
  venue: string;
  seasonYear: number;
  away: Team;
  home: Team;
  nflMarket?: NFLMarket;
};

export type NFLRecentGame = {
  gameId: string;
  date: string;
  opponent: string;
  opponentAbbreviation: string;
  opponentId: string;
  result: string;
  score: string;
  pointsFor: number | null;
  pointsAgainst: number | null;
  total: number | null;
};

export type NFLTeamForm = {
  teamId: string;
  teamName: string;
  stats: Record<string, string>;
  defenseRanks: NFLDefenseRanks;
  primaryPassingYardsAllowedPerGame: number | null;
  primaryRushingYardsAllowedPerGame: number | null;
  primaryReceivingYardsAllowedPerGame: number | null;
  primaryTightEndReceivingYardsAllowedPerGame: number | null;
  atsRecord?: string;
  recentGames: NFLRecentGame[];
  skillPlayers: NFLSkillPlayer[];
};

export type NFLGameDetails = {
  teamForms: NFLTeamForm[];
};

export type NFLTeamSeasonAverages = {
  teamId: string;
  pointsPerGame: number | null;
  totalYardsPerGame: number | null;
  passingYardsPerGame: number | null;
  rushingYardsPerGame: number | null;
  pointsAllowedPerGame: number | null;
  totalYardsAllowedPerGame: number | null;
  passingYardsAllowedPerGame: number | null;
  rushingYardsAllowedPerGame: number | null;
};

export type NFLGameLeader = {
  teamId: string;
  athleteId: string;
  name: string;
  position: string;
  headshot?: string;
  category: 'PASS YDS' | 'RUSH YDS' | 'REC YDS';
  yards: number;
};

export type NFLDefenseRanks = {
  passing: number | null;
  rushing: number | null;
  receiving: number | null;
};

export type NFLPlayerGame = {
  gameId: string;
  date: string;
  opponent: string;
  opponentAbbreviation: string;
  result: string;
  score: string;
  stats: Partial<Record<NFLPlayerStatKey, number>>;
};

export type NFLSkillPlayer = {
  id: string;
  name: string;
  position: string;
  jersey: string;
  headshot?: string;
  gamesWithUsage: number;
  passingAttempts: number;
  targets: number;
  receptions: number;
  carries: number;
  recentGames: NFLPlayerGame[];
};

export type SoccerPlayer = {
  id: string;
  name: string;
  initials: string;
  position: string;
  jersey: string;
  headshot?: string;
  minutes: string;
  goals: string;
  assists: string;
  shots: string;
  shotsOnTarget: string;
};

export type SoccerLineup = {
  teamId: string;
  teamName: string;
  side: 'away' | 'home';
  formation: string;
  players: SoccerPlayer[];
};

export type ScoreboardResult = {
  games: Game[];
  failedLeagues: string[];
  nflWeek: number | null;
};

const scoreFeeds: Array<{ sport: Sport; league: string; path: string }> = [
  { sport: 'Football', league: 'NFL', path: 'football/nfl' },
];

const apiBase = 'https://site.api.espn.com/apis/site/v2/sports';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function readTeam(raw: unknown): Team {
  const item = asObject(raw);
  const team = asObject(item.team);
  const record = asArray(item.records).map(asObject)[0];
  const playersById = new Map<string, NFLFeaturedPlayer>();
  asArray(item.leaders).forEach((leaderValue) => {
    const leader = asObject(leaderValue);
    const category = text(leader.displayName, text(leader.name, 'Team leader').replace(/leader$/i, '').trim());
    const categoryName = text(leader.name, category).toLowerCase();
    asArray(leader.leaders).forEach((featuredValue) => {
      const featured = asObject(featuredValue);
      const athlete = asObject(featured.athlete);
      const position = asObject(athlete.position);
      const statLine = text(featured.displayValue, '');
      const parse = (pattern: RegExp) => {
        const match = statLine.match(pattern);
        return match ? Number.parseInt(match[1].replace(/,/g, ''), 10) : undefined;
      };
      const yards = parse(/([\d,]+)\s+YDS\b/i);
      const playerId = text(athlete.id, text(athlete.displayName, category));
      const featuredPlayer = playersById.get(playerId) ?? {
        id: playerId,
        name: text(athlete.displayName, text(athlete.fullName, 'Player')),
        category,
        statLine,
        seasonStats: {},
        position: text(position.abbreviation),
        jersey: text(athlete.jersey),
        headshot: text(athlete.headshot, '') || undefined,
      };
      const categoryStats = featuredPlayer.seasonStats;

      if (categoryName.includes('passing')) {
        const completionAttempt = statLine.match(/([\d,]+)\s*\/\s*([\d,]+)/);
        const touchdowns = parse(/([\d,]+)\s+TD\b/i);
        const interceptions = parse(/([\d,]+)\s+INT\b/i);
        if (completionAttempt) {
          categoryStats.completions = Number.parseInt(completionAttempt[1].replace(/,/g, ''), 10);
          categoryStats.attempts = Number.parseInt(completionAttempt[2].replace(/,/g, ''), 10);
        }
        if (yards !== undefined) categoryStats.passingYards = yards;
        if (touchdowns !== undefined) categoryStats.passingTouchdowns = touchdowns;
        if (interceptions !== undefined) categoryStats.interceptions = interceptions;
      } else if (categoryName.includes('rushing')) {
        const carries = parse(/([\d,]+)\s+CAR\b/i);
        const touchdowns = parse(/([\d,]+)\s+TD\b/i);
        if (carries !== undefined) categoryStats.carries = carries;
        if (yards !== undefined) categoryStats.rushingYards = yards;
        if (touchdowns !== undefined) categoryStats.rushingTouchdowns = touchdowns;
      } else if (categoryName.includes('receiving')) {
        const receptions = parse(/([\d,]+)\s+REC\b/i);
        const touchdowns = parse(/([\d,]+)\s+TD\b/i);
        if (receptions !== undefined) categoryStats.receptions = receptions;
        if (yards !== undefined) categoryStats.receivingYards = yards;
        if (touchdowns !== undefined) categoryStats.receivingTouchdowns = touchdowns;
      }

      const rushingYards = categoryStats.rushingYards;
      const receivingYards = categoryStats.receivingYards;
      const passingYards = categoryStats.passingYards;
      if (featuredPlayer.position === 'QB' && passingYards !== undefined && rushingYards !== undefined) {
        categoryStats.totalYards = passingYards + rushingYards;
      } else if (featuredPlayer.position !== 'QB' && rushingYards !== undefined && receivingYards !== undefined) {
        categoryStats.totalYards = rushingYards + receivingYards;
      }
      playersById.set(playerId, featuredPlayer);
    });
  });
  const featuredPlayers = Array.from(playersById.values());
  const color = text(team.color, '547b69');
  return {
    id: text(team.id),
    name: text(team.displayName, text(team.name, 'Unknown team')),
    abbr: text(team.abbreviation, 'TBD'),
    score: Number.parseInt(text(item.score, '0'), 10) || 0,
    record: text(record?.summary),
    color: `#${color.replace(/^#/, '')}`,
    logo: text(team.logo, '') || undefined,
    featuredPlayers: featuredPlayers.length > 0 ? featuredPlayers : undefined,
  };
}

function readMarket(raw: unknown): NFLMarket | undefined {
  const odds = asObject(raw);
  if (Object.keys(odds).length === 0) return undefined;
  const homeOdds = asObject(odds.homeTeamOdds);
  const awayOdds = asObject(odds.awayTeamOdds);
  const moneyline = asObject(odds.moneyline);
  const homeMoneyline = asObject(moneyline.home);
  const awayMoneyline = asObject(moneyline.away);
  const homeClose = asObject(homeMoneyline.close);
  const awayClose = asObject(awayMoneyline.close);
  const homeOpen = asObject(homeMoneyline.open);
  const awayOpen = asObject(awayMoneyline.open);
  const spread = odds.spread === null || odds.spread === undefined ? Number.NaN : Number(odds.spread);
  const total = odds.overUnder === null || odds.overUnder === undefined ? Number.NaN : Number(odds.overUnder);

  return {
    provider: text(asObject(odds.provider).displayName, text(asObject(odds.provider).name, 'Odds provider')),
    spread: Number.isFinite(spread) ? spread : null,
    total: Number.isFinite(total) ? total : null,
    favoriteTeamId: text(asObject(homeOdds.team).id) && homeOdds.favorite === true
      ? text(asObject(homeOdds.team).id)
      : text(asObject(awayOdds.team).id),
    homeMoneyline: text(homeClose.odds, text(homeOpen.odds, '')),
    awayMoneyline: text(awayClose.odds, text(awayOpen.odds, '')),
  };
}

function mapEvent(eventValue: unknown, feed: typeof scoreFeeds[number]): Game | null {
  const event = asObject(eventValue);
  const competition = asObject(asArray(event.competitions)[0]);
  const competitors = asArray(competition.competitors).map(asObject);
  const awayEntry = competitors.find((competitor) => competitor.homeAway === 'away');
  const homeEntry = competitors.find((competitor) => competitor.homeAway === 'home');
  if (!awayEntry || !homeEntry) return null;

  const status = asObject(competition.status ?? event.status);
  const statusType = asObject(status.type);
  const state = text(statusType.state);
  const statusValue: GameStatus = state === 'in' ? 'LIVE' : state === 'post' ? 'FINAL' : 'UPCOMING';
  const periodNumber = Number(status.period ?? statusType.period ?? 0);
  const clockValue = text(status.displayClock, text(statusType.shortDetail));
  const shortDetail = text(statusType.shortDetail);
  const periodLabel = feed.league === 'NFL' && periodNumber > 0
    ? periodNumber <= 4 ? `Q${periodNumber}` : periodNumber === 5 ? 'OT' : `OT${periodNumber - 4}`
    : feed.sport === 'Soccer' && periodNumber > 0 ? `${periodNumber === 1 ? '1ST' : '2ND'} HALF` : periodNumber ? `PERIOD ${periodNumber}` : shortDetail;
  const teamA = readTeam(awayEntry);
  const teamH = readTeam(homeEntry);

  return {
    id: `${feed.league}:${text(event.id)}`,
    eventId: text(event.id),
    feedPath: feed.path,
    sport: feed.sport,
    league: feed.league,
    status: statusValue,
    period: periodLabel,
    clock: clockValue,
    date: text(event.date),
    venue: text(asObject(competition.venue).fullName, text(asObject(event.venue).fullName, 'Venue TBA')),
    seasonYear: Number(asObject(event.season).year) || new Date().getFullYear(),
    away: teamA,
    home: teamH,
    nflMarket: feed.league === 'NFL' ? readMarket(asArray(competition.odds)[0]) : undefined,
  };
}

export async function fetchNFLNotificationGame(eventId: string, signal?: AbortSignal): Promise<Game> {
  if (!/^\d+$/.test(eventId)) throw new Error('Invalid notification game ID.');
  const response = await fetch(`${apiBase}/football/nfl/summary?event=${encodeURIComponent(eventId)}`, { signal });
  if (!response.ok) throw new Error(`Could not load the notification matchup (${response.status}).`);
  const header = asObject(asObject(await response.json()).header);
  const game = mapEvent(header, { sport: 'Football', league: 'NFL', path: 'football/nfl' });
  if (!game || game.eventId !== eventId) throw new Error('This notification matchup is no longer available.');
  return game;
}

export function getCurrentNFLWeek(payload: unknown, now = new Date()): number | null {
  const scoreboard = asObject(payload);
  const reportedWeek = Number(asObject(scoreboard.week).number) || null;
  if (Number(asObject(scoreboard.season).type) !== 2) return reportedWeek;
  const calendar = asArray(asObject(asArray(scoreboard.leagues)[0]).calendar).map(asObject);
  const regularSeason = calendar.find((entry) => text(entry.value) === '2');
  const easternDate = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
    return new Date(Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')));
  };
  const easternNow = easternDate(now).getTime();
  const weeks = asArray(regularSeason?.entries).map(asObject).flatMap((entry) => {
    const start = Date.parse(text(entry.startDate));
    const week = Number(entry.value);
    if (!Number.isFinite(start) || !Number.isInteger(week) || week < 1 || week > 18) return [];
    const rollover = easternDate(new Date(start));
    rollover.setUTCDate(rollover.getUTCDate() - (rollover.getUTCDay() - 2 + 7) % 7);
    rollover.setUTCHours(12, 0, 0, 0);
    return [{ week, rollover: rollover.getTime() }];
  });
  return weeks.filter((entry) => entry.rollover <= easternNow)
    .sort((first, second) => second.rollover - first.rollover)[0]?.week ?? reportedWeek;
}

export async function fetchScoreboards(signal?: AbortSignal, nflWeek?: number): Promise<ScoreboardResult> {
  const results = await Promise.allSettled(scoreFeeds.map(async (feed) => {
    const weekQuery = feed.league === 'NFL' && nflWeek ? `?week=${nflWeek}&seasontype=2` : '';
    const response = await fetch(`${apiBase}/${feed.path}/scoreboard${weekQuery}`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`${feed.league} returned HTTP ${response.status}`);
    const payload: unknown = await response.json();
    let scoreboard = asObject(payload);
    const currentWeek = feed.league === 'NFL' ? getCurrentNFLWeek(payload) : null;
    if (!nflWeek && currentWeek !== null && currentWeek !== Number(asObject(scoreboard.week).number)) {
      const season = Number(asObject(scoreboard.season).year);
      const nextResponse = await fetch(`${apiBase}/${feed.path}/scoreboard?week=${currentWeek}&seasontype=2&dates=${season}`, { signal, cache: 'no-store' });
      if (!nextResponse.ok) throw new Error(`${feed.league} week ${currentWeek} returned HTTP ${nextResponse.status}`);
      scoreboard = asObject(await nextResponse.json());
    }
    const events = asArray(scoreboard.events);
    return {
      games: events.map((event) => mapEvent(event, feed)).filter((game): game is Game => game !== null)
        .map((game) => ({ ...game, seasonYear: Number(asObject(scoreboard.season).year) || game.seasonYear })),
      nflWeek: currentWeek,
    };
  }));

  const games: Game[] = [];
  const failedLeagues: string[] = [];
  let currentNFLWeek: number | null = null;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      games.push(...result.value.games);
      if (scoreFeeds[index].league === 'NFL') currentNFLWeek = result.value.nflWeek;
    }
    else if (!signal?.aborted) failedLeagues.push(scoreFeeds[index].league);
  });

  games.sort((first, second) => Date.parse(first.date) - Date.parse(second.date));
  return { games, failedLeagues, nflWeek: currentNFLWeek };
}

function articleMatchesFavorite(article: Record<string, unknown>, favorite: FavoriteTarget): boolean {
  const headline = text(article.headline).toLowerCase();
  const description = text(article.description).toLowerCase();
  const story = `${headline} ${description}`;
  if (favorite.type === 'player') {
    return story.includes(favorite.name.toLowerCase());
  }
  const nickname = favorite.name.trim().split(/\s+/).slice(-1)[0]?.toLowerCase() ?? '';
  return story.includes(favorite.name.toLowerCase()) || (nickname.length > 2 && story.includes(nickname));
}

export async function fetchFavoriteNews(favorites: FavoriteTarget[], signal?: AbortSignal): Promise<DenNewsItem[]> {
  const results = await Promise.allSettled(favorites.map(async (favorite) => {
    const newsTeamId = favorite.type === 'team' ? favorite.id : favorite.teamId;
    const url = newsTeamId
      ? `${apiBase}/${favorite.feedPath}/news?team=${encodeURIComponent(newsTeamId)}&limit=20`
      : `${apiBase}/${favorite.feedPath}/athletes/${encodeURIComponent(favorite.id)}/news?limit=20`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`News feed returned HTTP ${response.status}`);
    const payload = asObject(await response.json());
    return asArray(payload.articles).map(asObject)
      .filter((article) => articleMatchesFavorite(article, favorite))
      .slice(0, 6)
      .map((article): DenNewsItem => {
        const webLink = asObject(asObject(article.links).web);
        const image = asArray(article.images).map(asObject)[0];
        return {
          id: `${favorite.key}:news:${text(article.id, text(article.headline))}`,
          favoriteKey: favorite.key,
          favoriteName: favorite.name,
          favoriteType: favorite.type,
          headline: text(article.headline, 'Sports update'),
          description: text(article.description),
          published: text(article.published),
          url: text(webLink.href, '') || undefined,
          image: text(image?.url, '') || undefined,
        };
      });
  }));

  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .sort((first, second) => Date.parse(second.published) - Date.parse(first.published));
}

function normalizePlayName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function playerPlayAliases(name: string) {
  const parts = name.match(/[a-z0-9]+/gi) ?? [];
  if (parts.length < 2) return [];
  const firstInitial = parts[0]?.[0];
  if (!firstInitial) return [];
  const surname = parts.slice(1).filter((part) => !/^(jr|sr|ii|iii|iv)$/i.test(part));
  const lastName = surname[surname.length - 1];
  return [...new Set([
    normalizePlayName(`${firstInitial}${surname.join('')}`),
    normalizePlayName(`${firstInitial}${lastName}`),
  ])];
}

function playMentionsPlayer(playText: string, playerName: string) {
  const normalizedPlay = normalizePlayName(playText);
  return playerPlayAliases(playerName).some((alias) => alias.length > 2 && normalizedPlay.includes(alias));
}

function parsePlayYards(play: Record<string, unknown>, playText: string) {
  const yards = parseBoxscoreNumber(play.statYardage);
  if (yards !== undefined) return yards;
  const match = playText.match(/\bfor\s+(-?\d+)\s+yards?\b/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function getTuesdayCutoff(now = new Date()): number {
  const cutoff = new Date(now);
  const day = cutoff.getDay();
  let daysBack = (day - 2 + 7) % 7;
  if (day === 2 && cutoff.getHours() < 9) {
    daysBack = 7;
  }
  cutoff.setDate(cutoff.getDate() - daysBack);
  cutoff.setHours(9, 0, 0, 0);
  return cutoff.getTime();
}

export function isPastTuesdayCutoff(timestamp: string | number, now = new Date()): boolean {
  const time = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(time)) return true;
  return time < getTuesdayCutoff(now);
}

const finalSummaryCache = new Map<string, { summary: unknown; cachedAt: number }>();

export async function fetchNFLFavoritePlays(
  games: Game[],
  favorites: FavoriteTarget[],
  signal?: AbortSignal,
  includeHistorical = false,
): Promise<NFLFavoritePlay[]> {
  const nflFavorites = favorites.filter((favorite) => favorite.feedPath === 'football/nfl'
    && (favorite.type === 'team' || (favorite.teamId && ['QB', 'RB', 'WR', 'TE'].includes(favorite.position ?? ''))));
  const favoriteTeamId = (favorite: FavoriteTarget) => favorite.type === 'team' ? favorite.id : favorite.teamId ?? '';
  const cutoff = includeHistorical ? -Infinity : getTuesdayCutoff();
  const relevantGames = games.filter((game) => game.sport === 'Football'
    && (game.status === 'LIVE' || (game.status === 'FINAL' && (!game.date || Date.parse(game.date) >= cutoff)))
    && nflFavorites.some((favorite) => favoriteTeamId(favorite) === game.home.id || favoriteTeamId(favorite) === game.away.id));
  const results = await Promise.allSettled(relevantGames.map(async (game) => {
    let summary: Record<string, unknown>;
    const cached = finalSummaryCache.get(game.eventId);
    if (game.status === 'FINAL' && cached && cached.cachedAt >= cutoff) {
      summary = cached.summary as Record<string, unknown>;
    } else {
      const response = await fetch(`${apiBase}/${game.feedPath}/summary?event=${encodeURIComponent(game.eventId)}`, { signal });
      if (!response.ok) throw new Error(`Live play summary returned HTTP ${response.status}`);
      summary = asObject(await response.json());
      if (game.status === 'FINAL') {
        finalSummaryCache.set(game.eventId, { summary, cachedAt: Date.now() });
      }
    }
    const drives = asObject(summary.drives);
    const scoringTeamByPlayId = new Map(asArray(summary.scoringPlays).map(asObject)
      .map((scoringPlay) => [text(scoringPlay.id), text(asObject(scoringPlay.team).id)] as const));
    const driveList = [...asArray(drives.previous), ...asArray(drives.current)];
    const plays = driveList.flatMap((drive) => {
      const driveObject = asObject(drive);
      const driveTeamId = text(asObject(driveObject.team).id);
      return asArray(driveObject.plays).map((play) => ({ play: asObject(play), driveTeamId }));
    });
    const gameFavorites = nflFavorites.filter((favorite) => favoriteTeamId(favorite) === game.home.id || favoriteTeamId(favorite) === game.away.id);
    return plays.flatMap(({ play, driveTeamId }): NFLFavoritePlay[] => {
      const description = text(play.text);
      const playType = text(asObject(play.type).text).toLowerCase();
      const isPass = playType.includes('pass') || /\bpass\b/i.test(description);
      const isRush = playType.includes('rush') || /\b(rush|runs?)\b/i.test(description);
      const isCatch = isPass && /\bto\b/i.test(description) && !/incomplete|intercepted|sacked/i.test(description);
      const isTouchdown = playType.includes('touchdown') || /touchdown/i.test(description);
      const isScoringPlay = play.scoringPlay === true || isTouchdown;
      const isTurnover = play.isTurnover === true;
      const yards = parsePlayYards(play, description);
      const happenedAt = Date.parse(text(play.wallclock, text(play.modified)));
      const timestamp = Number.isFinite(happenedAt) ? new Date(happenedAt).toISOString() : (game.date || new Date().toISOString());
      if (Date.parse(timestamp) < cutoff) return [];
      const participants = asArray(play.teamParticipants).map(asObject);
      const offenseTeamId = text(participants.find((participant) => text(participant.type).toLowerCase() === 'offense')?.id, driveTeamId);
      const defenseTeamId = text(participants.find((participant) => text(participant.type).toLowerCase() === 'defense')?.id,
        offenseTeamId === game.home.id ? game.away.id : game.home.id);
      const scoringTeamId = scoringTeamByPlayId.get(text(play.id)) ?? (isScoringPlay ? offenseTeamId : '');
      return gameFavorites.flatMap((favorite) => {
        const teamId = favoriteTeamId(favorite);
        const favoriteIsOnOffense = offenseTeamId === teamId;
        const favoriteIsOnDefense = defenseTeamId === teamId;
        let playLabel = '';
        let isDefensive = false;
        if (favorite.type === 'player') {
          if (!playMentionsPlayer(description, favorite.name)) return [];
          const position = favorite.position?.toUpperCase();
          if (isTouchdown) {
            if (position === 'QB') {
              if (isPass && /\bpass from\b/i.test(description)) playLabel = 'Touchdown pass';
              else if (isRush) playLabel = 'Rushing touchdown';
            } else if (position === 'RB' && (isRush || isCatch)) {
              playLabel = 'Touchdown';
            } else if ((position === 'WR' || position === 'TE') && isCatch) {
              playLabel = 'Touchdown catch';
            }
          } else if (position === 'QB' && isPass && yards > 50) {
            playLabel = `Pass for ${yards} yards`;
          } else if (position === 'RB' && (isRush || isCatch) && yards > 25) {
            playLabel = isCatch ? `Catch for ${yards} yards` : `Run for ${yards} yards`;
          } else if ((position === 'WR' || position === 'TE') && isCatch && yards > 25) {
            playLabel = `Catch for ${yards} yards`;
          }
        } else if (favoriteIsOnDefense && isTurnover) {
          isDefensive = true;
          playLabel = isTouchdown && scoringTeamId === teamId ? 'Defensive touchdown' : 'Defensive turnover';
        } else if (favorite.type === 'team' && scoringTeamId === teamId) {
          isDefensive = !favoriteIsOnOffense;
          playLabel = isTouchdown
            ? isDefensive ? 'Defensive touchdown' : 'Touchdown'
            : isDefensive ? 'Defensive scoring play' : 'Scoring play';
        } else if (favoriteIsOnOffense) {
          if (isScoringPlay) playLabel = isTouchdown ? 'Touchdown' : 'Scoring play';
          else if (isPass && yards > 50) playLabel = `Pass for ${yards} yards`;
          else if (isCatch && yards > 25) playLabel = `Catch for ${yards} yards`;
          else if (isRush && yards > 25) playLabel = `Run for ${yards} yards`;
        }
        if (!playLabel) return [];
        const team = teamId === game.home.id ? game.home : game.away;
        const opponent = teamId === game.home.id ? game.away : game.home;
        return [{
          id: `${game.id}:${text(play.id, description)}:${favorite.key}`,
          favoriteKey: favorite.key,
          favoriteName: favorite.name,
          favoriteType: favorite.type,
          headshot: favorite.type === 'player' ? favorite.headshot : undefined,
          teamLogo: favorite.type === 'team' ? team.logo : undefined,
          teamAbbr: team.abbr,
          opponentAbbr: opponent.abbr,
          timestamp,
          playLabel,
          description,
          yards,
          isTouchdown,
          isDefensive,
        }];
      });
    });
  }));
  if (includeHistorical) {
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .sort((first, second) => Date.parse(second.timestamp) - Date.parse(first.timestamp));
}

type RawSoccerPlayer = {
  athlete?: Record<string, unknown>;
  player?: Record<string, unknown>;
  starter?: boolean | string;
  position?: string | { displayName?: string; abbreviation?: string };
  statistics?: Array<{ name?: string; displayName?: string; abbreviation?: string; displayValue?: string; value?: number }>;
  stats?: Array<{ name?: string; displayName?: string; abbreviation?: string; displayValue?: string; value?: number }>;
};

type RawSoccerSummary = {
  rosters?: Array<{
    team?: { id?: string; displayName?: string };
    homeAway?: string;
    formation?: string;
    roster?: RawSoccerPlayer[];
  }>;
};

type SoccerGameContext = {
  eventId: string;
  feedPath: string;
  home: Pick<Team, 'id' | 'name'>;
  away: Pick<Team, 'id' | 'name'>;
};

function findStat(player: RawSoccerPlayer, names: string[]): string {
  const stats = player.statistics ?? player.stats ?? [];
  const match = stats.find((stat) => names.includes((stat.name ?? stat.abbreviation ?? stat.displayName ?? '').toLowerCase().replace(/[^a-z]/g, '')));
  return match?.displayValue ?? (typeof match?.value === 'number' ? String(match.value) : '0');
}

function mapLineup(group: NonNullable<RawSoccerSummary['rosters']>[number], game: SoccerGameContext): SoccerLineup {
  const rawPlayers = group.roster ?? [];
  const starters = rawPlayers.filter((player) => player.starter === true || player.starter === 'true');
  const players = starters.map((player) => {
    const athlete = player.athlete ?? player.player ?? {};
    const position = typeof player.position === 'string'
      ? player.position
      : text(player.position?.abbreviation, text(player.position?.displayName, text(asObject(athlete.position).abbreviation, '')));
    const name = text(athlete.displayName, text(athlete.fullName, 'Player'));
    return {
      id: text(athlete.id, name),
      name,
      initials: name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase(),
      position,
      jersey: text(athlete.jersey, text(athlete.number, '')),
      headshot: text(athlete.headshot, '') || undefined,
      minutes: findStat(player, ['minutes', 'minutesplayed']),
      goals: findStat(player, ['goals', 'goal']),
      assists: findStat(player, ['assists', 'assist']),
      shots: findStat(player, ['shots', 'totalshots']),
      shotsOnTarget: findStat(player, ['shotsontarget', 'shotsongoal', 'sog']),
    };
  });

  const teamId = text(group.team?.id);
  const homeAway = group.homeAway === 'home' || teamId === game.home.id ? 'home' : 'away';
  return {
    teamId,
    teamName: text(group.team?.displayName, homeAway === 'home' ? game.home.name : game.away.name),
    side: homeAway,
    formation: group.formation ?? '',
    players,
  };
}

export async function fetchSoccerLineups(game: SoccerGameContext, signal?: AbortSignal): Promise<SoccerLineup[]> {
  const response = await fetch(`${apiBase}/${game.feedPath}/summary?event=${encodeURIComponent(game.eventId)}`, { signal });
  if (!response.ok) throw new Error(`Match details returned HTTP ${response.status}`);
  const summary = await response.json() as RawSoccerSummary;
  return (summary.rosters ?? [])
    .map((group) => mapLineup(group, game))
    .filter((lineup) => lineup.players.length > 0)
    .sort((first) => first.side === 'away' ? -1 : 1);
}

function isInjuryInactive(status: string, desc?: string, name?: string, abbr?: string): boolean {
  const s = status.toLowerCase();
  const d = (desc || '').toLowerCase();
  const n = (name || '').toLowerCase();
  const a = (abbr || '').toLowerCase();
  return /^(out|injured reserve|ir|suspension|suspended|reserve-ret|doubtful)$/i.test(s)
    || /out|injured reserve|ir|suspension/i.test(d)
    || /out|injured_reserve|ir|suspension/i.test(n)
    || a === 'o' || a === 'ir';
}

export async function fetchNFLGameDetails(
  feedPath: string,
  eventId: string,
  seasonYear: number,
  teams: Array<Pick<Team, 'id' | 'name'>>,
  signal?: AbortSignal,
): Promise<NFLGameDetails> {
  const response = await fetch(`${apiBase}/${feedPath}/summary?event=${encodeURIComponent(eventId)}`, { signal });
  if (!response.ok) throw new Error(`Game details returned HTTP ${response.status}`);

  const summary = asObject(await response.json());
  const boxscoreTeams = asArray(asObject(summary.boxscore).teams).map(asObject);
  const recentGroups = asArray(summary.lastFiveGames).map(asObject);
  const atsGroups = asArray(summary.againstTheSpread).map(asObject);

  const outPlayerIds = new Set<string>();
  asArray(summary.injuries).map(asObject).forEach((teamGroup) => {
    asArray(teamGroup.injuries).map(asObject).forEach((item) => {
      const athlete = asObject(item.athlete);
      const athleteId = text(athlete.id);
      const typeObj = asObject(item.type);
      if (isInjuryInactive(
        text(item.status),
        text(typeObj.description),
        text(typeObj.name),
        text(typeObj.abbreviation),
      )) {
        if (athleteId) outPlayerIds.add(athleteId);
      }
    });
  });
  const recentEventsByTeam = new Map(await Promise.all(teams.map(async (team) => {
    const recentGroup = recentGroups.find((entry) => text(asObject(entry.team).id, text(entry.team)) === team.id);
    const events = asArray(recentGroup?.events).map(asObject);
    if (events.length) return [team.id, events] as const;
    // ESPN drops lastFiveGames while a game is in progress, so rebuild it from the team schedule.
    return [team.id, await fetchNFLRecentScheduleEvents(feedPath, team.id, seasonYear, eventId).catch(() => [])] as const;
  })));
  const allRecentEvents = new Map<string, Record<string, unknown>>();
  recentEventsByTeam.forEach((events) => events.forEach((event) => allRecentEvents.set(text(event.id), event)));
  const rosterTeamIds = new Set(teams.map((team) => team.id));
  recentEventsByTeam.forEach((events) => events.forEach((event) => {
    const opponentId = text(asObject(event.opponent).id, text(event.opponentId));
    if (opponentId) rosterTeamIds.add(opponentId);
  }));
  const [rosterResults, historicalResults, defenseRankResults] = await Promise.all([
    Promise.all([...rosterTeamIds].map(async (teamId) => {
      try {
        return [teamId, await fetchNFLActiveSkillRoster(feedPath, teamId, seasonYear)] as const;
      } catch {
        return [teamId, [] as NFLRosterSkillPlayer[]] as const;
      }
    })),
    Promise.all([...allRecentEvents.keys()].map(async (recentEventId) => {
      try {
        return [recentEventId, await fetchNFLHistoricalSummary(feedPath, recentEventId)] as const;
      } catch {
        return [recentEventId, null] as const;
      }
    })),
    Promise.all(teams.map(async (team) => {
      try {
        return [team.id, await fetchNFLTeamDefenseRanks(feedPath, team.id, seasonYear)] as const;
      } catch {
        return [team.id, { passing: null, rushing: null, receiving: null }] as const;
      }
    })),
  ]);
  const rostersByTeam = new Map(rosterResults);
  const summariesByGame = new Map(historicalResults.filter((result): result is readonly [string, unknown] => result[1] !== null));
  const defenseRanksByTeam = new Map(defenseRankResults);
  const teamForms: NFLTeamForm[] = teams.map((team) => {
    const boxscoreTeam = boxscoreTeams.find((entry) => text(asObject(entry.team).id) === team.id);
    const statEntries = asArray(boxscoreTeam?.statistics).map(asObject);
    const stats = Object.fromEntries(statEntries.map((entry) => [text(entry.name), text(entry.displayValue)]));
    const rawRecentGames = recentEventsByTeam.get(team.id) ?? [];
    const recentGames = rawRecentGames.map((event): NFLRecentGame => {
      const homeTeamId = text(event.homeTeamId);
      const isHome = homeTeamId === team.id;
      const homeScore = Number(event.homeTeamScore);
      const awayScore = Number(event.awayTeamScore);
      const hasScore = Number.isFinite(homeScore) && Number.isFinite(awayScore);
      const pointsFor = hasScore ? (isHome ? homeScore : awayScore) : null;
      const pointsAgainst = hasScore ? (isHome ? awayScore : homeScore) : null;
      return {
        gameId: text(event.id),
        date: text(event.gameDate),
        opponent: text(asObject(event.opponent).displayName, text(asObject(event.opponent).abbreviation, text(event.opponent, 'Opponent'))),
        opponentAbbreviation: text(asObject(event.opponent).abbreviation, text(asObject(event.opponent).displayName, 'OPP')),
        opponentId: text(asObject(event.opponent).id, text(event.opponentId)),
        result: text(event.gameResult),
        score: pointsFor !== null && pointsAgainst !== null ? `${pointsFor}-${pointsAgainst}` : text(event.score),
        pointsFor,
        pointsAgainst,
        total: pointsFor !== null && pointsAgainst !== null ? pointsFor + pointsAgainst : null,
      };
    }).sort((first, second) => Date.parse(second.date) - Date.parse(first.date));
    const primaryYardsAllowed = (categoryName: string, position: string) => {
      const yards = rawRecentGames.flatMap((event) => {
        const opponentId = text(asObject(event.opponent).id, text(event.opponentId));
        const eligiblePlayerIds = new Set((rostersByTeam.get(opponentId) ?? [])
          .filter((player) => player.position === position)
          .map((player) => player.id));
        if (eligiblePlayerIds.size === 0) return [];
        const historicalSummary = summariesByGame.get(text(event.id));
        const value = getPrimaryPlayerYards(historicalSummary, team.id, categoryName, eligiblePlayerIds);
        return value === undefined ? [] : [value];
      });
      return yards.length ? yards.reduce((total, value) => total + value, 0) / yards.length : null;
    };
    const atsGroup = atsGroups.find((entry) => text(asObject(entry.team).id) === team.id);
    const atsRecord = asArray(atsGroup?.records).map(asObject).find((record) => /spread|ats/i.test(`${text(record.name)} ${text(record.abbreviation)}`));
    const activeTeamRoster = (rostersByTeam.get(team.id) ?? []).filter((rosterPlayer) => !outPlayerIds.has(rosterPlayer.id));
    const skillPlayers = activeTeamRoster.map((rosterPlayer) => {
      const playerRecentGames = recentGames.map((recentGame) => ({
        ...recentGame,
        stats: readNFLPlayerGameStats(summariesByGame.get(recentGame.gameId), team.id, rosterPlayer.id),
      }));
      const usageGames = playerRecentGames.filter((recentGame) => hasFantasyRelevantUsage(recentGame.stats));
      const usage = (key: NFLPlayerStatKey) => usageGames.reduce((total, recentGame) => total + (recentGame.stats[key] ?? 0), 0);
      return {
        ...rosterPlayer,
        gamesWithUsage: usageGames.length,
        passingAttempts: usage('attempts'),
        targets: usage('targets'),
        receptions: usage('receptions'),
        carries: usage('carries'),
        recentGames: playerRecentGames,
      };
    }).sort((first, second) => {
      const positionDifference = nflPositionOrder.indexOf(first.position) - nflPositionOrder.indexOf(second.position);
      if (positionDifference) return positionDifference;
      const usage = (player: NFLSkillPlayer) => player.position === 'QB'
        ? player.passingAttempts + player.carries
        : player.position === 'RB'
          ? player.carries + player.targets
          : player.targets || player.receptions;
      return usage(second) - usage(first) || second.gamesWithUsage - first.gamesWithUsage || first.name.localeCompare(second.name);
    });

    return {
      teamId: team.id,
      teamName: team.name,
      stats,
      defenseRanks: defenseRanksByTeam.get(team.id) ?? { passing: null, rushing: null, receiving: null },
      primaryPassingYardsAllowedPerGame: primaryYardsAllowed('passing', 'QB'),
      primaryRushingYardsAllowedPerGame: primaryYardsAllowed('rushing', 'RB'),
      primaryReceivingYardsAllowedPerGame: primaryYardsAllowed('receiving', 'WR'),
      primaryTightEndReceivingYardsAllowedPerGame: primaryYardsAllowed('receiving', 'TE'),
      atsRecord: atsRecord ? text(atsRecord.summary) : undefined,
      recentGames,
      skillPlayers,
    };
  });

  return { teamForms };
}

export async function fetchNFLGameLeaders(feedPath: string, eventId: string, signal?: AbortSignal): Promise<NFLGameLeader[]> {
  const response = await fetch(`${apiBase}/${feedPath}/summary?event=${encodeURIComponent(eventId)}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Live player stats returned HTTP ${response.status}`);
  return readNFLGameLeaders(await response.json());
}

async function fetchNFLRecentScheduleEvents(feedPath: string, teamId: string, seasonYear: number, currentEventId: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${apiBase}/${feedPath}/teams/${teamId}/schedule?season=${seasonYear}`);
  if (!response.ok) throw new Error(`Team schedule returned HTTP ${response.status}`);
  const events = asArray(asObject(await response.json()).events).map(asObject)
    .filter((event) => text(event.id) !== currentEventId && text(asObject(asObject(asArray(event.competitions)[0]).status).type ? asObject(asObject(asObject(asArray(event.competitions)[0]).status).type).state : '') === 'post')
    .sort((first, second) => Date.parse(text(second.date)) - Date.parse(text(first.date)))
    .slice(0, 5);
  return events.flatMap((event) => {
    const competitors = asArray(asObject(asArray(event.competitions)[0]).competitors).map(asObject);
    const own = competitors.find((entry) => text(entry.id, text(asObject(entry.team).id)) === teamId);
    const opponent = competitors.find((entry) => entry !== own);
    if (!own || !opponent) return [];
    const scoreOf = (entry: Record<string, unknown>) => text(asObject(entry.score).displayValue, text(entry.score));
    const home = own.homeAway === 'home' ? own : opponent;
    const away = home === own ? opponent : own;
    const opponentTeam = asObject(opponent.team);
    return [{
      id: text(event.id),
      gameDate: text(event.date),
      homeTeamId: text(asObject(home.team).id, text(home.id)),
      homeTeamScore: scoreOf(home),
      awayTeamScore: scoreOf(away),
      gameResult: own.winner === true ? 'W' : opponent.winner === true ? 'L' : 'T',
      opponent: { id: text(opponentTeam.id, text(opponent.id)), displayName: text(opponentTeam.displayName), abbreviation: text(opponentTeam.abbreviation) },
    }];
  });
}

export async function fetchNFLLivePlayerStats(
  feedPath: string,
  eventId: string,
  players: Array<{ teamId: string; id: string }>,
  signal?: AbortSignal,
): Promise<Record<string, Partial<Record<NFLPlayerStatKey, number>>>> {
  const response = await fetch(`${apiBase}/${feedPath}/summary?event=${encodeURIComponent(eventId)}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Live player stats returned HTTP ${response.status}`);
  const summary = await response.json();
  return Object.fromEntries(players.map((player) => [player.id, readNFLPlayerGameStats(summary, player.teamId, player.id)]));
}

const nflDefenseRankCache = new Map<string, Promise<NFLDefenseRanks>>();

export async function fetchNFLTeamSeasonAverages(
  feedPath: string,
  teamId: string,
  seasonYear: number,
  signal?: AbortSignal,
): Promise<NFLTeamSeasonAverages> {
  const response = await fetch(`${apiBase}/${feedPath}/teams/${encodeURIComponent(teamId)}/statistics?season=${seasonYear}&seasontype=2`, { signal });
  if (!response.ok) throw new Error(`Team season averages returned HTTP ${response.status}`);
  const payload = asObject(await response.json());
  const results = asObject(payload.results);
  const ownCategories = asArray(asObject(results.stats).categories).map(asObject);
  const opponentCategories = asArray(results.opponent).map(asObject);
  const average = (categories: Record<string, unknown>[], categoryName: string, statName: string) => {
    const category = categories.find((entry) => text(entry.name) === categoryName);
    const stat = asArray(category?.stats).map(asObject).find((entry) => text(entry.name) === statName);
    return parseBoxscoreNumber(stat?.value) ?? null;
  };
  return {
    teamId,
    pointsPerGame: average(ownCategories, 'scoring', 'totalPointsPerGame'),
    totalYardsPerGame: average(ownCategories, 'passing', 'yardsPerGame'),
    passingYardsPerGame: average(ownCategories, 'passing', 'passingYardsPerGame'),
    rushingYardsPerGame: average(ownCategories, 'rushing', 'rushingYardsPerGame'),
    pointsAllowedPerGame: average(opponentCategories, 'scoring', 'totalPointsPerGame'),
    totalYardsAllowedPerGame: average(opponentCategories, 'passing', 'yardsPerGame'),
    passingYardsAllowedPerGame: average(opponentCategories, 'passing', 'passingYardsPerGame'),
    rushingYardsAllowedPerGame: average(opponentCategories, 'rushing', 'rushingYardsPerGame'),
  };
}

function fetchNFLTeamDefenseRanks(feedPath: string, teamId: string, seasonYear: number): Promise<NFLDefenseRanks> {
  const cacheKey = `${feedPath}:${teamId}:${seasonYear}`;
  const cached = nflDefenseRankCache.get(cacheKey);
  if (cached) return cached;
  const request = fetch(`${apiBase}/${feedPath}/teams/${teamId}/statistics?season=${seasonYear}&seasontype=2&category=defensive`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Team defense rankings returned HTTP ${response.status}`);
      const payload = asObject(await response.json());
      const categories = asArray(asObject(asObject(payload.results).opponent)).map(asObject);
      const rankFor = (categoryName: string, statName: string) => {
        const category = categories.find((entry) => text(entry.name).toLowerCase() === categoryName);
        const stat = asArray(category?.stats).map(asObject).find((entry) => text(entry.name) === statName);
        return parseBoxscoreNumber(stat?.rank) ?? null;
      };
      return {
        passing: rankFor('passing', 'passingYardsPerGame'),
        rushing: rankFor('rushing', 'rushingYardsPerGame'),
        receiving: rankFor('receiving', 'receivingYardsPerGame'),
      };
    });
  nflDefenseRankCache.set(cacheKey, request);
  void request.catch(() => nflDefenseRankCache.delete(cacheKey));
  return request;
}

function parseBoxscoreNumber(value: unknown): number | undefined {
  const parsed = Number.parseFloat(text(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readNFLGameLeaders(summary: unknown): NFLGameLeader[] {
  const categories = [
    { name: 'passing', label: 'PASS YDS' as const },
    { name: 'rushing', label: 'RUSH YDS' as const },
    { name: 'receiving', label: 'REC YDS' as const },
  ];
  return asArray(asObject(asObject(summary).boxscore).players).map(asObject).flatMap((teamGroup) => {
    const teamId = text(asObject(teamGroup.team).id);
    return asArray(teamGroup.statistics).map(asObject).flatMap((category) => {
      const definition = categories.find((entry) => entry.name === text(category.name).toLowerCase());
      if (!definition) return [];
      const yardIndex = asArray(category.labels).findIndex((label) => text(label).toUpperCase() === 'YDS');
      if (yardIndex < 0) return [];
      const leader = asArray(category.athletes).map(asObject).flatMap((entry) => {
        const athlete = asObject(entry.athlete);
        const yards = parseBoxscoreNumber(asArray(entry.stats)[yardIndex]);
        const name = text(athlete.displayName, text(athlete.fullName));
        if (yards === undefined || yards <= 0 || !name) return [];
        return [{
          teamId,
          athleteId: text(athlete.id),
          name,
          position: text(asObject(athlete.position).abbreviation),
          headshot: text(athlete.headshot) || undefined,
          category: definition.label,
          yards,
        }];
      }).sort((first, second) => second.yards - first.yards)[0];
      return leader ? [leader] : [];
    });
  });
}

function getPrimaryPlayerYards(summary: unknown, defendingTeamId: string, categoryName: string, eligiblePlayerIds: Set<string>): number | undefined {
  const playerGroups = asArray(asObject(asObject(summary).boxscore).players).map(asObject);
  const offense = playerGroups.find((group) => text(asObject(group.team).id) !== defendingTeamId);
  const category = asArray(offense?.statistics).map(asObject).find((entry) => text(entry.name).toLowerCase() === categoryName);
  if (!category) return undefined;
  const yardIndex = asArray(category.labels).findIndex((label) => text(label).toUpperCase() === 'YDS');
  if (yardIndex < 0) return undefined;
  const yards = asArray(category.athletes).map(asObject).filter((entry) => eligiblePlayerIds.has(text(asObject(entry.athlete).id))).flatMap((entry) => {
    const value = parseBoxscoreNumber(asArray(entry.stats)[yardIndex]);
    return value === undefined ? [] : [value];
  });
  return yards.length ? Math.max(...yards) : undefined;
}

function readNFLPlayerGameStats(summary: unknown, teamId: string, playerId: string): Partial<Record<NFLPlayerStatKey, number>> {
  const playerGroups = asArray(asObject(asObject(summary).boxscore).players).map(asObject);
  const teamGroup = playerGroups.find((group) => text(asObject(group.team).id) === teamId);
  const categories = asArray(teamGroup?.statistics).map(asObject);
  const seasonStats: Partial<Record<NFLPlayerStatKey, number>> = {};
  let foundPlayer = false;

  categories.forEach((category) => {
    const athletes = asArray(category.athletes).map(asObject);
    const playerEntry = athletes.find((entry) => text(asObject(entry.athlete).id) === playerId);
    if (!playerEntry) return;
    foundPlayer = true;

    const labels = asArray(category.labels).map((label) => text(label).toUpperCase());
    const values = asArray(playerEntry.stats).map((value) => text(value));
    const valueFor = (label: string) => {
      const index = labels.indexOf(label);
      return index >= 0 ? values[index] : undefined;
    };
    const categoryName = text(category.name).toLowerCase();

    if (categoryName === 'passing') {
      const completionAttempt = (valueFor('C/ATT') ?? values[0] ?? '').match(/([\d,]+)\s*\/\s*([\d,]+)/);
      if (completionAttempt) {
        seasonStats.completions = Number.parseInt(completionAttempt[1].replace(/,/g, ''), 10);
        seasonStats.attempts = Number.parseInt(completionAttempt[2].replace(/,/g, ''), 10);
      }
      const yards = parseBoxscoreNumber(valueFor('YDS'));
      const touchdowns = parseBoxscoreNumber(valueFor('TD'));
      const interceptions = parseBoxscoreNumber(valueFor('INT'));
      if (yards !== undefined) seasonStats.passingYards = yards;
      if (touchdowns !== undefined) seasonStats.passingTouchdowns = touchdowns;
      if (interceptions !== undefined) seasonStats.interceptions = interceptions;
    } else if (categoryName === 'rushing') {
      const carries = parseBoxscoreNumber(valueFor('CAR'));
      const yards = parseBoxscoreNumber(valueFor('YDS'));
      const touchdowns = parseBoxscoreNumber(valueFor('TD'));
      if (carries !== undefined) seasonStats.carries = carries;
      if (yards !== undefined) seasonStats.rushingYards = yards;
      if (touchdowns !== undefined) seasonStats.rushingTouchdowns = touchdowns;
    } else if (categoryName === 'receiving') {
      const receptions = parseBoxscoreNumber(valueFor('REC'));
      const targets = parseBoxscoreNumber(valueFor('TGTS'));
      const yards = parseBoxscoreNumber(valueFor('YDS'));
      const touchdowns = parseBoxscoreNumber(valueFor('TD'));
      if (receptions !== undefined) seasonStats.receptions = receptions;
      if (targets !== undefined) seasonStats.targets = targets;
      if (yards !== undefined) seasonStats.receivingYards = yards;
      if (touchdowns !== undefined) seasonStats.receivingTouchdowns = touchdowns;
    }
  });

  if (!foundPlayer) return {};
  const yards = [seasonStats.passingYards, seasonStats.rushingYards, seasonStats.receivingYards]
    .filter((value): value is number => value !== undefined);
  if (yards.length > 0) seasonStats.totalYards = yards.reduce((total, value) => total + value, 0);
  return seasonStats;
}

type NFLRosterSkillPlayer = Pick<NFLSkillPlayer, 'id' | 'name' | 'position' | 'jersey' | 'headshot'>;
const nflSkillPositions = new Set(['QB', 'RB', 'WR', 'TE']);
const nflPositionOrder = ['QB', 'RB', 'WR', 'TE'];
const nflHistoricalSummaries = new Map<string, Promise<unknown>>();
const nflRosters = new Map<string, { timestamp: number; promise: Promise<NFLRosterSkillPlayer[]> }>();

function fetchNFLActiveRoster(feedPath: string, teamId: string, season: number): Promise<NFLRosterSkillPlayer[]> {
  const cacheKey = `${feedPath}:${teamId}:${season}`;
  const cached = nflRosters.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 300_000) return cached.promise;
  const request = fetch(`${apiBase}/${feedPath}/teams/${teamId}/roster?season=${season}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Team roster returned HTTP ${response.status}`);
      const payload = asObject(await response.json());
      return asArray(payload.athletes).map(asObject).flatMap((group) => asArray(group.items)).map(asObject).flatMap((player) => {
        const position = text(asObject(player.position).abbreviation).toUpperCase();
        const statusObj = asObject(player.status);
        const statusType = text(statusObj.type).toLowerCase();
        const statusName = text(statusObj.name).toLowerCase();
        if (
          statusType === 'practice-squad'
          || statusType === 'injured-reserve'
          || statusType === 'ir'
          || statusType === 'suspended'
          || statusName.includes('reserve')
          || statusName.includes('practice')
        ) {
          return [];
        }
        if (statusType && statusType !== 'active' && statusType !== 'day-to-day') return [];

        const injuries = asArray(player.injuries).map(asObject);
        const isOut = injuries.some((inj) => {
          const typeObj = asObject(inj.type);
          return isInjuryInactive(
            text(inj.status),
            text(typeObj.description),
            text(typeObj.name),
            text(typeObj.abbreviation),
          );
        });
        if (isOut) return [];

        const headshot = asObject(player.headshot);
        return [{
          id: text(player.id),
          name: text(player.displayName, text(player.fullName, 'Player')),
          position,
          jersey: text(player.jersey),
          headshot: text(player.headshot, text(headshot.href, '')) || undefined,
        }];
      });
    });
  nflRosters.set(cacheKey, { timestamp: Date.now(), promise: request });
  void request.catch(() => nflRosters.delete(cacheKey));
  return request;
}

async function fetchNFLActiveSkillRoster(feedPath: string, teamId: string, season: number): Promise<NFLRosterSkillPlayer[]> {
  return (await fetchNFLActiveRoster(feedPath, teamId, season)).filter((player) => nflSkillPositions.has(player.position));
}

export async function findNFLTeamsForPlayerSearch(games: Game[], searchQuery: string): Promise<string[]> {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (normalizedQuery.length < 2) return [];
  const teams = new Map<string, { feedPath: string; seasonYear: number }>();
  games.filter((game) => game.sport === 'Football').forEach((game) => {
    [game.away, game.home].forEach((team) => teams.set(team.id, { feedPath: game.feedPath, seasonYear: game.seasonYear }));
  });
  const entries = [...teams.entries()];
  const matches = new Set<string>();
  for (let start = 0; start < entries.length; start += 8) {
    const batch = await Promise.all(entries.slice(start, start + 8).map(async ([teamId, config]) => {
      try {
        const roster = await fetchNFLActiveSkillRoster(config.feedPath, teamId, config.seasonYear);
        return roster.some((player) => player.name.toLowerCase().includes(normalizedQuery)) ? teamId : null;
      } catch {
        return null;
      }
    }));
    batch.forEach((teamId) => { if (teamId) matches.add(teamId); });
  }
  return [...matches];
}

function fetchNFLHistoricalSummary(feedPath: string, eventId: string): Promise<unknown> {
  const cacheKey = `${feedPath}:${eventId}`;
  const cached = nflHistoricalSummaries.get(cacheKey);
  if (cached) return cached;

  const request = fetch(`${apiBase}/${feedPath}/summary?event=${encodeURIComponent(eventId)}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Historical game returned HTTP ${response.status}`);
      return await response.json() as unknown;
    });
  nflHistoricalSummaries.set(cacheKey, request);
  void request.catch(() => nflHistoricalSummaries.delete(cacheKey));
  return request;
}

function hasFantasyRelevantUsage(stats: Partial<Record<NFLPlayerStatKey, number>>): boolean {
  return (stats.targets ?? 0) > 0
    || (stats.receptions ?? 0) > 0
    || (stats.carries ?? 0) > 0
    || (stats.attempts ?? 0) > 0
    || (stats.passingTouchdowns ?? 0) > 0
    || (stats.rushingTouchdowns ?? 0) > 0
    || (stats.receivingTouchdowns ?? 0) > 0;
}

export async function fetchNFLPlayerGameLog(
  feedPath: string,
  teamId: string,
  playerId: string,
  recentGames: NFLRecentGame[],
  signal?: AbortSignal,
): Promise<NFLPlayerGame[]> {
  const results = await Promise.allSettled(recentGames.map(async (game) => {
    const response = await fetch(`${apiBase}/${feedPath}/summary?event=${encodeURIComponent(game.gameId)}`, { signal });
    if (!response.ok) throw new Error(`Game log returned HTTP ${response.status}`);
    const summary: unknown = await response.json();
    return {
      gameId: game.gameId,
      date: game.date,
      opponent: game.opponent,
      opponentAbbreviation: game.opponentAbbreviation,
      result: game.result,
      score: game.score,
      stats: readNFLPlayerGameStats(summary, teamId, playerId),
    } satisfies NFLPlayerGame;
  }));

  return results.flatMap((result, index) => result.status === 'fulfilled'
    ? [result.value]
    : [{
        gameId: recentGames[index].gameId,
        date: recentGames[index].date,
        opponent: recentGames[index].opponent,
        opponentAbbreviation: recentGames[index].opponentAbbreviation,
        result: recentGames[index].result,
        score: recentGames[index].score,
        stats: {},
      }]);
}

export type NFLBoxScoreAthlete = {
  id: string;
  name: string;
  shortName: string;
  jersey?: string;
  headshot?: string;
  position?: string;
  stats: string[];
};

export type NFLBoxScoreCategory = {
  name: string;
  title: string;
  labels: string[];
  athletes: NFLBoxScoreAthlete[];
  totals?: string[];
};

export type NFLPlayerSeasonBoxScore = {
  teamId: string;
  categories: NFLBoxScoreCategory[];
  failedPlayers: number;
};

export function readNFLPlayerSeasonTotals(
  payload: unknown,
  player: NFLRosterSkillPlayer,
  teamId: string,
  seasonYear: number,
): NFLBoxScoreCategory[] {
  const definitions = [
    { name: 'passing', fields: ['completions', 'passingAttempts', 'passingYards', 'passingTouchdowns', 'interceptions'], labels: ['CMP', 'ATT', 'YDS', 'PASS TD', 'INT'] },
    { name: 'rushing', fields: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns', 'rushingFumbles'], labels: ['CAR', 'YDS', 'RUSH TD', 'FUM'] },
    { name: 'receiving', fields: ['receptions', 'receivingTargets', 'receivingYards', 'receivingTouchdowns', 'receivingFumbles'], labels: ['REC', 'TGT', 'YDS', 'REC TD', 'FUM'] },
    { name: 'defensive', fields: ['totalTackles', 'soloTackles', 'sacks', 'interceptions', 'passesDefended', 'fumblesForced'], labels: ['TACK', 'SOLO', 'SACK', 'INT', 'PD', 'FF'] },
    { name: 'kicking', fields: ['fieldGoalsMade', 'fieldGoalAttempts', 'extraPointsMade', 'extraPointAttempts'], labels: ['FG', 'FGA', 'XP', 'XPA'] },
    { name: 'punting', fields: ['punts', 'puntYards', 'puntsInside20'], labels: ['PUNT', 'YDS', 'IN20'] },
  ];
  const categories = asArray(asObject(payload).categories).map(asObject);
  return definitions.flatMap((definition) => {
    const category = categories.find((entry) => text(entry.name) === definition.name);
    const names = asArray(category?.names).map((name) => text(name));
    const rows = asArray(category?.statistics).map(asObject).filter((row) =>
      Number(asObject(row.season).year) === seasonYear && text(row.teamId) === teamId
    );
    if (!rows.length) return [];
    const value = (row: Record<string, unknown>, name: string) => {
      const index = names.indexOf(name);
      if (index < 0 && (name === 'fieldGoalsMade' || name === 'fieldGoalAttempts')) {
        const combinedIndex = names.indexOf('fieldGoalsMade-fieldGoalAttempts');
        const combined = text(asArray(row.stats)[combinedIndex]).match(/^(\d+)-(\d+)$/);
        return combined ? Number(combined[name === 'fieldGoalsMade' ? 1 : 2]) : undefined;
      }
      return index < 0 ? undefined : parseBoxscoreNumber(asArray(row.stats)[index]);
    };
    const gameCounts = rows.map((row) => value(row, 'gamesPlayed'));
    const gamesPlayed = gameCounts.every((count) => count !== undefined && count > 0)
      ? gameCounts.reduce<number>((total, count) => total + (count ?? 0), 0)
      : null;
    const fields = definition.fields.map((name, index) => ({ name, label: definition.labels[index] }));
    if (!fields.some(({ name }) => rows.some((row) => value(row, name) !== undefined))) return [];
    const recordedValues = rows.flatMap((row) => fields.flatMap(({ name }) => {
      const stat = value(row, name);
      return stat === undefined ? [] : [stat];
    }));
    if (recordedValues.length && recordedValues.every((stat) => stat === 0)) return [];
    const stats = fields.map(({ name }) => {
      const values = rows.map((row) => value(row, name));
      if (values.some((stat) => stat === undefined)) return 'Unavailable';
      const total = values.reduce<number>((sum, stat) => sum + (stat ?? 0), 0);
      return String(total);
    });
    return [{
      name: definition.name,
      title: cleanCategoryTitle(definition.name, definition.name),
      labels: ['GP', ...fields.map((field) => field.label)],
      athletes: [{ ...player, shortName: player.name, stats: [gamesPlayed === null ? 'Unavailable' : String(gamesPlayed), ...stats] }],
    }];
  });
}

const nflPlayerSeasonBoxScoreCache = new Map<string, { timestamp: number; data: NFLPlayerSeasonBoxScore }>();

export function averageNFLPlayerSeasonCategory(category: NFLBoxScoreCategory): NFLBoxScoreCategory {
  const gamesIndex = category.labels.indexOf('GP');
  return {
    ...category,
    labels: category.labels.map((label) => label === 'GP' ? label : `${label}/G`),
    athletes: category.athletes.map((athlete) => {
      const games = parseBoxscoreNumber(athlete.stats[gamesIndex]);
      return {
        ...athlete,
        stats: athlete.stats.map((stat, index) => {
          if (index === gamesIndex) return stat;
          const total = parseBoxscoreNumber(stat);
          return games !== undefined && games > 0 && total !== undefined ? (total / games).toFixed(1) : 'Unavailable';
        }),
      };
    }),
  };
}

export function selectNFLPregamePlayers(players: NFLSkillPlayer[]): NFLSkillPlayer[] {
  const ranked = (positions: string[], usage: (player: NFLSkillPlayer) => number, limit: number) =>
    players.filter((player) => positions.includes(player.position) && player.gamesWithUsage > 0)
      .sort((first, second) => usage(second) - usage(first)
        || second.gamesWithUsage - first.gamesWithUsage || first.name.localeCompare(second.name))
      .slice(0, limit);
  return [
    ...ranked(['QB'], (player) => player.passingAttempts, 1),
    ...players.filter((player) => ['RB', 'WR', 'TE'].includes(player.position)),
  ];
}

export async function fetchNFLPlayerSeasonBoxScore(
  feedPath: string,
  teamId: string,
  seasonYear: number,
  players: NFLSkillPlayer[],
  signal?: AbortSignal,
): Promise<NFLPlayerSeasonBoxScore> {
  const roster = selectNFLPregamePlayers(players);
  const cacheKey = `${feedPath}:${teamId}:${seasonYear}:${roster.map((player) => player.id).join(',')}`;
  const cached = nflPlayerSeasonBoxScoreCache.get(cacheKey);
  signal?.throwIfAborted();
  if (cached && Date.now() - cached.timestamp < 300_000) return cached.data;
  const categories = new Map<string, NFLBoxScoreCategory>();
  let failedPlayers = 0;
  for (let index = 0; index < roster.length; index += 6) {
    signal?.throwIfAborted();
    const results = await Promise.allSettled(roster.slice(index, index + 6).map(async (player) => {
      const response = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/${feedPath}/athletes/${encodeURIComponent(player.id)}/stats?seasontype=2`, { signal });
      if (!response.ok) throw new Error(`Player season statistics returned HTTP ${response.status}`);
      return readNFLPlayerSeasonTotals(await response.json(), player, teamId, seasonYear);
    }));
    signal?.throwIfAborted();
    for (const result of results) {
      if (result.status === 'rejected') {
        failedPlayers += 1;
        continue;
      }
      for (const category of result.value) {
        if (!['passing', 'rushing', 'receiving'].includes(category.name)) continue;
        category.athletes = category.athletes.filter((player) => category.name === 'passing'
          ? player.position === 'QB' : category.name === 'rushing'
            ? player.position === 'RB' : ['WR', 'TE'].includes(player.position ?? ''));
        if (!category.athletes.length) continue;
        const existing = categories.get(category.name);
        if (existing) existing.athletes.push(...category.athletes);
        else categories.set(category.name, category);
      }
    }
  }
  const order = ['passing', 'rushing', 'receiving', 'defensive', 'kicking', 'punting'];
  const sortedCategories = [...categories.values()].sort((first, second) => order.indexOf(first.name) - order.indexOf(second.name));
  for (const category of sortedCategories) {
    const statIndex = category.labels.indexOf(category.name === 'defensive' ? 'TACK' : category.name === 'kicking' ? 'FG' : 'YDS');
    category.athletes.sort((first, second) => (parseBoxscoreNumber(second.stats[statIndex]) ?? -Infinity)
      - (parseBoxscoreNumber(first.stats[statIndex]) ?? -Infinity) || first.name.localeCompare(second.name));
    category.athletes = category.athletes.slice(0, category.name === 'passing' ? 1 : category.name === 'rushing' ? 2 : 6);
  }
  const data = { teamId, categories: sortedCategories, failedPlayers };
  if (failedPlayers === 0) nflPlayerSeasonBoxScoreCache.set(cacheKey, { timestamp: Date.now(), data });
  return data;
}

export type NFLBoxScoreTeamStat = {
  name: string;
  label: string;
  displayValue: string;
};

export type NFLBoxScoreTeam = {
  id: string;
  name: string;
  abbreviation: string;
  score: string;
  logo?: string;
  color?: string;
  alternateColor?: string;
  record?: string;
  homeAway: 'home' | 'away';
  linescores: string[];
  categories: NFLBoxScoreCategory[];
  teamStats: NFLBoxScoreTeamStat[];
};

export type NFLBoxScoreData = {
  eventId: string;
  status: string;
  state: 'pre' | 'in' | 'post';
  clock: string;
  period: number;
  isLive: boolean;
  isFinal: boolean;
  venue?: string;
  teams: [NFLBoxScoreTeam, NFLBoxScoreTeam] | [];
};

function cleanCategoryTitle(name: string, rawText: string): string {
  const map: Record<string, string> = {
    passing: 'Passing',
    rushing: 'Rushing',
    receiving: 'Receiving',
    defensive: 'Defense',
    fumbles: 'Fumbles',
    interceptions: 'Interceptions',
    kickReturns: 'Kick Returns',
    puntReturns: 'Punt Returns',
    kicking: 'Kicking',
    punting: 'Punting',
  };
  return map[name] ?? (rawText.replace(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+/i, '') || name);
}

export async function fetchNFLBoxScore(
  feedPath: string,
  eventId: string,
  signal?: AbortSignal,
): Promise<NFLBoxScoreData> {
  const response = await fetch(`${apiBase}/${feedPath}/summary?event=${encodeURIComponent(eventId)}`, {
    signal,
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`NFL box score returned HTTP ${response.status}`);
  const summary = asObject(await response.json());
  const header = asObject(summary.header);
  const competition = asObject(asArray(header.competitions)[0]);
  const statusObj = asObject(competition.status ?? header.status);
  const statusType = asObject(statusObj.type);
  const state = text(statusType.state) as 'pre' | 'in' | 'post';
  const isLive = state === 'in';
  const isFinal = state === 'post';
  const clock = text(statusObj.displayClock, text(statusType.shortDetail));
  const period = Number(statusObj.period ?? statusType.period ?? 0);
  const status = text(statusType.shortDetail, text(statusType.description, isLive ? 'Live' : isFinal ? 'Final' : 'Upcoming'));
  const gameInfo = asObject(summary.gameInfo);
  const venue = text(asObject(gameInfo.venue).fullName);

  const competitors = asArray(competition.competitors).map(asObject);
  const boxscore = asObject(summary.boxscore);
  const boxscoreTeams = asArray(boxscore.teams).map(asObject);
  const boxscorePlayers = asArray(boxscore.players).map(asObject);

  const parsedTeams: NFLBoxScoreTeam[] = competitors.map((comp) => {
    const teamObj = asObject(comp.team);
    const teamId = text(teamObj.id, text(comp.id));
    const name = text(teamObj.displayName, text(teamObj.name));
    const abbreviation = text(teamObj.abbreviation);
    const score = text(comp.score, '0');
    const color = text(teamObj.color);
    const alternateColor = text(teamObj.alternateColor);
    const logo = text(teamObj.logo, text(asArray(teamObj.logos)[0] ? asObject(asArray(teamObj.logos)[0]).href : ''));
    const homeAway = text(comp.homeAway) === 'away' ? 'away' : 'home';
    const linescores = asArray(comp.linescores).map((ls) => text(asObject(ls).displayValue, text(asObject(ls).value)));
    const record = text(asArray(comp.records)[0] ? asObject(asArray(comp.records)[0]).summary : '');

    const boxTeam = boxscoreTeams.find((bt) => text(asObject(bt.team).id) === teamId);
    const teamStats: NFLBoxScoreTeamStat[] = asArray(boxTeam?.statistics).map(asObject).map((stat) => ({
      name: text(stat.name),
      label: text(stat.label),
      displayValue: text(stat.displayValue),
    }));

    const boxPlayer = boxscorePlayers.find((bp) => text(asObject(bp.team).id) === teamId);
    const categories: NFLBoxScoreCategory[] = asArray(boxPlayer?.statistics).map(asObject).flatMap((cat) => {
      const catName = text(cat.name);
      const labels = asArray(cat.labels).map((v) => text(v));
      const totals = asArray(cat.totals).map((v) => text(v));
      const athletes: NFLBoxScoreAthlete[] = asArray(cat.athletes).map(asObject).map((ath) => {
        const athleteObj = asObject(ath.athlete);
        return {
          id: text(athleteObj.id),
          name: text(athleteObj.displayName, text(athleteObj.name)),
          shortName: text(athleteObj.shortName),
          jersey: text(athleteObj.jersey),
          headshot: text(asObject(athleteObj.headshot).href),
          position: text(asObject(athleteObj.position).abbreviation),
          stats: asArray(ath.stats).map((v) => text(v)),
        };
      });
      if (athletes.length === 0 && (!totals || totals.length === 0)) return [];
      const title = cleanCategoryTitle(catName, text(cat.text));
      return [{
        name: catName,
        title,
        labels,
        athletes,
        totals: totals.length ? totals : undefined,
      }];
    });

    return {
      id: teamId,
      name,
      abbreviation,
      score,
      logo,
      color: color ? `#${color}` : undefined,
      alternateColor: alternateColor ? `#${alternateColor}` : undefined,
      record,
      homeAway,
      linescores,
      categories,
      teamStats,
    };
  });

  const awayTeam = parsedTeams.find((t) => t.homeAway === 'away');
  const homeTeam = parsedTeams.find((t) => t.homeAway === 'home');
  const teams: [NFLBoxScoreTeam, NFLBoxScoreTeam] | [] = (awayTeam && homeTeam)
    ? [awayTeam, homeTeam]
    : (parsedTeams.length === 2 ? [parsedTeams[0], parsedTeams[1]] : []);

  return {
    eventId,
    status,
    state,
    clock,
    period,
    isLive,
    isFinal,
    venue,
    teams,
  };
}

export type PrimetimeType = 'TNF' | 'SNF' | 'MNF';

export function getPrimetimeLabel(game: Game): PrimetimeType | null {
  if (game.sport !== 'Football' && game.league !== 'NFL') return null;
  if (!game.date) return null;
  const d = new Date(game.date);
  if (Number.isNaN(d.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);

  if (weekday === 'Thu' && hour >= 18) return 'TNF';
  if (weekday === 'Sun' && hour >= 19) return 'SNF';
  if (weekday === 'Mon' && hour >= 18) return 'MNF';
  return null;
}

export function isPrimetimeGame(game: Game): boolean {
  return getPrimetimeLabel(game) !== null;
}

export function getPrimetimeFullTitle(label: PrimetimeType): string {
  switch (label) {
    case 'TNF': return 'Thursday Night Football';
    case 'SNF': return 'Sunday Night Football';
    case 'MNF': return 'Monday Night Football';
  }
}

export function findAutomaticNFLGame(games: Game[], preferId?: string | null): Game | null {
  const nflGames = games.filter((g) => g.sport === 'Football');
  if (nflGames.length === 0) return null;

  // 1. Primetime game that is LIVE (TNF, SNF, MNF) takes top priority
  const livePrimetime = nflGames.find((g) => g.status === 'LIVE' && isPrimetimeGame(g));
  if (livePrimetime) return livePrimetime;

  // 2. Any NFL game that is LIVE
  const anyLive = nflGames.find((g) => g.status === 'LIVE');
  if (anyLive) return anyLive;

  // 3. Preferred/previous game if specified and found
  if (preferId) {
    const preferred = nflGames.find((g) => g.id === preferId);
    if (preferred) return preferred;
  }

  // 4. Primetime game that is UPCOMING
  const upcomingPrimetime = nflGames.find((g) => g.status === 'UPCOMING' && isPrimetimeGame(g));
  if (upcomingPrimetime) return upcomingPrimetime;

  // 5. Primetime game in the slate (even if completed)
  const anyPrimetime = [...nflGames].reverse().find((g) => isPrimetimeGame(g));
  if (anyPrimetime) return anyPrimetime;

  // 6. Default fallback to first game
  return nflGames[0] ?? null;
}
