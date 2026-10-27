import OfflineImage from './OfflineImage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSwipeBack } from './useSwipeBack';
import { Activity, ChevronLeft, ChevronRight, MapPin, Star, Tv } from 'lucide-react';
import type {
  FavoriteTarget,
  Game,
  NFLBoxScoreAthlete,
  NFLBoxScoreData,
  NFLBoxScoreTeam,
  NFLPlayerSeasonBoxScore,
  NFLTeamSeasonAverages,
  NFLSkillPlayer,
  Team,
} from './services/sportsData';
import {
  averageNFLPlayerSeasonCategory,
  fetchNFLBoxScore,
  fetchNFLGameDetails,
  fetchNFLPlayerSeasonBoxScore,
  fetchNFLTeamSeasonAverages,
  findFeaturedNFLGame,
  getPrimetimeFullTitle,
  getPrimetimeLabel,
  isPrimetimeGame,
} from './services/sportsData';
import { getInterfaceScale } from './uiScale';
import { usePublicDataRevision } from './usePublicDataRevision';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';
import { readRenderSnapshot, saveRenderSnapshot, teamSnapshotKey, subscribeRenderSnapshots } from './services/renderSnapshots';
import { nflFieldPosition, type NFLLastPlay } from './services/nflSituation.ts';
import { ScoreTicker } from './ScoreTicker.tsx';
import { fetchTeamComparisonRanks, teamComparisonMetrics } from './services/teamComparisonRanks.ts';
import type { TeamComparisonRank, TeamComparisonRanks } from './services/teamComparisonRanks.ts';

type TheWireProps = {
  games: Game[];
  /** Shown only while no games are available: loading placeholders or a retryable error instead of an empty board. */
  scoreboardStatus?: 'loading' | 'ready' | 'error';
  onRetryScoreboard?: () => void;
  query: string;
  favorites: FavoriteTarget[];
  featuredFavoriteTeamId: string | null;
  onToggleFavorite: (favorite: FavoriteTarget) => void;
  initialGameId?: string | null;
  /** Opens this game's stats directly instead of the game board (e.g. notification links). */
  openGameId?: string | null;
  onSelectGame?: (gameId: string) => void;
  onOpenStatHub?: (game: Game) => void;
  onOpenPlayer: (player: NFLSkillPlayer, team: Team) => void;
  /** Fixed current time in ms (tests); otherwise the board checks the clock every minute. */
  now?: number;
};

function formatGameTime(game: Game) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(game.date));
}

function kickoffTime(game: Game) {
  const time = Date.parse(game.date);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function compareKickoff(first: Game, second: Game) {
  const a = kickoffTime(first);
  const b = kickoffTime(second);
  if (a !== b) return a < b ? -1 : 1;
  return first.id.localeCompare(second.id);
}

type SlotLabel = { tag: string; tagClass: string; title: string; country?: string };
type GameSlot = { key: string; time: string; label: SlotLabel | null; games: Game[] };
type GameDay = { key: string; title: string; slots: GameSlot[] };

function UnionJack() {
  return (
    <>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="2" />
      <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
    </>
  );
}

const flagArt: Record<string, { width: number; height: number; art: React.ReactNode }> = {
  england: { width: 30, height: 18, art: <><rect width="30" height="18" fill="#fff" /><path d="M15,0 V18 M0,9 H30" stroke="#CE1124" strokeWidth="4" /></> },
  'united kingdom': { width: 60, height: 30, art: <UnionJack /> },
  germany: { width: 30, height: 18, art: <><rect width="30" height="6" fill="#000" /><rect y="6" width="30" height="6" fill="#DD0000" /><rect y="12" width="30" height="6" fill="#FFCE00" /></> },
  mexico: { width: 28, height: 16, art: <><rect width="28" height="16" fill="#fff" /><rect width="9.33" height="16" fill="#006847" /><rect x="18.67" width="9.33" height="16" fill="#CE1126" /><circle cx="14" cy="8" r="2.4" fill="#8C5A2B" /></> },
  brazil: { width: 30, height: 21, art: <><rect width="30" height="21" fill="#009C3B" /><path d="M15,2.5 L27.5,10.5 L15,18.5 L2.5,10.5 Z" fill="#FFDF00" /><circle cx="15" cy="10.5" r="4.2" fill="#002776" /></> },
  ireland: { width: 30, height: 15, art: <><rect width="10" height="15" fill="#169B62" /><rect x="10" width="10" height="15" fill="#fff" /><rect x="20" width="10" height="15" fill="#FF883E" /></> },
  spain: { width: 30, height: 20, art: <><rect width="30" height="20" fill="#AA151B" /><rect y="5" width="30" height="10" fill="#F1BF00" /></> },
  france: { width: 30, height: 20, art: <><rect width="10" height="20" fill="#0055A4" /><rect x="10" width="10" height="20" fill="#fff" /><rect x="20" width="10" height="20" fill="#EF4135" /></> },
  australia: { width: 60, height: 30, art: <><rect width="60" height="30" fill="#012169" /><svg width="30" height="15" viewBox="0 0 60 30"><UnionJack /></svg><circle cx="15" cy="23" r="3" fill="#fff" /><circle cx="45" cy="6" r="1.6" fill="#fff" /><circle cx="39" cy="14" r="1.6" fill="#fff" /><circle cx="51" cy="12" r="1.6" fill="#fff" /><circle cx="45" cy="25" r="1.8" fill="#fff" /></> },
  canada: { width: 30, height: 15, art: <><rect width="30" height="15" fill="#fff" /><rect width="7.5" height="15" fill="#D80621" /><rect x="22.5" width="7.5" height="15" fill="#D80621" /><path d="M15,3 L17.5,7.5 L15,12 L12.5,7.5 Z" fill="#D80621" /></> },
};
const flagAliases: Record<string, string> = { uk: 'united kingdom', 'great britain': 'united kingdom', scotland: 'united kingdom', wales: 'united kingdom' };

function CountryFlag({ country }: { country: string }) {
  const normalized = country.trim().toLowerCase();
  const flag = flagArt[flagAliases[normalized] ?? normalized];
  if (!flag) return <span className="wire-flag wire-flag-generic" aria-hidden="true">🌍</span>;
  return (
    <svg className="wire-flag" viewBox={`0 0 ${flag.width} ${flag.height}`} style={{ aspectRatio: `${flag.width} / ${flag.height}` }} aria-hidden="true" focusable="false">
      {flag.art}
    </svg>
  );
}

function internationalVenue(game: Game): { country: string; city?: string } | null {
  const country = game.venueCountry?.trim();
  if (!country || /^(usa|us|united states( of america)?)$/i.test(country)) return null;
  return { country, city: game.venueCity };
}

function slotLabel(game: Game): SlotLabel | null {
  const international = internationalVenue(game);
  if (international) {
    return { tag: 'INTL', tagClass: 'tag-intl', title: `International Series · ${international.city ?? international.country}`, country: international.country };
  }
  const primetime = getPrimetimeLabel(game);
  return primetime ? { tag: primetime, tagClass: `tag-${primetime.toLowerCase()}`, title: getPrimetimeFullTitle(primetime) } : null;
}

const easternParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

function easternDay(time: number) {
  const parts = Object.fromEntries(easternParts.formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, hour: Number(parts.hour) };
}

/** That Monday's MNF game(s), featured from 6:00 AM Monday until 2:00 AM Tuesday ET. */
function spotlightMnfGames(games: Game[], now: number): Game[] {
  // Shifting back two hours turns the window into "Monday, 4 AM or later" on a single ET date.
  const shifted = easternDay(now - 2 * 60 * 60 * 1000);
  if (shifted.weekday !== 'Mon' || shifted.hour < 4) return [];
  return games.filter((game) => (
    getPrimetimeLabel(game) === 'MNF' && Number.isFinite(kickoffTime(game)) && easternDay(kickoffTime(game)).date === shifted.date
  ));
}

function groupGamesByDay(games: Game[]): GameDay[] {
  const days: GameDay[] = [];
  for (const game of games) {
    const known = Number.isFinite(kickoffTime(game));
    const dayTitle = known
      ? new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(game.date))
      : 'Kickoff TBD';
    let day = days[days.length - 1];
    if (day?.key !== dayTitle) {
      day = { key: dayTitle, title: dayTitle, slots: [] };
      days.push(day);
    }
    const label = known ? slotLabel(game) : null;
    const time = known ? formatGameTime(game) : '';
    const slotKey = `${time}:${label?.title ?? ''}`;
    const slot = day.slots[day.slots.length - 1];
    if (slot?.key === slotKey) slot.games.push(game);
    else day.slots.push({ key: slotKey, time, label, games: [game] });
  }
  return days;
}

function parseStatNumber(val: string): number | null {
  if (!val || val === '--') return null;
  if (val.includes('-')) {
    const parts = val.split('-');
    const first = Number.parseFloat(parts[0]);
    return Number.isFinite(first) ? first : null;
  }
  if (val.includes('/')) {
    const parts = val.split('/');
    const first = Number.parseFloat(parts[0]);
    return Number.isFinite(first) ? first : null;
  }
  if (val.includes(':')) {
    const [min, sec] = val.split(':').map(Number);
    return Number.isFinite(min) ? min * 60 + (sec || 0) : null;
  }
  const clean = Number.parseFloat(val.replace(/,/g, ''));
  return Number.isFinite(clean) ? clean : null;
}

function parseHex(hex?: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  let c = hex.trim().replace(/^#/, '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  if (c.length !== 6) return null;
  const num = Number.parseInt(c, 16);
  if (Number.isNaN(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHsl(r: number, g: number, b: number) {
  const normR = r / 255;
  const normG = g / 255;
  const normB = b / 255;
  const max = Math.max(normR, normG, normB);
  const min = Math.min(normR, normG, normB);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case normR: h = (normG - normB) / d + (normG < normB ? 6 : 0); break;
      case normG: h = (normB - normR) / d + 2; break;
      case normB: h = (normR - normG) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function isWhiteOrNearWhite(hex?: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  return rgb.r > 220 && rgb.g > 220 && rgb.b > 220;
}

function areColorsSimilar(color1?: string, color2?: string): boolean {
  const rgb1 = parseHex(color1);
  const rgb2 = parseHex(color2);
  if (!rgb1 || !rgb2) return false;

  const dist = Math.hypot(rgb1.r - rgb2.r, rgb1.g - rgb2.g, rgb1.b - rgb2.b);
  if (dist < 75) return true;

  const hsl1 = rgbToHsl(rgb1.r, rgb1.g, rgb1.b);
  const hsl2 = rgbToHsl(rgb2.r, rgb2.g, rgb2.b);

  if (hsl1.l < 0.22 && hsl2.l < 0.22) return true;

  if (hsl1.s > 0.15 && hsl2.s > 0.15 && hsl1.l > 0.08 && hsl2.l > 0.08) {
    let diff = Math.abs(hsl1.h - hsl2.h);
    if (diff > 180) diff = 360 - diff;
    if (diff <= 40) return true;
    if ((hsl1.h >= 175 && hsl1.h <= 260) && (hsl2.h >= 175 && hsl2.h <= 260)) return true;
    const isRed1 = hsl1.h >= 340 || hsl1.h <= 25;
    const isRed2 = hsl2.h >= 340 || hsl2.h <= 25;
    if (isRed1 && isRed2) return true;
    if ((hsl1.h >= 75 && hsl1.h <= 165) && (hsl2.h >= 75 && hsl2.h <= 165)) return true;
  }
  return false;
}

function LatestPlay({ play, game }: { play: NFLLastPlay; game: Game }) {
  const team = play.teamId === game.away.id ? game.away : play.teamId === game.home.id ? game.home : null;
  const text = play.text.replace(/^(\([^)]*\)\s*)+/, '').replace(/([.)])(?=[A-Z]{2,})/g, '$1 ');
  const scoring = play.scoreValue > 0 || /touchdown/i.test(play.type ?? '');
  const meta = [play.type, play.yards !== null && play.yards !== 0 && !/kickoff|punt|timeout|end /i.test(play.type ?? '') ? `${play.yards > 0 ? '+' : ''}${play.yards} yds` : null].filter(Boolean).join(' \u00b7 ');
  return (
    <section className={`wire-latest-play${scoring ? ' is-scoring' : ''}`} aria-label="Latest play" aria-live="polite">
      <div className="wire-latest-play-head">
        <span className="wire-latest-play-label"><i aria-hidden="true" />Latest play</span>
        {meta && <span className="wire-latest-play-type">{meta}</span>}
      </div>
      <div className="wire-latest-play-body" key={play.id ?? play.text}>
        {team && (
          <span className="team-mark wire-latest-play-team" style={{ '--team-color': team.color } as React.CSSProperties} title={team.name}>
            {team.logo ? <OfflineImage src={team.logo} alt="" /> : team.abbr.slice(0, 2)}
          </span>
        )}
        <p>{text}</p>
      </div>
      {play.drive && <small className="wire-latest-play-drive">{team ? `${team.abbr} drive` : 'Drive'}: {play.drive}</small>}
    </section>
  );
}

export default function TheWire({ games, scoreboardStatus = 'ready', onRetryScoreboard, query, favorites, featuredFavoriteTeamId, onToggleFavorite, initialGameId, openGameId, onSelectGame, onOpenStatHub, onOpenPlayer, now }: TheWireProps) {
  const nflGames = useMemo(() => games.filter((g) => g.sport === 'Football').sort(compareKickoff), [games]);
  const userSelectedRef = useRef(false);
  const openRequest = openGameId && nflGames.some((g) => g.id === openGameId) ? openGameId : null;

  // Auto-select: prioritize live primetime games (TNF, SNF, MNF), then any live game
  const initialAutoGame = findFeaturedNFLGame(nflGames, featuredFavoriteTeamId, initialGameId);

  const [selectedGameId, setSelectedGameId] = useState<string>(
    openRequest ?? (initialGameId && nflGames.some((g) => g.id === initialGameId) ? initialGameId : initialAutoGame?.id ?? nflGames[0]?.id ?? '')
  );
  const [detailOpen, setDetailOpen] = useState(!!openRequest);
  const boardRef = useRef<HTMLDivElement>(null);
  const returnToGameRef = useRef<string | null>(null);
  const [selectedTeamSide, setSelectedTeamSide] = useState<'away' | 'home'>('away');
  const [subTab, setSubTab] = useState<'boxscore' | 'teamStats'>('boxscore');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [playerStatMode, setPlayerStatMode] = useState<'total' | 'average'>('total');
  const [loadedBoxScore, setBoxScore] = useState<NFLBoxScoreData | null>(null);
  const [loadedPlayerAverages, setPlayerAverages] = useState<{ gameId: string; data: NFLPlayerSeasonBoxScore; players: NFLSkillPlayer[] } | null>(null);
  const [playerAveragesLoading, setPlayerAveragesLoading] = useState(false);
  const [playerAveragesFailed, setPlayerAveragesFailed] = useState(false);
  const [playerAveragesRetry, setPlayerAveragesRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [foregroundRevision, setForegroundRevision] = useState(0);
  useEffect(() => subscribeForegroundRefresh(() => setForegroundRevision((value) => value + 1)), []);
  const [failed, setFailed] = useState(false);
  const [loadedSeasonAverages, setSeasonAverages] = useState<{ gameId: string; teams: NFLTeamSeasonAverages[] } | null>(null);
  const [averagesLoading, setAveragesLoading] = useState(false);
  const [averagesFailed, setAveragesFailed] = useState(false);
  const [averagesRetry, setAveragesRetry] = useState(0);
  const [loadedRanks, setLoadedRanks] = useState<TeamComparisonRanks | null>(null);
  const [ranksLoading, setRanksLoading] = useState(false);
  const [ranksError, setRanksError] = useState('');
  const [ranksRetry, setRanksRetry] = useState(0);
  const savedRevision = usePublicDataRevision('sports');

  // Wheel drag ref
  const wheelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ pointerId: null as number | null, startX: 0, startScrollLeft: 0, moved: false });

  // Select game helper
  const selectGame = (gameId: string) => {
    userSelectedRef.current = true;
    setSelectedGameId(gameId);
    onSelectGame?.(gameId);
  };

  const openGame = (gameId: string) => {
    selectGame(gameId);
    setDetailOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeGame = () => {
    returnToGameRef.current = selectedGameId;
    setDetailOpen(false);
  };
  const detailRef = useSwipeBack<HTMLDivElement>(closeGame, detailOpen);

  useEffect(() => {
    if (!openRequest) return;
    userSelectedRef.current = true;
    setSelectedGameId(openRequest);
    setDetailOpen(true);
  }, [openRequest]);

  // Return the reader to the card they opened when they come back to the board
  useEffect(() => {
    const gameId = returnToGameRef.current;
    if (detailOpen || !gameId) return;
    returnToGameRef.current = null;
    boardRef.current?.querySelector(`[data-game-id="${CSS.escape(gameId)}"]`)?.scrollIntoView({ block: 'center' });
  }, [detailOpen]);

  // When initialGameId prop changes (e.g. user clicked on a specific game card)
  useEffect(() => {
    if (detailOpen) return;
    if (initialGameId && nflGames.some((g) => g.id === initialGameId)) {
      userSelectedRef.current = true;
      setSelectedGameId(initialGameId);
    }
  }, [initialGameId, nflGames, detailOpen]);

  // Update selectedGameId if list changes or live primetime game is active
  useEffect(() => {
    if (nflGames.length === 0) return;

    if (!userSelectedRef.current) {
      const bestGame = findFeaturedNFLGame(nflGames, featuredFavoriteTeamId);
      if (bestGame && (bestGame.status === 'LIVE' || !nflGames.some((g) => g.id === selectedGameId))) {
        setSelectedGameId(bestGame.id);
        return;
      }
    }

    if (!nflGames.some((g) => g.id === selectedGameId)) {
      const fallback = findFeaturedNFLGame(nflGames, featuredFavoriteTeamId) ?? nflGames[0];
      setSelectedGameId(fallback.id);
    }
  }, [games, nflGames, selectedGameId, featuredFavoriteTeamId]);

  const selectedGame = nflGames.find((g) => g.id === selectedGameId) ?? nflGames[0];
  const selectedPrimetime = selectedGame ? getPrimetimeLabel(selectedGame) : null;
  const selectedIntl = selectedGame ? internationalVenue(selectedGame) : null;
  const livePrimetimeGame = nflGames.find((g) => g.status === 'LIVE' && isPrimetimeGame(g))
    ?? nflGames.find((g) => g.status === 'LIVE');
  const searchQuery = query.trim().toLowerCase();

  const matchesSearch = (g: Game) => (
      g.away.name.toLowerCase().includes(searchQuery)
      || g.away.abbr.toLowerCase().includes(searchQuery)
      || g.home.name.toLowerCase().includes(searchQuery)
      || g.home.abbr.toLowerCase().includes(searchQuery)
  );
  const matchingGame = searchQuery ? nflGames.find(matchesSearch) : undefined;
  const matchingGameId = matchingGame?.id;
  const [clockNow, setClockNow] = useState(() => now ?? Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [now]);
  const boardNow = now ?? clockNow;
  const { spotlightGames, boardDays } = useMemo(() => {
    const visible = searchQuery ? nflGames.filter(matchesSearch) : nflGames;
    const spotlight = spotlightMnfGames(visible, boardNow);
    return {
      spotlightGames: spotlight,
      boardDays: groupGamesByDay(visible.filter((game) => !spotlight.includes(game))),
    };
  }, [nflGames, searchQuery, boardNow]);
  useEffect(() => {
    if (!matchingGameId || !detailOpen) return;
    userSelectedRef.current = true;
    setSelectedGameId(matchingGameId);
    onSelectGame?.(matchingGameId);
  }, [searchQuery, matchingGameId, onSelectGame, detailOpen]);
  useEffect(() => {
    wheelRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedGameId, detailOpen]);

  const isLive = selectedGame?.status === 'LIVE';
  const eventId = selectedGame?.eventId;
  const feedPath = selectedGame?.feedPath;
  const seasonYear = selectedGame?.seasonYear;
  const isUpcoming = selectedGame?.status === 'UPCOMING';
  const categoryFilters = ['All', 'Offense', 'Defense', 'Special Teams'];
  const activeCategoryFilter = isUpcoming ? 'All' : categoryFilter;
  const awayTeamId = selectedGame?.away.id;
  const homeTeamId = selectedGame?.home.id;
  const activeTeamId = selectedTeamSide === 'away' ? awayTeamId : homeTeamId;
  const activeTeamName = selectedTeamSide === 'away' ? selectedGame?.away.name : selectedGame?.home.name;
  const [boxSnapshotRevision, setBoxSnapshotRevision] = useState(0);
  useEffect(() => {
    if (!eventId || !feedPath) return;
    const saved = readRenderSnapshot('box', `${feedPath}:${eventId}`);
    if (saved) setBoxScore(saved);
    let previous = JSON.stringify(saved);
    return subscribeRenderSnapshots(() => {
      const snapshot = readRenderSnapshot('box', `${feedPath}:${eventId}`);
      const next = JSON.stringify(snapshot);
      if (next !== previous) {
        previous = next;
        if (snapshot) setBoxScore(snapshot);
        setBoxSnapshotRevision((value) => value + 1);
      }
    }, { kind: 'box', key: `${feedPath}:${eventId}` });
  }, [eventId, feedPath]);
  const savedDisplay = useMemo(() => {
    if (!eventId || !feedPath || !seasonYear || !activeTeamId || !awayTeamId || !homeTeamId) return null;
    const players = readRenderSnapshot('players', teamSnapshotKey(feedPath, activeTeamId, seasonYear));
    const teams = [awayTeamId, homeTeamId].flatMap((id) => {
      const team = readRenderSnapshot('team', teamSnapshotKey(feedPath, id, seasonYear));
      return team ? [team] : [];
    });
    return {
      box: readRenderSnapshot('box', `${feedPath}:${eventId}`),
      players: players ? { gameId: eventId, ...players } : null,
      teams: teams.length === 2 ? { gameId: eventId, teams } : null,
    };
  }, [eventId, feedPath, seasonYear, activeTeamId, awayTeamId, homeTeamId, savedRevision, boxSnapshotRevision, detailOpen]);
  const boxScore = loadedBoxScore?.eventId === eventId ? loadedBoxScore : savedDisplay?.box ?? null;
  const playerAverages = loadedPlayerAverages && loadedPlayerAverages.gameId === eventId && loadedPlayerAverages.data.teamId === activeTeamId
    ? loadedPlayerAverages : savedDisplay?.players ?? null;
  const seasonAverages = loadedSeasonAverages?.gameId === eventId ? loadedSeasonAverages : savedDisplay?.teams ?? null;
  const seasonRanks = loadedRanks?.season === seasonYear ? loadedRanks
    : feedPath && seasonYear ? readRenderSnapshot('teamRanks', `${feedPath}:${seasonYear}`) : null;

  useEffect(() => {
    if (!detailOpen || !isUpcoming || !feedPath || !seasonYear) return;
    let active = true;
    setRanksLoading(true); setRanksError('');
    void fetchTeamComparisonRanks(feedPath, seasonYear).then((data) => {
      if (!active) return;
      saveRenderSnapshot('teamRanks', `${feedPath}:${seasonYear}`, data);
      setLoadedRanks(data); setRanksLoading(false);
      if (data.teams.some((team) => teamComparisonMetrics.some(({ key }) => team.ranks[key] === null))) {
        setRanksError('Some NFL ranks are unavailable because league statistics are incomplete. Retry to check for updated data.');
      }
    }).catch((cause: unknown) => {
      if (!active) return;
      console.error('Could not load NFL team comparison ranks', cause);
      setRanksError('Could not refresh NFL ranks. Saved ranks remain visible when available.');
      setRanksLoading(false);
    });
    return () => { active = false; };
  }, [detailOpen, isUpcoming, feedPath, seasonYear, ranksRetry]);

  useEffect(() => {
    setAveragesFailed(false);
    if (!detailOpen || !isUpcoming || !eventId || !feedPath || !seasonYear || !awayTeamId || !homeTeamId) {
      setAveragesLoading(false);
      return;
    }
    const controller = new AbortController();
    setAveragesLoading(seasonAverages?.gameId !== eventId);
    void Promise.all([awayTeamId, homeTeamId].map((teamId) =>
      fetchNFLTeamSeasonAverages(feedPath, teamId, seasonYear, controller.signal)
    )).then((teams) => {
      if (!controller.signal.aborted) {
        setSeasonAverages({ gameId: eventId, teams });
        setAveragesLoading(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setAveragesFailed(true);
        setAveragesLoading(false);
      }
    });
    return () => controller.abort();
  }, [detailOpen, isUpcoming, eventId, feedPath, seasonYear, awayTeamId, homeTeamId, averagesRetry, savedRevision]);

  // Load box score for the selected game
  useEffect(() => {
    if (!detailOpen || !eventId || !feedPath) {
      setLoading(false);
      return undefined;
    }

    let current = true;
    const controller = new AbortController();

    const loadData = async (isPoll = false) => {
      if (!isPoll) {
        setLoading(!boxScore);
        setFailed(false);
      }
      try {
        const data = await fetchNFLBoxScore(feedPath, eventId, controller.signal);
        if (current) {
          setBoxScore(data);
          setFailed(false);
          setLoading(false);
        }
      } catch {
        if (current && !controller.signal.aborted && !isPoll) {
          setFailed(true);
          setLoading(false);
        }
      }
    };

    void loadData();

    // Poll live games every 15s
    let intervalId: number | undefined;
    if (isLive) {
      intervalId = window.setInterval(() => {
        void loadData(true);
      }, 15_000);
    }

    return () => {
      current = false;
      controller.abort();
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [detailOpen, eventId, feedPath, isLive, savedRevision, foregroundRevision]);

  useEffect(() => {
    setPlayerAveragesFailed(false);
    if (!detailOpen || !isUpcoming || subTab !== 'boxscore' || !eventId || !feedPath || !seasonYear || !activeTeamId || !activeTeamName) {
      setPlayerAveragesLoading(false);
      return;
    }
    const controller = new AbortController();
    setPlayerAveragesLoading(playerAverages?.gameId !== eventId || playerAverages.data.teamId !== activeTeamId);
    void fetchNFLGameDetails(feedPath, eventId, seasonYear, [{ id: activeTeamId, name: activeTeamName }], controller.signal)
      .then((details) => {
        controller.signal.throwIfAborted();
        const players = details.teamForms.find((team) => team.teamId === activeTeamId)?.skillPlayers ?? [];
        if (!players.length) throw new Error('Player roster is unavailable; retaining any saved totals.');
        return fetchNFLPlayerSeasonBoxScore(feedPath, activeTeamId, seasonYear, players, controller.signal)
          .then((data) => ({ data, players }));
      }).then(({ data, players }) => {
      if (!controller.signal.aborted) {
        if (playerAverages && (data.failedPlayers > 0 || !data.categories.length)) {
          throw new Error('Player totals refresh is incomplete; retaining saved totals.');
        }
        setPlayerAverages({ gameId: eventId, data, players });
        setPlayerAveragesLoading(false);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error('Could not refresh player season totals', error);
        setPlayerAveragesFailed(true);
        setPlayerAveragesLoading(false);
      }
    });
    return () => controller.abort();
  }, [detailOpen, isUpcoming, subTab, eventId, feedPath, seasonYear, activeTeamId, activeTeamName, playerAveragesRetry, savedRevision]);

  // Wheel horizontal drag handlers
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 6) {
      if (!drag.moved) {
        drag.moved = true;
        event.currentTarget.classList.add('is-dragging');
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
      const strip = event.currentTarget;
      const scale = getInterfaceScale(strip);
      strip.scrollLeft = drag.startScrollLeft - distance / scale;
      event.preventDefault();
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (drag.pointerId !== event.pointerId) return;
    drag.pointerId = null;
    event.currentTarget.classList.remove('is-dragging');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }
    window.setTimeout(() => {
      drag.moved = false;
    }, 50);
  };

  const awayBoxTeam: NFLBoxScoreTeam | undefined = boxScore?.teams.find((team) => team.id === awayTeamId);
  const homeBoxTeam: NFLBoxScoreTeam | undefined = boxScore?.teams.find((team) => team.id === homeTeamId);
  const finalScore = selectedGame?.status === 'FINAL' || boxScore?.isFinal === true;
  const awayScore = awayBoxTeam?.score ?? selectedGame?.away.score;
  const homeScore = homeBoxTeam?.score ?? selectedGame?.home.score;
  const awayLost = finalScore && awayScore !== undefined && homeScore !== undefined && awayScore < homeScore;
  const homeLost = finalScore && awayScore !== undefined && homeScore !== undefined && homeScore < awayScore;
  const activeBoxTeam = selectedTeamSide === 'away' ? awayBoxTeam : homeBoxTeam;
  const activeGameTeam: Team | undefined = selectedGame ? (selectedTeamSide === 'away' ? selectedGame.away : selectedGame.home) : undefined;

  // Periods calculation for linescore
  const periodCount = Math.max(
    4,
    awayBoxTeam?.linescores.length ?? 0,
    homeBoxTeam?.linescores.length ?? 0
  );
  const periods = Array.from({ length: periodCount }, (_, i) => i);

  // Filter categories
  const currentPlayerAverages = playerAverages && playerAverages.gameId === eventId && playerAverages.data.teamId === activeTeamId
    ? playerAverages.data : null;
  const categoriesToDisplay = (isUpcoming ? currentPlayerAverages?.categories ?? [] : activeBoxTeam?.categories ?? []).map((sourceCategory) => {
    const category = isUpcoming && playerStatMode === 'average' ? averageNFLPlayerSeasonCategory(sourceCategory) : sourceCategory;
    if (selectedGame?.status === 'FINAL' && ['passing', 'rushing', 'receiving'].includes(category.name)) {
      const yards = category.labels.indexOf('YDS');
      return yards < 0 ? category : { ...category, athletes: category.athletes.filter((athlete) => String(athlete.stats[yards] ?? '').trim() === '' || Number(athlete.stats[yards]) !== 0) };
    }
    if (!isUpcoming || !['passing', 'rushing', 'receiving'].includes(category.name)) return category;
    const slots = category.name === 'rushing' ? [0, 1, null, 2, 3, 4] : [0, 1, 2, 3, 4, 5];
    return {
      ...category,
      labels: slots.map((index) => index === null ? '' : category.labels[index]),
      athletes: category.athletes.map((athlete) => ({
        ...athlete,
        stats: slots.map((index) => index === null ? '' : athlete.stats[index]),
      })),
    };
  }).filter((cat) => {
    if (!cat.athletes.length) return false;
    if (activeCategoryFilter === 'All') return true;
    if (activeCategoryFilter === 'Offense') return ['passing', 'rushing', 'receiving'].includes(cat.name);
    if (activeCategoryFilter === 'Defense') return ['defensive', 'interceptions', 'fumbles'].includes(cat.name);
    if (activeCategoryFilter === 'Special Teams') return ['kicking', 'punting', 'kickReturns', 'puntReturns'].includes(cat.name);
    return cat.title.toLowerCase().includes(activeCategoryFilter.toLowerCase()) || cat.name.toLowerCase().includes(activeCategoryFilter.toLowerCase());
  });

  // Team comparison colors: if two teams are the same color (e.g. blue), make one of the lines white
  const rawAwayColor = awayBoxTeam?.color || selectedGame?.away.color || '#3b82f6';
  const rawHomeColor = homeBoxTeam?.color || selectedGame?.home.color || '#ef4444';
  let compAwayColor = rawAwayColor;
  let compHomeColor = rawHomeColor;

  if (areColorsSimilar(rawAwayColor, rawHomeColor)) {
    if (isWhiteOrNearWhite(rawAwayColor)) {
      compAwayColor = '#ffffff';
      compHomeColor = rawHomeColor;
    } else {
      compAwayColor = rawAwayColor;
      compHomeColor = '#ffffff';
    }
  }

  // Team comparison rows
  const comparisonStats: Array<{ label: string; awayVal: string; homeVal: string; percentAway?: number; awayRank?: TeamComparisonRank | null; homeRank?: TeamComparisonRank | null }> = [];
  if (isUpcoming) {
    const teams = seasonAverages?.gameId === eventId ? seasonAverages.teams : [];
    const away = teams.find((team) => team.teamId === awayTeamId);
    const home = teams.find((team) => team.teamId === homeTeamId);
    for (const { key, label } of teamComparisonMetrics) {
      const awayValue = away?.[key] ?? null;
      const homeValue = home?.[key] ?? null;
      const percentAway = awayValue !== null && homeValue !== null && awayValue + homeValue > 0
        ? Math.round(awayValue / (awayValue + homeValue) * 100)
        : undefined;
      comparisonStats.push({
        label,
        awayVal: awayValue === null ? 'Unavailable' : awayValue.toFixed(1),
        homeVal: homeValue === null ? 'Unavailable' : homeValue.toFixed(1),
        awayRank: awayValue === null ? null : seasonRanks?.teams.find((team) => team.teamId === awayTeamId)?.ranks[key],
        homeRank: homeValue === null ? null : seasonRanks?.teams.find((team) => team.teamId === homeTeamId)?.ranks[key],
        percentAway,
      });
    }
  } else if (awayBoxTeam && homeBoxTeam) {
    const awayMap = new Map(awayBoxTeam.teamStats.map((s) => [s.name, s]));
    const homeMap = new Map(homeBoxTeam.teamStats.map((s) => [s.name, s]));
    const keys = [
      'firstDowns',
      'firstDownsPassing',
      'firstDownsRushing',
      'firstDownsPenalty',
      'thirdDownEff',
      'fourthDownEff',
      'totalYards',
      'netPassingYards',
      'completionAttempts',
      'yardsPerPass',
      'rushingYards',
      'rushingAttempts',
      'yardsPerRushAttempt',
      'totalOffensivePlays',
      'yardsPerPlay',
      'turnovers',
      'fumblesLost',
      'interceptions',
      'sacksYardsLost',
      'totalPenaltiesYards',
      'redZoneAttempts',
      'possessionTime',
    ];

    for (const key of keys) {
      const awayStat = awayMap.get(key);
      const homeStat = homeMap.get(key);
      if (awayStat || homeStat) {
        const label = awayStat?.label ?? homeStat?.label ?? key;
        const awayVal = awayStat?.displayValue ?? '—';
        const homeVal = homeStat?.displayValue ?? '—';
        const numAway = parseStatNumber(awayVal);
        const numHome = parseStatNumber(homeVal);
        let percentAway: number | undefined;
        if (numAway !== null && numHome !== null && (numAway + numHome) > 0) {
          percentAway = Math.round((numAway / (numAway + numHome)) * 100);
        }
        comparisonStats.push({ label, awayVal, homeVal, percentAway });
      }
    }
  }

  // Helper for player favorites
  const isPlayerFavorite = (athleteId: string) => {
    return favorites.some((fav) => fav.type === 'player' && fav.id === athleteId);
  };

  const togglePlayerFavorite = (athlete: NFLBoxScoreAthlete, team: NFLBoxScoreTeam | Team) => {
    const target: FavoriteTarget = {
      key: `player:${athlete.id}`,
      type: 'player',
      id: athlete.id,
      name: athlete.name,
      shortName: athlete.shortName || athlete.name,
      feedPath: 'football/nfl',
      teamName: team.name,
      teamAbbr: 'abbr' in team ? team.abbr : team.abbreviation,
      teamId: team.id,
      position: athlete.position,
      headshot: athlete.headshot,
    };
    onToggleFavorite(target);
  };

  const isTeamFavorite = (teamId: string) => {
    return favorites.some((fav) => fav.type === 'team' && fav.id === teamId);
  };

  const toggleTeamFavorite = (team: NFLBoxScoreTeam | Team) => {
    const target: FavoriteTarget = {
      key: `team:${team.id}`,
      type: 'team',
      id: team.id,
      name: team.name,
      shortName: 'abbr' in team ? team.abbr : team.abbreviation,
      feedPath: 'football/nfl',
      teamAbbr: 'abbr' in team ? team.abbr : team.abbreviation,
      logo: team.logo,
    };
    onToggleFavorite(target);
  };

  const emptyBoard = scoreboardStatus === 'ready' ? (
    <p className="nfl-empty-note">No NFL games available this week.</p>
  ) : (
    <div className="wire-board-loading" role="status" aria-live="polite">
      <p className="wire-board-loading-note">
        {scoreboardStatus === 'error'
          ? <>Can’t reach live scores right now. Retrying automatically… {onRetryScoreboard && <button type="button" onClick={onRetryScoreboard}>Retry now</button>}</>
          : 'Loading this week’s games…'}
      </p>
      <ul className="wire-board-list" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => <li key={index}><span className="wire-board-card wire-board-skeleton"><i /><i /><i /></span></li>)}
      </ul>
    </div>
  );

  if (!detailOpen) {
    const liveCount = nflGames.filter((g) => g.status === 'LIVE').length;
    const finalCount = nflGames.filter((g) => g.status === 'FINAL').length;
    const upcomingCount = nflGames.length - liveCount - finalCount;
    const renderBoardCard = (game: Game) => {
      const live = game.status === 'LIVE';
      const final = game.status === 'FINAL';
      const upcoming = game.status === 'UPCOMING';
      const intl = internationalVenue(game);
      return (
        <li key={game.id}>
          <button
            type="button"
            data-game-id={game.id}
            className={`wire-board-card${live ? ' is-live' : ''}${final ? ' is-final' : ''}`}
            onClick={() => openGame(game.id)}
          >
            <span className="wire-board-status">
              {live ? (
                <span className="live-pill"><i /> LIVE</span>
              ) : final ? (
                <span className="wire-board-final">FINAL</span>
              ) : (
                <span>{formatGameTime(game)}</span>
              )}
              {live && game.clock && <small>{game.clock}</small>}
            </span>
            <span className="wire-board-teams">
              {[game.away, game.home].map((team, index) => {
                const opponent = index === 0 ? game.home : game.away;
                const lost = final && team.score < opponent.score;
                return (
                  <span className={`wire-board-team${lost ? ' is-loser' : ''}`} key={team.id}>
                    <span className="team-mark wire-board-mark" style={{ '--team-color': team.color } as React.CSSProperties}>
                      {team.logo ? <OfflineImage src={team.logo} alt="" /> : team.abbr.slice(0, 2)}
                    </span>
                    <span className="wire-board-team-name">
                      <b>
                        <span className="wire-board-team-label">{team.name}</span>
                        {isTeamFavorite(team.id) && <span className="wire-board-favorite" role="img" aria-label="Favorite team"><Star size={12} fill="currentColor" aria-hidden="true" /></span>}
                        {live && game.situation?.possessionTeamId === team.id && <span className="possession-football" role="img" aria-label={`${team.name} has possession`}>🏈</span>}
                      </b>
                      <small>{team.abbr}{team.record ? ` · ${team.record}` : ''}</small>
                    </span>
                    <strong className="wire-board-score">{upcoming ? '' : <ScoreTicker value={team.score} gameKey={`${game.id}:${team.id}`} />}</strong>
                  </span>
                );
              })}
            </span>
            <span className="wire-board-footer">
              <span className="wire-board-meta">
                {live ? nflFieldPosition(game.situation) : <><MapPin size={12} aria-hidden="true" /> {game.venue || 'Venue TBD'}{intl ? `, ${intl.city ?? intl.country}` : ''}</>}
              </span>
              <span className="wire-board-open">
                {upcoming ? 'Pregame stats' : live ? 'Live player stats' : 'Box score'} <ChevronRight size={14} aria-hidden="true" />
              </span>
            </span>
          </button>
        </li>
      );
    };
    return (
      <div className="the-wire-container">
        <div className="wire-board" ref={boardRef}>
          <header className="wire-board-header">
            <span className="eyebrow">NFL GAMES · THIS WEEK</span>
            {nflGames.length > 0 && (
              <small className="wire-board-counts">
                {liveCount > 0 && <span className="wire-board-count-live">{liveCount} live</span>}
                {finalCount > 0 && <span>{finalCount} final</span>}
                {upcomingCount > 0 && <span>{upcomingCount} upcoming</span>}
              </small>
            )}
          </header>
          {nflGames.length === 0 ? (
            emptyBoard
          ) : boardDays.length === 0 && spotlightGames.length === 0 ? (
            <p className="nfl-empty-note" role="status">No games matched “{query}”.</p>
          ) : <>
          {spotlightGames.length > 0 && (
            <section className="wire-board-spotlight" aria-labelledby="wire-spotlight-title">
              <h2 className="wire-board-spotlight-title" id="wire-spotlight-title">
                <span className="wire-primetime-tag tag-mnf">MNF</span>
                <span>{spotlightGames.length > 1 ? 'Tonight’s Monday Night Football' : 'Tonight · Monday Night Football'}</span>
                <small>{formatGameTime(spotlightGames[0])}</small>
              </h2>
              <ol className="wire-board-list">
                {spotlightGames.map(renderBoardCard)}
              </ol>
            </section>
          )}
          {boardDays.map((day) => {
            const dayId = `wire-day-${day.key.replace(/[^a-z0-9]+/gi, '-')}`;
            return (
            <section className="wire-board-day" key={day.key} aria-labelledby={dayId}>
              <h2 className="wire-board-day-title" id={dayId}>{day.title}</h2>
              {day.slots.map((slot) => (
              <div className={`wire-board-slot${slot.label ? ` is-${slot.label.tagClass.slice(4)}` : ''}`} key={slot.key}>
                <h3 className="wire-board-slot-title">
                  {slot.label && (
                    <span className={`wire-primetime-tag ${slot.label.tagClass}`}>
                      {slot.label.country && <CountryFlag country={slot.label.country} />}
                      {slot.label.tag}
                    </span>
                  )}
                  {slot.label && <span>{slot.label.title}</span>}
                  {slot.time && <small>{slot.time}</small>}
                </h3>
              <ol className="wire-board-list">
                {slot.games.map(renderBoardCard)}
              </ol>
              </div>
              ))}
            </section>
            );
          })}
          </>}
        </div>
      </div>
    );
  }

  return (
    <div className="the-wire-container" ref={detailRef}>
      <button type="button" className="wire-back-button" onClick={closeGame}>
        <ChevronLeft size={16} aria-hidden="true" /> All games
      </button>
      {/* Game Wheel */}
      <div className="wire-controls">
        {nflGames.length > 0 ? (
          <div className="wire-game-wheel" data-swipe-back-ignore>
            <span className="eyebrow">NFL GAMES · THIS WEEK</span>
            <div
              ref={wheelRef}
              className="wire-wheel-strip"
              role="tablist"
              aria-label="NFL game selector"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
            >
              {nflGames.map((game) => {
                const live = game.status === 'LIVE';
                const selected = game.id === selectedGame?.id;
                const primetime = getPrimetimeLabel(game);
                const intl = internationalVenue(game);
                return (
                  <button
                    key={game.id}
                    role="tab"
                    aria-selected={selected}
                    className={`wire-wheel-card${selected ? ' selected' : ''}${live ? ' is-live' : ''}${primetime ? ` is-primetime is-${primetime.toLowerCase()}` : ''}`}
                    onClick={() => selectGame(game.id)}
                  >
                    <div className="wire-wheel-status">
                      {intl ? (
                        <span className="wire-primetime-tag tag-intl" title={`International Series · ${intl.city ?? intl.country}`}>
                          <CountryFlag country={intl.country} />INTL
                        </span>
                      ) : primetime && (
                        <span className={`wire-primetime-tag tag-${primetime.toLowerCase()}`}>
                          {primetime}
                        </span>
                      )}
                      {live ? (
                        <span className="live-pill"><i /> LIVE</span>
                      ) : game.status === 'FINAL' ? (
                        <span>FINAL</span>
                      ) : (
                        <span>{formatGameTime(game)}</span>
                      )}
                      {live && <small className="wire-wheel-clock">{game.clock}</small>}
                    </div>
                    <div className="wire-wheel-teams">
                      <div className={`wire-wheel-row${game.status === 'FINAL' && game.away.score < game.home.score ? ' is-loser' : ''}`}>
                        <span className="wire-wheel-team-abbr">{game.away.abbr}{live && game.situation?.possessionTeamId === game.away.id && <span className="possession-football" role="img" aria-label={`${game.away.name} has possession`}>🏈</span>}</span>
                        <strong className="wire-wheel-score">{game.status === 'UPCOMING' ? '–' : <ScoreTicker value={game.away.score} gameKey={`${game.id}:away`} />}</strong>
                      </div>
                      <div className={`wire-wheel-row${game.status === 'FINAL' && game.home.score < game.away.score ? ' is-loser' : ''}`}>
                        <span className="wire-wheel-team-abbr">{game.home.abbr}{live && game.situation?.possessionTeamId === game.home.id && <span className="possession-football" role="img" aria-label={`${game.home.name} has possession`}>🏈</span>}</span>
                        <strong className="wire-wheel-score">{game.status === 'UPCOMING' ? '–' : <ScoreTicker value={game.home.score} gameKey={`${game.id}:home`} />}</strong>
                      </div>
                    </div>
                    {live && <small className="wire-wheel-field-position">{nflFieldPosition(game.situation)}</small>}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          emptyBoard
        )}
        {searchQuery && !matchingGame && <p className="nfl-empty-note" role="status">No games matched “{query}”. All games remain available in the wheel.</p>}
      </div>

      {!selectedGame ? (
        <section className="panel empty-games">Select an NFL game above to view its live box score.</section>
      ) : (
        <div className="wire-content">
          {/* Quick-Jump to Live Primetime Game if user is viewing a different game */}
          {livePrimetimeGame && livePrimetimeGame.id !== selectedGame.id && (
            <aside className="wire-primetime-alert-banner">
              <div className="wire-primetime-alert-left">
                <span className="live-pill"><i /> LIVE NOW</span>
                <b>
                  {isPrimetimeGame(livePrimetimeGame)
                    ? getPrimetimeFullTitle(getPrimetimeLabel(livePrimetimeGame)!)
                    : 'Live Game'}
                  : {livePrimetimeGame.away.abbr} {livePrimetimeGame.away.score} @ {livePrimetimeGame.home.abbr} {livePrimetimeGame.home.score} ({livePrimetimeGame.clock})
                </b>
              </div>
              <button
                className="wire-primetime-jump-btn"
                onClick={() => selectGame(livePrimetimeGame.id)}
              >
                Watch Live Game <ChevronRight size={14} />
              </button>
            </aside>
          )}

          {/* Main Game Header Banner */}
          <section className="wire-hero-banner">
            <div className="wire-matchup-grid">
              {/* Away Team */}
              <div className={`wire-matchup-team wire-team-left${awayLost ? ' is-loser' : ''}`}>
                <div className="wire-matchup-mark-wrapper">
                  <span
                    className="team-mark team-mark-large"
                    style={{ '--team-color': selectedGame.away.color } as React.CSSProperties}
                  >
                    {selectedGame.away.logo ? (
                      <OfflineImage src={selectedGame.away.logo} alt="" />
                    ) : (
                      selectedGame.away.abbr.slice(0, 2)
                    )}
                  </span>
                  <button
                    className={`favorite-star-button${isTeamFavorite(selectedGame.away.id) ? ' is-favorite' : ''}`}
                    title={isTeamFavorite(selectedGame.away.id) ? 'Remove favorite' : 'Add favorite'}
                    onClick={() => toggleTeamFavorite(selectedGame.away)}
                  >
                    <Star size={15} fill={isTeamFavorite(selectedGame.away.id) ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <div className="wire-matchup-team-details">
                  <b>{selectedGame.away.abbr}{isLive && selectedGame.situation?.possessionTeamId === selectedGame.away.id && <span className="possession-football" role="img" aria-label={`${selectedGame.away.name} has possession`}>🏈</span>}</b>
                  <h2>{selectedGame.away.name}</h2>
                  <small>{selectedGame.away.record || 'Away'}</small>
                </div>
                <div className="wire-matchup-score">
                  {selectedGame.status === 'UPCOMING' ? '–' : <ScoreTicker value={awayBoxTeam?.score ?? selectedGame.away.score} gameKey={`${selectedGame.id}:away`} />}
                </div>
              </div>

              {/* Center Game State */}
              <div className="wire-matchup-center">
                {selectedIntl ? (
                  <span className="wire-primetime-pill pill-intl">
                    <CountryFlag country={selectedIntl.country} /> International Series · {selectedIntl.city ?? selectedIntl.country}
                  </span>
                ) : selectedPrimetime && (
                  <span className={`wire-primetime-pill pill-${selectedPrimetime.toLowerCase()}`}>
                    <Tv size={12} /> {getPrimetimeFullTitle(selectedPrimetime)}
                  </span>
                )}
                <span className={`wire-status-pill${isLive ? ' is-live' : ''}`}>
                  {isLive && <i />}
                  {isLive
                    ? `${boxScore?.clock || selectedGame.clock || 'Live'}`
                    : selectedGame.status === 'FINAL'
                      ? 'FINAL'
                      : formatGameTime(selectedGame)}
                </span>
                {isLive && (
                  <p className="nfl-field-position">{nflFieldPosition(selectedGame.situation)}</p>
                )}
                {isLive && (
                  <span className="wire-live-notice">
                    <Activity size={12} /> Live box score · polls every 15s
                  </span>
                )}
                {selectedGame.status === 'UPCOMING' && selectedGame.nflMarket?.spread != null && (
                  <div className="wire-spread-badge">
                    <span>Spread</span>
                    <b>{selectedGame.home.abbr} {selectedGame.nflMarket.spread > 0 ? `+${selectedGame.nflMarket.spread}` : selectedGame.nflMarket.spread}</b>
                  </div>
                )}
                <div className="wire-venue-line">
                  <MapPin size={13} />
                  <span>{boxScore?.venue || selectedGame.venue || 'NFL Stadium'}</span>
                </div>
                {onOpenStatHub && (
                  <button
                    className="wire-stathub-link"
                    onClick={() => onOpenStatHub(selectedGame)}
                    title="Open in Stat Hub"
                  >
                    Open in Stat Hub <ChevronRight size={14} />
                  </button>
                )}
              </div>

              {/* Home Team */}
              <div className={`wire-matchup-team wire-team-right${homeLost ? ' is-loser' : ''}`}>
                <div className="wire-matchup-score">
                  {selectedGame.status === 'UPCOMING' ? '–' : <ScoreTicker value={homeBoxTeam?.score ?? selectedGame.home.score} gameKey={`${selectedGame.id}:home`} />}
                </div>
                <div className="wire-matchup-team-details text-right">
                  <b>{selectedGame.home.abbr}{isLive && selectedGame.situation?.possessionTeamId === selectedGame.home.id && <span className="possession-football" role="img" aria-label={`${selectedGame.home.name} has possession`}>🏈</span>}</b>
                  <h2>{selectedGame.home.name}</h2>
                  <small>{selectedGame.home.record || 'Home'}</small>
                </div>
                <div className="wire-matchup-mark-wrapper">
                  <span
                    className="team-mark team-mark-large"
                    style={{ '--team-color': selectedGame.home.color } as React.CSSProperties}
                  >
                    {selectedGame.home.logo ? (
                      <OfflineImage src={selectedGame.home.logo} alt="" />
                    ) : (
                      selectedGame.home.abbr.slice(0, 2)
                    )}
                  </span>
                  <button
                    className={`favorite-star-button${isTeamFavorite(selectedGame.home.id) ? ' is-favorite' : ''}`}
                    title={isTeamFavorite(selectedGame.home.id) ? 'Remove favorite' : 'Add favorite'}
                    onClick={() => toggleTeamFavorite(selectedGame.home)}
                  >
                    <Star size={15} fill={isTeamFavorite(selectedGame.home.id) ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </div>
            </div>

            {isLive && selectedGame.situation?.lastPlay && (
              <LatestPlay play={selectedGame.situation.lastPlay} game={selectedGame} />
            )}

            {/* Quarter-by-Quarter Linescore */}
            {boxScore && boxScore.teams.length === 2 && (boxScore.isLive || boxScore.isFinal) && (
              <div className="wire-linescore-wrapper">
                <table className="wire-linescore-table">
                  <thead>
                    <tr>
                      <th className="wire-col-team">Team</th>
                      {periods.map((p) => (
                        <th key={p} className="wire-col-num">
                          {p >= 4 ? `OT${p > 4 ? p - 3 : ''}` : `Q${p + 1}`}
                        </th>
                      ))}
                      <th className="wire-col-total">T</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={`${selectedTeamSide === 'away' ? 'active-team-row' : ''}${awayLost ? ' is-loser' : ''}`}>
                      <td className="wire-col-team">
                        <div className="wire-team-inline">
                          {awayBoxTeam?.logo && <OfflineImage src={awayBoxTeam.logo} alt="" />}
                          <span>{awayBoxTeam?.abbreviation ?? selectedGame.away.abbr}</span>
                        </div>
                      </td>
                      {periods.map((p) => (
                        <td key={p} className="wire-col-num">
                          {awayBoxTeam?.linescores[p] ?? '–'}
                        </td>
                      ))}
                      <td className="wire-col-total">
                        <strong>{awayBoxTeam?.score ?? selectedGame.away.score}</strong>
                      </td>
                    </tr>
                    <tr className={`${selectedTeamSide === 'home' ? 'active-team-row' : ''}${homeLost ? ' is-loser' : ''}`}>
                      <td className="wire-col-team">
                        <div className="wire-team-inline">
                          {homeBoxTeam?.logo && <OfflineImage src={homeBoxTeam.logo} alt="" />}
                          <span>{homeBoxTeam?.abbreviation ?? selectedGame.home.abbr}</span>
                        </div>
                      </td>
                      {periods.map((p) => (
                        <td key={p} className="wire-col-num">
                          {homeBoxTeam?.linescores[p] ?? '–'}
                        </td>
                      ))}
                      <td className="wire-col-total">
                        <strong>{homeBoxTeam?.score ?? selectedGame.home.score}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* THE HALF-AND-HALF TEAM BAR */}
          <section className="wire-team-toggle-section">
            <div className="wire-team-bar" role="tablist" aria-label="Select team to view box score">
              <button
                role="tab"
                aria-selected={selectedTeamSide === 'away'}
                className={`wire-team-half wire-team-half-away${selectedTeamSide === 'away' ? ' active' : ''}${awayLost ? ' is-loser' : ''}`}
                onClick={() => setSelectedTeamSide('away')}
                style={{
                  '--team-bar-color': awayBoxTeam?.color || selectedGame.away.color || '#3b82f6',
                } as React.CSSProperties}
              >
                <div className="wire-team-half-content">
                  <div className="wire-team-half-left">
                    <span
                      className="team-mark"
                      style={{ '--team-color': awayBoxTeam?.color || selectedGame.away.color } as React.CSSProperties}
                    >
                      {awayBoxTeam?.logo ? (
                        <OfflineImage src={awayBoxTeam.logo} alt="" />
                      ) : (
                        (awayBoxTeam?.abbreviation || selectedGame.away.abbr).slice(0, 2)
                      )}
                    </span>
                    <div className="wire-team-half-copy">
                      <span className="wire-team-half-name">
                        {awayBoxTeam?.name || selectedGame.away.name}
                      </span>
                      <small className="wire-team-half-sub">
                        Away · {awayBoxTeam?.record || selectedGame.away.record}
                      </small>
                    </div>
                  </div>
                  <div className="wire-team-half-right">
                    <strong className="wire-team-half-score">
                      {selectedGame.status === 'UPCOMING' ? '–' : <ScoreTicker value={awayBoxTeam?.score ?? selectedGame.away.score} gameKey={`${selectedGame.id}:away`} />}
                    </strong>
                    {selectedTeamSide === 'away' && <span className="wire-badge-active">Viewing</span>}
                  </div>
                </div>
              </button>

              <button
                role="tab"
                aria-selected={selectedTeamSide === 'home'}
                className={`wire-team-half wire-team-half-home${selectedTeamSide === 'home' ? ' active' : ''}${homeLost ? ' is-loser' : ''}`}
                onClick={() => setSelectedTeamSide('home')}
                style={{
                  '--team-bar-color': homeBoxTeam?.color || selectedGame.home.color || '#ef4444',
                } as React.CSSProperties}
              >
                <div className="wire-team-half-content">
                  <div className="wire-team-half-left">
                    <span
                      className="team-mark"
                      style={{ '--team-color': homeBoxTeam?.color || selectedGame.home.color } as React.CSSProperties}
                    >
                      {homeBoxTeam?.logo ? (
                        <OfflineImage src={homeBoxTeam.logo} alt="" />
                      ) : (
                        (homeBoxTeam?.abbreviation || selectedGame.home.abbr).slice(0, 2)
                      )}
                    </span>
                    <div className="wire-team-half-copy">
                      <span className="wire-team-half-name">
                        {homeBoxTeam?.name || selectedGame.home.name}
                      </span>
                      <small className="wire-team-half-sub">
                        Home · {homeBoxTeam?.record || selectedGame.home.record}
                      </small>
                    </div>
                  </div>
                  <div className="wire-team-half-right">
                    <strong className="wire-team-half-score">
                      {selectedGame.status === 'UPCOMING' ? '–' : <ScoreTicker value={homeBoxTeam?.score ?? selectedGame.home.score} gameKey={`${selectedGame.id}:home`} />}
                    </strong>
                    {selectedTeamSide === 'home' && <span className="wire-badge-active">Viewing</span>}
                  </div>
                </div>
              </button>
            </div>
          </section>

          {/* Subtabs: Player Box Score vs Team Comparison */}
          <div className="wire-subtabs-bar">
            <div className="wire-subtabs">
              <button
                className={subTab === 'boxscore' ? 'active' : ''}
                onClick={() => setSubTab('boxscore')}
              >
                Player Box Score
              </button>
              <button
                className={subTab === 'teamStats' ? 'active' : ''}
                onClick={() => setSubTab('teamStats')}
              >
                Team Comparison
              </button>
            </div>

            {subTab === 'boxscore' && !isUpcoming && (
              <div className="wire-category-filters" role="tablist" aria-label="Stat category filter">
                {categoryFilters.map((cat) => (
                  <button
                    key={cat}
                    role="tab"
                    aria-selected={activeCategoryFilter === cat}
                    className={activeCategoryFilter === cat ? 'active' : ''}
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>
          {isUpcoming && subTab === 'boxscore' && (
            <div className="wire-stat-mode wire-subtabs" role="group" aria-label="Player season statistics display">
              <button aria-pressed={playerStatMode === 'total'} className={playerStatMode === 'total' ? 'active' : ''} onClick={() => setPlayerStatMode('total')}>Total stats</button>
              <button aria-pressed={playerStatMode === 'average'} className={playerStatMode === 'average' ? 'active' : ''} onClick={() => setPlayerStatMode('average')}>Avg stats</button>
            </div>
          )}

          {/* Main Body */}
          {loading && !boxScore && !isUpcoming ? (
            <div className="panel empty-games">Loading game box score and player stats…</div>
          ) : failed && !boxScore && !isUpcoming ? (
            <div className="panel feed-warning">
              Unable to load live box score from feed. The scoreboard will retry automatically.
            </div>
          ) : subTab === 'teamStats' ? (
            /* Team Comparison View */
            <div className="wire-team-comparison-view">
              <div className="wire-comparison-card">
                <header className="wire-comparison-header">
                  <div className="wire-comp-team">
                    <span
                      className="team-mark"
                      style={{ '--team-color': compAwayColor } as React.CSSProperties}
                    >
                      {selectedGame.away.logo ? <OfflineImage src={selectedGame.away.logo} alt="" /> : selectedGame.away.abbr}
                    </span>
                    <b>{awayBoxTeam?.name ?? selectedGame.away.name}</b>
                    <span
                      className="wire-comp-swatch"
                      style={{ backgroundColor: compAwayColor }}
                      title={`${awayBoxTeam?.name ?? selectedGame.away.name} bar line`}
                    />
                  </div>
                  <span className="eyebrow">{isUpcoming ? `${seasonYear} REGULAR SEASON · PER GAME` : 'STATISTICAL COMPARISON'}</span>
                  <div className="wire-comp-team text-right">
                    <span
                      className="wire-comp-swatch"
                      style={{ backgroundColor: compHomeColor }}
                      title={`${homeBoxTeam?.name ?? selectedGame.home.name} bar line`}
                    />
                    <b>{homeBoxTeam?.name ?? selectedGame.home.name}</b>
                    <span
                      className="team-mark"
                      style={{ '--team-color': compHomeColor } as React.CSSProperties}
                    >
                      {selectedGame.home.logo ? <OfflineImage src={selectedGame.home.logo} alt="" /> : selectedGame.home.abbr}
                    </span>
                  </div>
                </header>

                <div className="wire-comparison-list">
                  {isUpcoming && averagesLoading && !seasonAverages ? (
                    <p className="nfl-empty-note" role="status">Loading team season averages…</p>
                  ) : isUpcoming && averagesFailed && !seasonAverages ? (
                    <div className="wire-comparison-error" role="alert">
                      <p>Unable to load team season averages.</p>
                      <button className="wire-stathub-link" onClick={() => setAveragesRetry((retry) => retry + 1)}>Retry team averages</button>
                    </div>
                  ) : comparisonStats.map((item, index) => (
                    <div className="wire-comp-row" key={index}>
                      <span className="wire-comp-val wire-comp-away">{item.awayVal}{isUpcoming && <small className="wire-comp-rank">{item.awayRank ? `${item.awayRank.tied ? 'T-' : '#'}${item.awayRank.rank} NFL` : ranksLoading && !seasonRanks ? 'Loading rank…' : 'Rank unavailable'}</small>}</span>
                      <div className="wire-comp-center">
                        <span className="wire-comp-label">{item.label}</span>
                        {item.percentAway !== undefined && (
                          <div className="wire-comp-bar-track">
                            <div
                              className="wire-comp-bar-fill-away"
                              style={{
                                width: `${item.percentAway}%`,
                                backgroundColor: compAwayColor,
                              }}
                            />
                            <div
                              className="wire-comp-bar-fill-home"
                              style={{
                                width: `${100 - item.percentAway}%`,
                                backgroundColor: compHomeColor,
                              }}
                            />
                          </div>
                        )}
                      </div>
                      <span className="wire-comp-val wire-comp-home">{item.homeVal}{isUpcoming && <small className="wire-comp-rank">{item.homeRank ? `${item.homeRank.tied ? 'T-' : '#'}${item.homeRank.rank} NFL` : ranksLoading && !seasonRanks ? 'Loading rank…' : 'Rank unavailable'}</small>}</span>
                    </div>
                  ))}
                  {comparisonStats.length === 0 && (
                    <p className="nfl-empty-note">Detailed team stats will populate once the game begins.</p>
                  )}
                </div>
                {isUpcoming && ranksError && <div className="wire-comparison-error" role="alert"><p>{ranksError}</p><button className="wire-stathub-link" onClick={() => setRanksRetry((value) => value + 1)}>Retry NFL ranks</button></div>}
                {isUpcoming && <p className="nfl-data-note wire-comparison-note">Season-to-date regular-season averages, not projections. NFL ranks compare all 32 teams: higher offense and lower allowed values rank better; T- denotes a tie. Missing values or incomplete league coverage leave ranks unavailable.</p>}
              </div>
            </div>
          ) : (
            /* Player Box Score View */
            <div className="wire-player-boxscore-view">
              {isUpcoming && currentPlayerAverages && currentPlayerAverages.failedPlayers > 0 && (
                <div className="wire-comparison-error" role="alert">
                  <p>Season statistics could not be loaded for {currentPlayerAverages.failedPlayers} players. The remaining player statistics are shown below.</p>
                  <button className="wire-stathub-link" onClick={() => setPlayerAveragesRetry((retry) => retry + 1)}>Retry player totals</button>
                </div>
              )}
              {isUpcoming && playerAveragesLoading && !currentPlayerAverages ? (
                <div className="panel empty-games" role="status">Loading player season totals…</div>
              ) : isUpcoming && playerAveragesFailed && !currentPlayerAverages ? (
                <div className="wire-comparison-error" role="alert">
                  <p>Unable to load player season totals.</p>
                  <button className="wire-stathub-link" onClick={() => setPlayerAveragesRetry((retry) => retry + 1)}>Retry player totals</button>
                </div>
              ) : categoriesToDisplay.length > 0 ? (
                categoriesToDisplay.map((category) => (
                  <section className="wire-category-card" key={category.name}>
                    <header className="wire-category-header">
                      <div className="wire-category-title-wrap">
                        <h3>{category.title}</h3>
                        <span className="wire-team-tag">{activeBoxTeam?.abbreviation}</span>
                      </div>
                      <span className="wire-category-count">
                        {category.athletes.length} {category.athletes.length === 1 ? 'player' : 'players'}
                      </span>
                    </header>

                    <div className="wire-table-scroll-container">
                      <table className={`wire-stat-table${isUpcoming ? ' wire-season-table' : ''}`} style={{ '--wire-stat-count': category.labels.filter(Boolean).length } as React.CSSProperties} role="table" aria-label={`${activeGameTeam?.name ?? 'Team'} ${category.title}${isUpcoming ? playerStatMode === 'total' ? ' season totals' : ' season per-game averages' : ''}`}>
                        {isUpcoming && <colgroup><col className="wire-season-athlete-column" />{category.labels.map((_, index) => <col key={index} />)}</colgroup>}
                        <thead role="rowgroup">
                          <tr role="row">
                            <th className="wire-col-athlete" scope="col" role="columnheader">Athlete</th>
                            {category.labels.map((lbl, idx) => (
                              <th key={idx} className={`wire-col-data${!lbl ? ' wire-empty-stat' : ''}`} aria-hidden={!lbl || undefined} scope="col" role="columnheader">{lbl}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody role="rowgroup">
                          {category.athletes.map((athlete) => {
                            const player = isUpcoming ? playerAverages?.players.find((item) => item.id === athlete.id) : undefined;
                            return (
                            <tr key={athlete.id} role="row">
                              <td className="wire-col-athlete" role="cell">
                                <div className="wire-athlete-cell">
                                  <span className="wire-athlete-avatar">
                                    {athlete.headshot ? (
                                      <OfflineImage src={athlete.headshot} alt="" />
                                    ) : (
                                      athlete.name.slice(0, 2).toUpperCase()
                                    )}
                                  </span>
                                  {player && currentPlayerAverages && activeGameTeam ? (
                                    <button
                                      className="wire-athlete-meta wire-player-card-button"
                                      aria-label={`View ${athlete.name} stats`}
                                      onClick={() => onOpenPlayer(player, activeGameTeam)}
                                    >
                                      <span className="wire-athlete-name">{athlete.name}</span>
                                      <small className="wire-athlete-sub">{athlete.position || ''}{athlete.jersey ? ` · #${athlete.jersey}` : ''}</small>
                                    </button>
                                  ) : (
                                    <div className="wire-athlete-meta">
                                      <span className="wire-athlete-name">{athlete.name}</span>
                                      <small className="wire-athlete-sub">{athlete.position || ''}{athlete.jersey ? ` · #${athlete.jersey}` : ''}</small>
                                    </div>
                                  )}
                                  {activeGameTeam && (
                                    <button
                                      className={`favorite-star-button wire-star${isPlayerFavorite(athlete.id) ? ' is-favorite' : ''}`}
                                      title={isPlayerFavorite(athlete.id) ? 'Remove favorite' : 'Add favorite'}
                                      aria-label={`${isPlayerFavorite(athlete.id) ? 'Remove' : 'Add'} ${athlete.name} ${isPlayerFavorite(athlete.id) ? 'from' : 'to'} favorites`}
                                      aria-pressed={isPlayerFavorite(athlete.id)}
                                      onClick={() => togglePlayerFavorite(athlete, activeGameTeam)}
                                    >
                                      <Star size={13} fill={isPlayerFavorite(athlete.id) ? 'currentColor' : 'none'} />
                                    </button>
                                  )}
                                </div>
                              </td>
                              {athlete.stats.map((statVal, sIdx) => (
                                <td key={sIdx} className={`wire-col-data${!category.labels[sIdx] ? ' wire-empty-stat' : ''}`} aria-hidden={!category.labels[sIdx] || undefined} role="cell">
                                  <span className="wire-mobile-stat-label" aria-hidden="true">{category.labels[sIdx]}</span>
                                  <span className={statVal === 'Unavailable' ? 'wire-stat-unavailable' : undefined}>{statVal}</span>
                                </td>
                              ))}
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))
              ) : (
                <div className="panel empty-games">
                  No {activeCategoryFilter !== 'All' ? activeCategoryFilter.toLowerCase() : ''} {isUpcoming ? 'regular-season player totals available' : 'player statistics recorded'} for {activeGameTeam?.name ?? 'this team'} yet.
                </div>
              )}
            </div>
          )}

          <p className="nfl-data-note">
            {isUpcoming ? `${subTab === 'teamStats' ? 'Team averages' : playerStatMode === 'total' ? 'Player totals' : 'Player per-game averages'} use regular-season statistics. Missing values are shown as unavailable.` : 'Box scores and individual statistics update live from public game feeds.'}
          </p>
        </div>
      )}
    </div>
  );
}
