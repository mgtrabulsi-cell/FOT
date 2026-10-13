import { useEffect, useRef, useState } from 'react';
import { Activity, ChevronRight, MapPin, Search, Star, Trophy, Tv } from 'lucide-react';
import type {
  FavoriteTarget,
  Game,
  NFLBoxScoreAthlete,
  NFLBoxScoreData,
  NFLBoxScoreTeam,
  NFLGameDetails,
  NFLSkillPlayer,
  Team,
} from './services/sportsData';
import {
  fetchNFLBoxScore,
  fetchNFLGameDetails,
  findAutomaticNFLGame,
  getPrimetimeFullTitle,
  getPrimetimeLabel,
  isPrimetimeGame,
} from './services/sportsData';

type TheWireProps = {
  games: Game[];
  favorites: FavoriteTarget[];
  onToggleFavorite: (favorite: FavoriteTarget) => void;
  initialGameId?: string | null;
  onSelectGame?: (gameId: string) => void;
  onOpenStatHub?: (game: Game) => void;
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

export default function TheWire({ games, favorites, onToggleFavorite, initialGameId, onSelectGame, onOpenStatHub }: TheWireProps) {
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
  const [query, setQuery] = useState('');
  const [boxScore, setBoxScore] = useState<NFLBoxScoreData | null>(null);
  const [gameDetails, setGameDetails] = useState<NFLGameDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

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

  // Load upcoming game details if game has not started yet
  useEffect(() => {
    if (!selectedGame || selectedGame.status !== 'UPCOMING' || !eventId || !feedPath || !seasonYear) {
      setGameDetails(null);
      return undefined;
    }

    let current = true;
    const controller = new AbortController();

    void fetchNFLGameDetails(
      feedPath,
      eventId,
      seasonYear,
      [
        { id: selectedGame.away.id, name: selectedGame.away.name },
        { id: selectedGame.home.id, name: selectedGame.home.name },
      ],
      controller.signal
    ).then((res) => {
      if (current) setGameDetails(res);
    }).catch(() => {
      // Graceful fallback
    });

    return () => {
      current = false;
      controller.abort();
    };
  }, [selectedGame, eventId, feedPath, seasonYear]);

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
      event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
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

  const awayBoxTeam: NFLBoxScoreTeam | undefined = boxScore?.teams[0];
  const homeBoxTeam: NFLBoxScoreTeam | undefined = boxScore?.teams[1];
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
  const categoriesToDisplay = (activeBoxTeam?.categories ?? []).filter((cat) => {
    if (categoryFilter === 'All') return true;
    if (categoryFilter === 'Offense') return ['passing', 'rushing', 'receiving'].includes(cat.name);
    if (categoryFilter === 'Defense') return ['defensive', 'interceptions', 'fumbles'].includes(cat.name);
    if (categoryFilter === 'Special Teams') return ['kicking', 'punting', 'kickReturns', 'puntReturns'].includes(cat.name);
    return cat.title.toLowerCase().includes(categoryFilter.toLowerCase()) || cat.name.toLowerCase().includes(categoryFilter.toLowerCase());
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
  if (awayBoxTeam && homeBoxTeam) {
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

  const togglePlayerFavorite = (athlete: NFLBoxScoreAthlete, team: NFLBoxScoreTeam) => {
    const target: FavoriteTarget = {
      key: `player:${athlete.id}`,
      type: 'player',
      id: athlete.id,
      name: athlete.name,
      shortName: athlete.shortName || athlete.name,
      feedPath: 'football/nfl',
      teamName: team.name,
      teamAbbr: team.abbreviation,
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

  // Skill players for upcoming games
  const upcomingTeamPlayers: NFLSkillPlayer[] = selectedGame && gameDetails
    ? (gameDetails.teamForms.find((f) => f.teamId === (selectedTeamSide === 'away' ? selectedGame.away.id : selectedGame.home.id))?.skillPlayers ?? [])
    : [];

  return (
    <div className="the-wire-container">
      {/* Search & Game Wheel */}
      <div className="wire-controls">
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search game by team name or abbreviation…"
          />
        </label>

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
                {['All', 'Offense', 'Defense', 'Special Teams'].map((cat) => (
                  <button
                    key={cat}
                    role="tab"
                    aria-selected={categoryFilter === cat}
                    className={categoryFilter === cat ? 'active' : ''}
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Main Body */}
          {loading && !boxScore ? (
            <div className="panel empty-games">Loading game box score and player stats…</div>
          ) : failed && !boxScore ? (
            <div className="panel feed-warning">
              Unable to load live box score from feed. The scoreboard will retry automatically.
            </div>
          ) : selectedGame.status === 'UPCOMING' && (!boxScore || boxScore.teams.length === 0) ? (
            /* Upcoming Game Preview */
            <div className="wire-upcoming-preview">
              <div className="wire-upcoming-card">
                <header>
                  <Trophy size={18} />
                  <div>
                    <h3>Game Scheduled for {formatGameTime(selectedGame)}</h3>
                    <p>Live player stats, plays, and box scores will automatically stream here once kickoff begins.</p>
                  </div>
                </header>

                <div className="wire-upcoming-roster-section">
                  <h4>{activeGameTeam?.name ?? 'Team'} Active Skill Players</h4>
                  {upcomingTeamPlayers.length > 0 ? (
                    <div className="wire-upcoming-player-grid">
                      {upcomingTeamPlayers.map((player) => (
                        <div className="wire-upcoming-player-card" key={player.id}>
                          <span className="nfl-player-avatar">
                            {player.headshot ? (
                              <img src={player.headshot} alt="" />
                            ) : (
                              player.name.slice(0, 2).toUpperCase()
                            )}
                          </span>
                          <div className="wire-upcoming-player-info">
                            <b>{player.name}</b>
                            <small>{player.position} {player.jersey && `· #${player.jersey}`}</small>
                            <small className="wire-usage-note">
                              {player.gamesWithUsage} games with usage this season
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="nfl-empty-note">
                      Roster usage for {activeGameTeam?.name} will be ready closer to game time.
                    </p>
                  )}
                </div>
              </div>
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
                      {awayBoxTeam?.logo ? <img src={awayBoxTeam.logo} alt="" /> : awayBoxTeam?.abbreviation}
                    </span>
                    <b>{awayBoxTeam?.name ?? selectedGame.away.name}</b>
                    <span
                      className="wire-comp-swatch"
                      style={{ backgroundColor: compAwayColor }}
                      title={`${awayBoxTeam?.name ?? selectedGame.away.name} bar line`}
                    />
                  </div>
                  <span className="eyebrow">STATISTICAL COMPARISON</span>
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
                      {homeBoxTeam?.logo ? <img src={homeBoxTeam.logo} alt="" /> : homeBoxTeam?.abbreviation}
                    </span>
                  </div>
                </header>

                <div className="wire-comparison-list">
                  {comparisonStats.map((item, index) => (
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
              </div>
            </div>
          ) : (
            /* Player Box Score View */
            <div className="wire-player-boxscore-view">
              {categoriesToDisplay.length > 0 ? (
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
                      <table className="wire-stat-table">
                        <thead>
                          <tr>
                            <th className="wire-col-athlete">Athlete</th>
                            {category.labels.map((lbl, idx) => (
                              <th key={idx} className="wire-col-data">{lbl}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {category.athletes.map((athlete) => (
                            <tr key={athlete.id}>
                              <td className="wire-col-athlete">
                                <div className="wire-athlete-cell">
                                  <span className="wire-athlete-avatar">
                                    {athlete.headshot ? (
                                      <img src={athlete.headshot} alt="" />
                                    ) : (
                                      athlete.name.slice(0, 2).toUpperCase()
                                    )}
                                  </span>
                                  <div className="wire-athlete-meta">
                                    <span className="wire-athlete-name">{athlete.name}</span>
                                    <small className="wire-athlete-sub">
                                      {athlete.position || ''}{athlete.jersey ? ` · #${athlete.jersey}` : ''}
                                    </small>
                                  </div>
                                  {activeBoxTeam && (
                                    <button
                                      className={`favorite-star-button wire-star${isPlayerFavorite(athlete.id) ? ' is-favorite' : ''}`}
                                      title={isPlayerFavorite(athlete.id) ? 'Remove favorite' : 'Add favorite'}
                                      onClick={() => togglePlayerFavorite(athlete, activeBoxTeam)}
                                    >
                                      <Star size={13} fill={isPlayerFavorite(athlete.id) ? 'currentColor' : 'none'} />
                                    </button>
                                  )}
                                </div>
                              </td>
                              {athlete.stats.map((statVal, sIdx) => (
                                <td key={sIdx} className="wire-col-data">{statVal}</td>
                              ))}
                            </tr>
                          ))}

                          {category.totals && category.totals.length > 0 && (
                            <tr className="wire-totals-row">
                              <td className="wire-col-athlete">
                                <strong>Team Total</strong>
                              </td>
                              {category.totals.map((totVal, tIdx) => (
                                <td key={tIdx} className="wire-col-data">
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
                  No {categoryFilter !== 'All' ? categoryFilter.toLowerCase() : ''} player statistics recorded for {activeBoxTeam?.name ?? 'this team'} yet.
                </div>
              )}
            </div>
          )}

          <p className="nfl-data-note">
            Box scores and individual statistics are pulled live from ESPN public game feeds. Updates reflect in real time.
          </p>
        </div>
      )}
    </div>
  );
}
