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

export async function fetchScoreboards(signal?: AbortSignal, nflWeek?: number): Promise<ScoreboardResult> {
  const results = await Promise.allSettled(scoreFeeds.map(async (feed) => {
    const weekQuery = feed.league === 'NFL' && nflWeek ? `?week=${nflWeek}&seasontype=2` : '';
    const response = await fetch(`${apiBase}/${feed.path}/scoreboard${weekQuery}`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`${feed.league} returned HTTP ${response.status}`);
    const payload: unknown = await response.json();
    const scoreboard = asObject(payload);
    const events = asArray(scoreboard.events);
    return {
      games: events.map((event) => mapEvent(event, feed)).filter((game): game is Game => game !== null),
      nflWeek: feed.league === 'NFL' ? Number(asObject(scoreboard.week).number) || null : null,
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

export async function fetchNFLFavoritePlays(
  games: Game[],
  favorites: FavoriteTarget[],
  signal?: AbortSignal,
): Promise<NFLFavoritePlay[]> {
  const nflFavorites = favorites.filter((favorite) => favorite.feedPath === 'football/nfl'
    && (favorite.type === 'team' || (favorite.teamId && ['QB', 'RB', 'WR', 'TE'].includes(favorite.position ?? ''))));
  const favoriteTeamId = (favorite: FavoriteTarget) => favorite.type === 'team' ? favorite.id : favorite.teamId ?? '';
  const relevantGames = games.filter((game) => game.sport === 'Football'
    && game.status === 'LIVE'
    && nflFavorites.some((favorite) => favoriteTeamId(favorite) === game.home.id || favoriteTeamId(favorite) === game.away.id));
  const results = await Promise.allSettled(relevantGames.map(async (game) => {
    const response = await fetch(`${apiBase}/${game.feedPath}/summary?event=${encodeURIComponent(game.eventId)}`, { signal });
    if (!response.ok) throw new Error(`Live play summary returned HTTP ${response.status}`);
    const summary = asObject(await response.json());
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
      const timestamp = Number.isFinite(happenedAt) ? new Date(happenedAt).toISOString() : new Date().toISOString();
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
  const recentEventsByTeam = new Map(teams.map((team) => {
    const recentGroup = recentGroups.find((entry) => text(asObject(entry.team).id, text(entry.team)) === team.id);
    return [team.id, asArray(recentGroup?.events).map(asObject)] as const;
  }));
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
    const skillPlayers = (rostersByTeam.get(team.id) ?? []).flatMap((rosterPlayer) => {
      const playerRecentGames = recentGames.map((recentGame) => ({
        ...recentGame,
        stats: readNFLPlayerGameStats(summariesByGame.get(recentGame.gameId), team.id, rosterPlayer.id),
      }));
      const usageGames = playerRecentGames.filter((recentGame) => hasFantasyRelevantUsage(recentGame.stats));
      if (usageGames.length === 0) return [];
      const usage = (key: NFLPlayerStatKey) => usageGames.reduce((total, recentGame) => total + (recentGame.stats[key] ?? 0), 0);
      return [{
        ...rosterPlayer,
        gamesWithUsage: usageGames.length,
        passingAttempts: usage('attempts'),
        targets: usage('targets'),
        receptions: usage('receptions'),
        carries: usage('carries'),
        recentGames: playerRecentGames,
      }];
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
const nflSkillRosters = new Map<string, Promise<NFLRosterSkillPlayer[]>>();

function fetchNFLActiveSkillRoster(feedPath: string, teamId: string, season: number): Promise<NFLRosterSkillPlayer[]> {
  const cacheKey = `${feedPath}:${teamId}:${season}`;
  const cached = nflSkillRosters.get(cacheKey);
  if (cached) return cached;
  const request = fetch(`${apiBase}/${feedPath}/teams/${teamId}/roster?season=${season}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Team roster returned HTTP ${response.status}`);
      const payload = asObject(await response.json());
      const offense = asArray(payload.athletes).map(asObject).find((group) => text(group.position).toLowerCase() === 'offense');
      return asArray(offense?.items).map(asObject).flatMap((player) => {
        const position = text(asObject(player.position).abbreviation).toUpperCase();
        const statusType = text(asObject(player.status).type).toLowerCase();
        if (!nflSkillPositions.has(position) || (statusType && statusType !== 'active')) return [];
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
  nflSkillRosters.set(cacheKey, request);
  void request.catch(() => nflSkillRosters.delete(cacheKey));
  return request;
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
