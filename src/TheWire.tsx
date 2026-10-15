import { useEffect, useRef, useState } from 'react';
import { Activity, ChevronRight, MapPin, Star, Tv } from 'lucide-react';
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
  fetchNFLBoxScore,
  fetchNFLGameDetails,
  fetchNFLPlayerSeasonBoxScore,
  fetchNFLTeamSeasonAverages,
  findAutomaticNFLGame,
  getPrimetimeFullTitle,
  getPrimetimeLabel,
  isPrimetimeGame,
} from './services/sportsData';
import { getInterfaceScale } from './uiScale';

type TheWireProps = {
  games: Game[];
  query: string;
  favorites: FavoriteTarget[];
  onToggleFavorite: (favorite: FavoriteTarget) => void;
  initialGameId?: string | null;
  onSelectGame?: (gameId: string) => void;
  onOpenStatHub?: (game: Game) => void;
  onOpenPlayer: (player: NFLSkillPlayer, team: Team) => void;
};

function formatGameTime(game: Game) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(game.date));
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

export default function TheWire({ games, query, favorites, onToggleFavorite, initialGameId, onSelectGame, onOpenStatHub, onOpenPlayer }: TheWireProps) {
  const nflGames = games.filter((g) => g.sport === 'Football');
  const userSelectedRef = useRef(false);

  // Auto-select: prioritize live primetime games (TNF, SNF, MNF), then any live game
  const initialAutoGame = findAutomaticNFLGame(nflGames, initialGameId);

  const [selectedGameId, setSelectedGameId] = useState<string>(
    initialAutoGame?.id ?? (initialGameId && nflGames.some((g) => g.id === initialGameId) ? initialGameId : nflGames[0]?.id ?? '')
  );
  const [selectedTeamSide, setSelectedTeamSide] = useState<'away' | 'home'>('away');
  const [subTab, setSubTab] = useState<'boxscore' | 'teamStats'>('boxscore');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [boxScore, setBoxScore] = useState<NFLBoxScoreData | null>(null);
  const [playerAverages, setPlayerAverages] = useState<{ gameId: string; data: NFLPlayerSeasonBoxScore; players: NFLSkillPlayer[] } | null>(null);
  const [playerAveragesLoading, setPlayerAveragesLoading] = useState(false);
  const [playerAveragesFailed, setPlayerAveragesFailed] = useState(false);
  const [playerAveragesRetry, setPlayerAveragesRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [seasonAverages, setSeasonAverages] = useState<{ gameId: string; teams: NFLTeamSeasonAverages[] } | null>(null);
  const [averagesLoading, setAveragesLoading] = useState(false);
  const [averagesFailed, setAveragesFailed] = useState(false);
  const [averagesRetry, setAveragesRetry] = useState(0);

  // Wheel drag ref
  const wheelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ pointerId: null as number | null, startX: 0, startScrollLeft: 0, moved: false });

  // Select game helper
  const selectGame = (gameId: string) => {
    userSelectedRef.current = true;
    setSelectedGameId(gameId);
    onSelectGame?.(gameId);
  };

  // When initialGameId prop changes (e.g. user clicked on a specific game card)
  useEffect(() => {
    if (initialGameId && nflGames.some((g) => g.id === initialGameId)) {
      userSelectedRef.current = true;
      setSelectedGameId(initialGameId);
    }
  }, [initialGameId, nflGames]);

  // Update selectedGameId if list changes or live primetime game is active
  useEffect(() => {
    if (nflGames.length === 0) return;

    if (!userSelectedRef.current) {
      const bestGame = findAutomaticNFLGame(nflGames);
      if (bestGame && (bestGame.status === 'LIVE' || !nflGames.some((g) => g.id === selectedGameId))) {
        setSelectedGameId(bestGame.id);
        return;
      }
    }

    if (!nflGames.some((g) => g.id === selectedGameId)) {
      const fallback = findAutomaticNFLGame(nflGames) ?? nflGames[0];
      setSelectedGameId(fallback.id);
    }
  }, [games, nflGames, selectedGameId]);

  const selectedGame = nflGames.find((g) => g.id === selectedGameId) ?? nflGames[0];
  const selectedPrimetime = selectedGame ? getPrimetimeLabel(selectedGame) : null;
  const livePrimetimeGame = nflGames.find((g) => g.status === 'LIVE' && isPrimetimeGame(g))
    ?? nflGames.find((g) => g.status === 'LIVE');
  const searchQuery = query.trim().toLowerCase();

  const filteredGames = nflGames.filter((g) => {
    if (!searchQuery) return true;
    return (
      g.away.name.toLowerCase().includes(searchQuery)
      || g.away.abbr.toLowerCase().includes(searchQuery)
      || g.home.name.toLowerCase().includes(searchQuery)
      || g.home.abbr.toLowerCase().includes(searchQuery)
    );
  });

  const isLive = selectedGame?.status === 'LIVE';
  const eventId = selectedGame?.eventId;
  const feedPath = selectedGame?.feedPath;
  const seasonYear = selectedGame?.seasonYear;
  const isUpcoming = selectedGame?.status === 'UPCOMING';
  const categoryFilters = isUpcoming ? ['All', 'Offense'] : ['All', 'Offense', 'Defense', 'Special Teams'];
  const activeCategoryFilter = categoryFilters.includes(categoryFilter) ? categoryFilter : 'All';
  const awayTeamId = selectedGame?.away.id;
  const homeTeamId = selectedGame?.home.id;
  const activeTeamId = selectedTeamSide === 'away' ? awayTeamId : homeTeamId;
  const activeTeamName = selectedTeamSide === 'away' ? selectedGame?.away.name : selectedGame?.home.name;

  useEffect(() => {
    setSeasonAverages(null);
    setAveragesFailed(false);
    if (!isUpcoming || !eventId || !feedPath || !seasonYear || !awayTeamId || !homeTeamId) {
      setAveragesLoading(false);
      return;
    }
    const controller = new AbortController();
    setAveragesLoading(true);
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
  }, [isUpcoming, eventId, feedPath, seasonYear, awayTeamId, homeTeamId, averagesRetry]);

  // Load box score for the selected game
  useEffect(() => {
    if (!eventId || !feedPath) {
      setLoading(false);
      return undefined;
    }

    let current = true;
    const controller = new AbortController();

    const loadData = async (isPoll = false) => {
      if (!isPoll) {
        setLoading(true);
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
  }, [eventId, feedPath, isLive]);

  useEffect(() => {
    setPlayerAverages(null);
    setPlayerAveragesFailed(false);
    if (!isUpcoming || subTab !== 'boxscore' || !eventId || !feedPath || !seasonYear || !activeTeamId || !activeTeamName) {
      setPlayerAveragesLoading(false);
      return;
    }
    const controller = new AbortController();
    setPlayerAveragesLoading(true);
    void fetchNFLGameDetails(feedPath, eventId, seasonYear, [{ id: activeTeamId, name: activeTeamName }], controller.signal)
      .then((details) => {
        controller.signal.throwIfAborted();
        const players = details.teamForms.find((team) => team.teamId === activeTeamId)?.skillPlayers ?? [];
        return fetchNFLPlayerSeasonBoxScore(feedPath, activeTeamId, seasonYear, players, controller.signal)
          .then((data) => ({ data, players }));
      }).then(({ data, players }) => {
      if (!controller.signal.aborted) {
        setPlayerAverages({ gameId: eventId, data, players });
        setPlayerAveragesLoading(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setPlayerAveragesFailed(true);
        setPlayerAveragesLoading(false);
      }
    });
    return () => controller.abort();
  }, [isUpcoming, subTab, eventId, feedPath, seasonYear, activeTeamId, activeTeamName, playerAveragesRetry]);

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
  const categoriesToDisplay = (isUpcoming ? currentPlayerAverages?.categories ?? [] : activeBoxTeam?.categories ?? []).map((category) => {
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
  const comparisonStats: Array<{ label: string; awayVal: string; homeVal: string; percentAway?: number }> = [];
  if (isUpcoming) {
    const teams = seasonAverages?.gameId === eventId ? seasonAverages.teams : [];
    const away = teams.find((team) => team.teamId === awayTeamId);
    const home = teams.find((team) => team.teamId === homeTeamId);
    const metrics: Array<{ key: Exclude<keyof NFLTeamSeasonAverages, 'teamId'>; label: string }> = [
      { key: 'pointsPerGame', label: 'Points / game' },
      { key: 'totalYardsPerGame', label: 'Total yards / game' },
      { key: 'passingYardsPerGame', label: 'Passing yards / game' },
      { key: 'rushingYardsPerGame', label: 'Rushing yards / game' },
      { key: 'pointsAllowedPerGame', label: 'Points allowed / game' },
      { key: 'totalYardsAllowedPerGame', label: 'Total yards allowed / game' },
      { key: 'passingYardsAllowedPerGame', label: 'Passing yards allowed / game' },
      { key: 'rushingYardsAllowedPerGame', label: 'Rushing yards allowed / game' },
    ];
    for (const { key, label } of metrics) {
      const awayValue = away?.[key] ?? null;
      const homeValue = home?.[key] ?? null;
      const percentAway = awayValue !== null && homeValue !== null && awayValue + homeValue > 0
        ? Math.round(awayValue / (awayValue + homeValue) * 100)
        : undefined;
      comparisonStats.push({
        label,
        awayVal: awayValue === null ? 'Unavailable' : awayValue.toFixed(1),
        homeVal: homeValue === null ? 'Unavailable' : homeValue.toFixed(1),
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

  return (
    <div className="the-wire-container">
      {/* Game Wheel */}
      <div className="wire-controls">
        {filteredGames.length > 0 ? (
          <div className="wire-game-wheel">
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
              {filteredGames.map((game) => {
                const live = game.status === 'LIVE';
                const selected = game.id === selectedGame?.id;
                const primetime = getPrimetimeLabel(game);
                return (
                  <button
                    key={game.id}
                    role="tab"
                    aria-selected={selected}
                    className={`wire-wheel-card${selected ? ' selected' : ''}${live ? ' is-live' : ''}${primetime ? ` is-primetime is-${primetime.toLowerCase()}` : ''}`}
                    onClick={() => selectGame(game.id)}
                  >
                    <div className="wire-wheel-status">
                      {primetime && (
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
                      <div className="wire-wheel-row">
                        <span className="wire-wheel-team-abbr">{game.away.abbr}</span>
                        <strong className="wire-wheel-score">{game.status === 'UPCOMING' ? '–' : game.away.score}</strong>
                      </div>
                      <div className="wire-wheel-row">
                        <span className="wire-wheel-team-abbr">{game.home.abbr}</span>
                        <strong className="wire-wheel-score">{game.status === 'UPCOMING' ? '–' : game.home.score}</strong>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="nfl-empty-note">No games matched “{query}”.</p>
        )}
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
              <div className="wire-matchup-team wire-team-left">
                <div className="wire-matchup-mark-wrapper">
                  <span
                    className="team-mark team-mark-large"
                    style={{ '--team-color': selectedGame.away.color } as React.CSSProperties}
                  >
                    {selectedGame.away.logo ? (
                      <img src={selectedGame.away.logo} alt="" />
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
                  <b>{selectedGame.away.abbr}</b>
                  <h2>{selectedGame.away.name}</h2>
                  <small>{selectedGame.away.record || 'Away'}</small>
                </div>
                <div className="wire-matchup-score">
                  {selectedGame.status === 'UPCOMING' ? '–' : (awayBoxTeam?.score ?? selectedGame.away.score)}
                </div>
              </div>

              {/* Center Game State */}
              <div className="wire-matchup-center">
                {selectedPrimetime && (
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
              <div className="wire-matchup-team wire-team-right">
                <div className="wire-matchup-score">
                  {selectedGame.status === 'UPCOMING' ? '–' : (homeBoxTeam?.score ?? selectedGame.home.score)}
                </div>
                <div className="wire-matchup-team-details text-right">
                  <b>{selectedGame.home.abbr}</b>
                  <h2>{selectedGame.home.name}</h2>
                  <small>{selectedGame.home.record || 'Home'}</small>
                </div>
                <div className="wire-matchup-mark-wrapper">
                  <span
                    className="team-mark team-mark-large"
                    style={{ '--team-color': selectedGame.home.color } as React.CSSProperties}
                  >
                    {selectedGame.home.logo ? (
                      <img src={selectedGame.home.logo} alt="" />
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
                    <tr className={selectedTeamSide === 'away' ? 'active-team-row' : ''}>
                      <td className="wire-col-team">
                        <div className="wire-team-inline">
                          {awayBoxTeam?.logo && <img src={awayBoxTeam.logo} alt="" />}
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
                    <tr className={selectedTeamSide === 'home' ? 'active-team-row' : ''}>
                      <td className="wire-col-team">
                        <div className="wire-team-inline">
                          {homeBoxTeam?.logo && <img src={homeBoxTeam.logo} alt="" />}
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
                className={`wire-team-half wire-team-half-away${selectedTeamSide === 'away' ? ' active' : ''}`}
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
                        <img src={awayBoxTeam.logo} alt="" />
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
                      {selectedGame.status === 'UPCOMING' ? '–' : (awayBoxTeam?.score ?? selectedGame.away.score)}
                    </strong>
                    {selectedTeamSide === 'away' && <span className="wire-badge-active">Viewing</span>}
                  </div>
                </div>
              </button>

              <button
                role="tab"
                aria-selected={selectedTeamSide === 'home'}
                className={`wire-team-half wire-team-half-home${selectedTeamSide === 'home' ? ' active' : ''}`}
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
                        <img src={homeBoxTeam.logo} alt="" />
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
                      {selectedGame.status === 'UPCOMING' ? '–' : (homeBoxTeam?.score ?? selectedGame.home.score)}
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

            {subTab === 'boxscore' && (
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
                      {selectedGame.away.logo ? <img src={selectedGame.away.logo} alt="" /> : selectedGame.away.abbr}
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
                      {selectedGame.home.logo ? <img src={selectedGame.home.logo} alt="" /> : selectedGame.home.abbr}
                    </span>
                  </div>
                </header>

                <div className="wire-comparison-list">
                  {isUpcoming && averagesLoading ? (
                    <p className="nfl-empty-note" role="status">Loading team season averages…</p>
                  ) : isUpcoming && averagesFailed ? (
                    <div className="wire-comparison-error" role="alert">
                      <p>Unable to load team season averages from ESPN.</p>
                      <button className="wire-stathub-link" onClick={() => setAveragesRetry((retry) => retry + 1)}>Retry team averages</button>
                    </div>
                  ) : comparisonStats.map((item, index) => (
                    <div className="wire-comp-row" key={index}>
                      <span className="wire-comp-val wire-comp-away">{item.awayVal}</span>
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
                      <span className="wire-comp-val wire-comp-home">{item.homeVal}</span>
                    </div>
                  ))}
                  {comparisonStats.length === 0 && (
                    <p className="nfl-empty-note">Detailed team stats will populate once the game begins.</p>
                  )}
                </div>
                {isUpcoming && <p className="nfl-data-note wire-comparison-note">Season-to-date regular-season averages from ESPN, not projections. Missing values are unavailable. Lower allowed values mean fewer points or yards conceded.</p>}
              </div>
            </div>
          ) : (
            /* Player Box Score View */
            <div className="wire-player-boxscore-view">
              {isUpcoming && <p className="nfl-data-note" role="status">{seasonYear} REGULAR SEASON · PLAYER TOTALS<br />Up to 1 active QB, 2 RBs, 3 WRs, and 1 TE, ranked by recent passing attempts, carries, and receiving targets. Usage-ranked, not confirmed starters. GP is games played for {activeGameTeam?.name}; all stats are season-to-date totals for this team, not averages or projections. After kickoff, all players reported in the game box score are shown, with live updates every 15 seconds.</p>}
              {isUpcoming && currentPlayerAverages && currentPlayerAverages.failedPlayers > 0 && (
                <div className="wire-comparison-error" role="alert">
                  <p>Season statistics could not be loaded for {currentPlayerAverages.failedPlayers} players. The remaining player totals are shown below.</p>
                  <button className="wire-stathub-link" onClick={() => setPlayerAveragesRetry((retry) => retry + 1)}>Retry player totals</button>
                </div>
              )}
              {isUpcoming && playerAveragesLoading ? (
                <div className="panel empty-games" role="status">Loading player season totals…</div>
              ) : isUpcoming && playerAveragesFailed ? (
                <div className="wire-comparison-error" role="alert">
                  <p>Unable to load player season totals from ESPN.</p>
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
                      <table className={`wire-stat-table${isUpcoming ? ' wire-season-table' : ''}`} style={{ '--wire-stat-count': category.labels.filter(Boolean).length } as React.CSSProperties} role="table" aria-label={`${activeGameTeam?.name ?? 'Team'} ${category.title}${isUpcoming ? ' season totals' : ''}`}>
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
                                      <img src={athlete.headshot} alt="" />
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

                          {category.totals && category.totals.length > 0 && (
                            <tr className="wire-totals-row" role="row">
                              <td className="wire-col-athlete" role="cell">
                                <strong>Team Total</strong>
                              </td>
                              {category.totals.map((totVal, tIdx) => (
                                <td key={tIdx} className="wire-col-data" role="cell">
                                  <span className="wire-mobile-stat-label" aria-hidden="true">{category.labels[tIdx]}</span>
                                  <strong>{totVal}</strong>
                                </td>
                              ))}
                            </tr>
                          )}
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
            {isUpcoming ? `${subTab === 'teamStats' ? 'Team averages' : 'Player totals'} are pulled from ESPN public regular-season statistics. Missing values are shown as unavailable.` : 'Box scores and individual statistics are pulled live from ESPN public game feeds. Updates reflect in real time.'}
          </p>
        </div>
      )}
    </div>
  );
}
