import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  Activity,
  ArrowUpRight,
  ChevronRight,
  Clock3,
  LogOut,
  Search,
  Star,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { fetchFavoriteNews, fetchNFLFavoritePlays, fetchNFLGameDetails, fetchNFLGameLeaders, fetchScoreboards, fetchSoccerLineups, findNFLTeamsForPlayerSearch } from './services/sportsData';
import type { DenNewsItem, FavoriteTarget, Game, NFLFavoritePlay, NFLGameDetails, NFLGameLeader, NFLPlayerStatKey, NFLSkillPlayer, SoccerLineup, SoccerPlayer, Team } from './services/sportsData';
import AuthScreen, { ResetPasswordScreen } from './AuthScreen';
import SplashScreen from './SplashScreen';
import ProfilePage from './ProfilePage';
import { supabase } from './services/supabaseClient';


type DenScoreItem = {
  id: string;
  kind: 'score';
  favoriteKey: string;
  favoriteName: string;
  timestamp: string;
  league: string;
  away: Team;
  home: Team;
  status: Game['status'];
  period: string;
  clock: string;
};

type DenNewsFeedItem = DenNewsItem & { kind: 'news' };
type DenPlayItem = NFLFavoritePlay & { kind: 'play' };
type DenItem = DenNewsFeedItem | DenScoreItem;

const guestFavoriteStorageKey = 'fieldhouse:favorites:v1';

function parseFavorites(value: unknown): FavoriteTarget[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FavoriteTarget => item
    && typeof item.key === 'string'
    && typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.feedPath === 'string'
    && (item.type === 'team' || item.type === 'player'));
}

function loadGuestFavorites(): FavoriteTarget[] {
  try {
    return parseFavorites(JSON.parse(localStorage.getItem(guestFavoriteStorageKey) ?? '[]'));
  } catch {
    return [];
  }
}

function teamFavoriteTarget(team: Team, feedPath: string): FavoriteTarget {
  return { key: `team:${feedPath}:${team.id}`, type: 'team', id: team.id, name: team.name, shortName: team.abbr, feedPath };
}

function nflPlayerFavoriteTarget(player: NFLSkillPlayer, team: Team): FavoriteTarget {
  return {
    key: `player:football/nfl:${player.id}`,
    type: 'player',
    id: player.id,
    name: player.name,
    shortName: player.name,
    feedPath: 'football/nfl',
    teamName: team.name,
    teamAbbr: team.abbr,
    teamId: team.id,
    position: player.position,
    headshot: player.headshot,
  };
}

function playerLastName(name: string) {
  const parts = name.trim().split(/\s+/);
  const suffix = parts[parts.length - 1]?.toLowerCase();
  if (parts.length > 1 && ['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'].includes(suffix ?? '')) parts.pop();
  return parts[parts.length - 1] ?? name;
}

function TeamMark({ team, large = false }: { team: Team; large?: boolean }) {
  return <span className={`team-mark${large ? ' team-mark-large' : ''}`} style={{ '--team-color': team.color } as React.CSSProperties}>{team.logo ? <img src={team.logo} alt="" /> : team.abbr.slice(0, 2)}</span>;
}

function FavoriteStarButton({ favorite, label, onClick }: { favorite: boolean; label: string; onClick: () => void }) {
  return <button className={`favorite-star-button${favorite ? ' is-favorite' : ''}`} aria-label={favorite ? `Remove ${label} from favorites` : `Add ${label} to favorites`} aria-pressed={favorite} title={favorite ? 'Remove favorite' : 'Add favorite'} onClick={onClick}><Star size={15} fill={favorite ? 'currentColor' : 'none'} /></button>;
}

function TeamFavoriteButton({ game, team, favorites = [], onToggleFavorite }: { game: Game; team: Team; favorites?: FavoriteTarget[]; onToggleFavorite: (favorite: FavoriteTarget) => void }) {
  const target = teamFavoriteTarget(team, game.feedPath);
  return <FavoriteStarButton favorite={favorites.some((favorite) => favorite.key === target.key)} label={team.name} onClick={() => onToggleFavorite(target)} />;
}

function formatGameTime(game: Game) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(game.date));
}

function getNFLGamePlayerPools(game: Game | undefined, details: NFLGameDetails | null) {
  if (!game || !details) return [];
  const positionOrder = ['QB', 'RB', 'WR', 'TE'];
  const usage = (player: NFLSkillPlayer) => player.position === 'QB'
    ? player.passingAttempts + player.carries
    : player.position === 'RB'
      ? player.carries + player.targets
      : player.targets || player.receptions;
  const teams = [
    { team: game.away, players: details.teamForms.find((form) => form.teamId === game.away.id)?.skillPlayers ?? [] },
    { team: game.home, players: details.teamForms.find((form) => form.teamId === game.home.id)?.skillPlayers ?? [] },
  ];
  return teams.map(({ team, players: teamPlayers }) => {
    const positionCounts = new Map<string, number>();
    const players = [...teamPlayers].sort((first, second) => {
      const positionDifference = positionOrder.indexOf(first.position) - positionOrder.indexOf(second.position);
      return positionDifference || usage(second) - usage(first) || first.name.localeCompare(second.name);
    }).filter((player) => {
      const limit = player.position === 'WR' ? 4 : player.position === 'RB' ? 2 : 1;
      const count = positionCounts.get(player.position) ?? 0;
      if (count >= limit) return false;
      positionCounts.set(player.position, count + 1);
      return true;
    });
    return { team, players };
  });
}

function GameCard({ game, selected, onSelect, onOpenPlayers }: { game: Game; selected: boolean; onSelect: () => void; onOpenPlayers: () => void }) {
  const live = game.status === 'LIVE';
  return (
    <article className={`game-card${selected ? ' selected' : ''}`} onClick={onSelect}>
      <button className="game-card-main" onClick={(event) => { event.stopPropagation(); onSelect(); }} aria-pressed={selected}>
        <div className="game-card-top"><span className="league-name">{game.league}</span><span className={`game-state ${live ? 'is-live' : ''}`}>{live && <i />}{game.status === 'UPCOMING' ? formatGameTime(game) : game.status === 'FINAL' ? 'FINAL' : `${game.period} · ${game.clock}`}</span></div>
        {[game.away, game.home].map((team, index) => (
          <div className={`score-row${index === 1 ? ' home-team' : ''}`} key={team.abbr}>
            <TeamMark team={team} />
            <span className="team-name">{team.name}</span>
            <span className="team-record">{team.record}</span>
            <strong className="team-score">{game.status === 'UPCOMING' ? '–' : team.score}</strong>
          </div>
        ))}
      </button>
      <div className="card-bottom"><span>{game.venue}</span><button className="game-card-players" aria-label={`Open ${game.away.abbr} vs ${game.home.abbr} player stats`} title="View game players" onClick={(event) => { event.stopPropagation(); onOpenPlayers(); }}><ChevronRight size={16} /></button></div>
    </article>
  );
}

function SoccerLineups({ game }: { game: Game }) {
  const [lineups, setLineups] = useState<SoccerLineup[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<SoccerPlayer | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const gameId = game.id;
  const eventId = game.eventId;
  const feedPath = game.feedPath;
  const homeTeamId = game.home.id;
  const homeTeamName = game.home.name;
  const awayTeamId = game.away.id;
  const awayTeamName = game.away.name;

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const loadLineups = async () => {
      try {
        const result = await fetchSoccerLineups({
          eventId,
          feedPath,
          home: { id: homeTeamId, name: homeTeamName },
          away: { id: awayTeamId, name: awayTeamName },
        }, controller.signal);
        if (current) {
          setLineups(result);
          setFailed(false);
          setLoading(false);
        }
      } catch {
        if (current && !controller.signal.aborted) {
          setFailed(true);
          setLoading(false);
        }
      }
    };

    setLineups([]);
    setSelectedPlayer(null);
    setLoading(true);
    void loadLineups();
    const refreshId = window.setInterval(() => void loadLineups(), 30_000);
    return () => {
      current = false;
      controller.abort();
      window.clearInterval(refreshId);
    };
  }, [gameId, eventId, feedPath, homeTeamId, homeTeamName, awayTeamId, awayTeamName]);

  if (loading) return <p className="lineup-message">Loading confirmed starting lineups…</p>;
  if (failed) return <p className="lineup-message">Match details are unavailable right now. Retrying automatically.</p>;
  if (lineups.length === 0) return <p className="lineup-message">Starting XIs have not been published yet. This panel checks for updates every 30 seconds.</p>;

  return (
    <div className="lineup-content">
      <div className="lineup-grid">{lineups.map((lineup) => (
        <section className="lineup-team" key={lineup.teamId}>
          <header><TeamMark team={lineup.side === 'home' ? game.home : game.away} /><span><b>{lineup.teamName}</b><small>{lineup.formation || 'Starting XI'}</small></span></header>
          <div className="lineup-player-list">{lineup.players.map((player) => <button key={player.id} className={`lineup-player${selectedPlayer?.id === player.id ? ' selected' : ''}`} onClick={() => setSelectedPlayer(player)} aria-pressed={selectedPlayer?.id === player.id}>
            <span className="lineup-player-icon">{player.headshot ? <img src={player.headshot} alt="" /> : player.initials}</span><span className="lineup-player-copy"><b>{player.name}</b><small>{player.position || 'Player'}{player.jersey && ` · #${player.jersey}`}</small></span><ChevronRight size={14} />
          </button>)}</div>
        </section>
      ))}</div>
      {selectedPlayer && <PlayerMatchStats player={selectedPlayer} />}
    </div>
  );
}

function PlayerMatchStats({ player }: { player: SoccerPlayer }) {
  const stats = [
    ['MIN', player.minutes], ['SHOTS', player.shots], ['ON TARGET', player.shotsOnTarget], ['GOALS', player.goals], ['ASSISTS', player.assists],
  ];
  return <section className="player-match-stats"><div className="player-match-heading"><span className="lineup-player-icon">{player.headshot ? <img src={player.headshot} alt="" /> : player.initials}</span><div><span className="eyebrow">PLAYER MATCH STATS</span><h3>{player.name}</h3></div><span className="player-position">{player.position}{player.jersey && ` · #${player.jersey}`}</span></div><div className="match-stat-grid">{stats.map(([label, value]) => <div key={label}><span>{label}</span><b>{value === '0' ? '0' : value || '—'}</b></div>)}</div></section>;
}

function DraggableTabs<T extends string>({
  options,
  ariaLabel,
  className,
  selected,
  onSelect,
}: {
  options: Array<{ key: T; label: string; secondary?: string }>;
  ariaLabel: string;
  className: string;
  selected: T;
  onSelect: (key: T) => void;
}) {
  const dragState = useRef({ pointerId: null as number | null, startX: 0, startScrollLeft: 0, moved: false, suppressClick: false, pressedKey: undefined as T | undefined });

  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
      suppressClick: false,
      pressedKey: (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tab-key]')?.dataset.tabKey as T | undefined,
    };
    event.currentTarget.classList.add('is-dragging');
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 4) drag.moved = true;
    if (drag.moved) {
      event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
      event.preventDefault();
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragState.current;
    if (drag.pointerId !== event.pointerId) return;
    drag.suppressClick = drag.moved;
    if (drag.moved) window.setTimeout(() => { dragState.current.suppressClick = false; }, 0);
    if (!cancelled && !drag.moved && drag.pressedKey) onSelect(drag.pressedKey);
    drag.pointerId = null;
    drag.pressedKey = undefined;
    event.currentTarget.classList.remove('is-dragging');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div
    ref={stripRef}
    className={className}
    role="tablist"
    aria-label={ariaLabel}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={(event) => finishPointer(event)}
    onPointerCancel={(event) => finishPointer(event, true)}
    onLostPointerCapture={(event) => { dragState.current.pointerId = null; event.currentTarget.classList.remove('is-dragging'); }}
    onClickCapture={(event) => {
      if (!dragState.current.suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      dragState.current.suppressClick = false;
    }}
  >{options.map((option) => <button key={option.key} data-tab-key={option.key} role="tab" aria-selected={selected === option.key} className={selected === option.key ? 'active' : ''} onClick={() => onSelect(option.key)}><b>{option.label}</b>{option.secondary && <small>{option.secondary}</small>}</button>)}</div>;
}

function NFLGameWheel({ games, selectedGame, onSelect }: { games: Game[]; selectedGame: Game; onSelect: (gameId: string) => void }) {
  const options = games.map((game) => ({
    key: game.id,
    label: `${game.away.abbr} @ ${game.home.abbr}`,
    secondary: `${game.status === 'LIVE' ? 'LIVE · ' : ''}${formatGameTime(game)}`,
  }));
  return <section className="nfl-game-wheel"><span className="eyebrow">SELECT GAME</span><DraggableTabs options={options} ariaLabel="NFL games" className="nfl-game-wheel-tabs" selected={selectedGame.id} onSelect={onSelect} /></section>;
}

function getNFLPlayerStatValue(stats: Partial<Record<NFLPlayerStatKey, number>>, key: NFLPlayerStatKey) {
  if (key !== 'rushingReceivingTouchdowns') return stats[key];
  const rushing = stats.rushingTouchdowns;
  const receiving = stats.receivingTouchdowns;
  return rushing === undefined && receiving === undefined ? undefined : (rushing ?? 0) + (receiving ?? 0);
}

function NFLPlayerMiniWindow({ player, team, isFavorite, onToggleFavorite, onClose }: { player: NFLSkillPlayer; team: Team; isFavorite: boolean; onToggleFavorite: (favorite: FavoriteTarget) => void; onClose: () => void }) {
  const optionsByPosition: Record<string, Array<{ key: NFLPlayerStatKey; label: string }>> = {
    QB: [
      { key: 'passingYards', label: 'Pass yards' },
      { key: 'passingTouchdowns', label: 'Pass TD' },
      { key: 'interceptions', label: 'INT' },
      { key: 'completions', label: 'Completions' },
      { key: 'attempts', label: 'Attempts' },
      { key: 'rushingYards', label: 'Rush yards' },
      { key: 'rushingReceivingTouchdowns', label: 'Rushing + Receiving TD' },
      { key: 'totalYards', label: 'Total yards' },
    ],
    RB: [
      { key: 'carries', label: 'Carries' },
      { key: 'rushingYards', label: 'Rush yards' },
      { key: 'rushingReceivingTouchdowns', label: 'Rushing + Receiving TD' },
      { key: 'receptions', label: 'Receptions' },
      { key: 'receivingYards', label: 'Rec yards' },
      { key: 'totalYards', label: 'Total yards' },
    ],
    WR: [
      { key: 'receptions', label: 'Receptions' },
      { key: 'receivingYards', label: 'Rec yards' },
      { key: 'rushingReceivingTouchdowns', label: 'Rushing + Receiving TD' },
      { key: 'rushingYards', label: 'Rush yards' },
      { key: 'totalYards', label: 'Total yards' },
    ],
    TE: [
      { key: 'receptions', label: 'Receptions' },
      { key: 'receivingYards', label: 'Rec yards' },
      { key: 'rushingReceivingTouchdowns', label: 'Rushing + Receiving TD' },
      { key: 'rushingYards', label: 'Rush yards' },
      { key: 'totalYards', label: 'Total yards' },
    ],
  };
  const options = optionsByPosition[player.position] ?? optionsByPosition.WR;
  const playerGames = player.recentGames;
  const firstAvailable = options.find((option) => playerGames.some((game) => getNFLPlayerStatValue(game.stats, option.key) !== undefined))?.key ?? options[0].key;
  const [selectedStat, setSelectedStat] = useState<NFLPlayerStatKey>(firstAvailable);
  useEffect(() => setSelectedStat(firstAvailable), [player.id, firstAvailable]);
  const selectedOption = options.find((option) => option.key === selectedStat) ?? options[0];
  const chartValues = playerGames.map((game) => getNFLPlayerStatValue(game.stats, selectedStat));
  const maximumValue = Math.max(1, ...chartValues.filter((value): value is number => value !== undefined));

  return <div className="nfl-player-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="nfl-player-dialog" role="dialog" aria-modal="true" aria-labelledby="nfl-player-dialog-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <header className="nfl-player-dialog-heading"><span className="nfl-player-avatar nfl-player-avatar-large">{player.headshot ? <img src={player.headshot} alt="" /> : player.name.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('')}</span><div><span className="eyebrow">{team.abbr} · RECENT PERFORMANCE</span><h3 id="nfl-player-dialog-title">{player.name}</h3><small>{player.position}{player.jersey && ` · #${player.jersey}`}</small></div><FavoriteStarButton favorite={isFavorite} label={player.name} onClick={() => onToggleFavorite(nflPlayerFavoriteTarget(player, team))} /><button className="icon-button" aria-label="Close player stats" onClick={onClose}><X size={16} /></button></header>
      <div className="nfl-player-stat-picker"><span className="nfl-player-stat-label">GAME STAT</span><DraggableTabs options={options} ariaLabel={`${player.position} game stats`} className="nfl-player-stat-tabs" selected={selectedStat} onSelect={setSelectedStat} /></div>
      <div className="nfl-game-chart-heading"><b>{selectedOption.label} · EACH GAME</b><span>LAST {playerGames.length || 5} GAMES</span></div>
      {playerGames.length === 0 ? <p className="nfl-player-games-message">Game-by-game stats are unavailable from the feed.</p> : <div className="nfl-player-game-chart">{[...playerGames].reverse().map((game) => { const value = getNFLPlayerStatValue(game.stats, selectedStat); const barHeight = value === undefined ? 0 : Math.max(5, value / maximumValue * 100); return <div className="nfl-game-bar" key={game.gameId} aria-label={`${game.opponent}, ${selectedOption.label}: ${value ?? 'unavailable'}`}><strong className="nfl-game-bar-value">{value === undefined ? '—' : value.toLocaleString('en-US')}</strong><div className="nfl-game-bar-track"><i style={{ height: `${barHeight}%` }} /></div><b title={game.opponent}>{game.opponentAbbreviation}</b><small>{formatNFLDate(game.date)}</small><span className={`nfl-game-result${game.result === 'W' ? ' is-win' : game.result === 'L' ? ' is-loss' : ''}`}>{game.result || '—'}</span></div>; })}</div>}
      <p className="nfl-data-note">Game values are read from each game's box score. Missing entries are not estimated.</p>
    </section>
  </div>;
}

function formatSpread(value: number) {
  return value === 0 ? 'PK' : value > 0 ? `+${value}` : String(value);
}

function formatNFLDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed);
}

function NFLTrends({ game, details, liveLeaders }: { game: Game; details: NFLGameDetails | null; liveLeaders: NFLGameLeader[] }) {
  const awayForm = details?.teamForms.find((form) => form.teamId === game.away.id);
  const homeForm = details?.teamForms.find((form) => form.teamId === game.home.id);
  const stats = [
    ['Points per game', 'totalPointsPerGame'],
    ['Points allowed', 'totalPointsPerGameAllowed'],
    ['Passing yards / game', 'passingYardsPerGame'],
    ['Rushing yards / game', 'rushingYardsPerGame'],
    ['Total yards / game', 'yardsPerGame'],
  ];
  const spread = game.nflMarket?.spread;

  return <div className="nfl-trends-content">
    <section className="nfl-market"><div className="nfl-market-heading"><span className="eyebrow">MARKET LINES</span><span>{game.nflMarket?.provider ?? 'ESPN feed'} · informational</span></div>{game.nflMarket ? <div className="nfl-market-grid"><div><span>SPREAD</span><b>{game.home.abbr} {formatSpread(spread ?? 0)}</b><small>{game.away.abbr} {formatSpread(-(spread ?? 0))}</small></div><div><span>TOTAL</span><b>{game.nflMarket.total === null ? '—' : game.nflMarket.total.toFixed(1)}</b><small>Over / under points</small></div><div><span>MONEYLINE</span><b>{game.away.abbr} {game.nflMarket.awayMoneyline || '—'}</b><small>{game.home.abbr} {game.nflMarket.homeMoneyline || '—'}</small></div></div> : <p className="nfl-empty-note">Market lines are not currently supplied for this game.</p>}</section>
    {game.status === 'LIVE' ? <section className="nfl-team-stats nfl-live-leaders-section"><div className="nfl-live-stats-header"><span className="eyebrow">LIVE PLAYER LEADERS</span><div className="nfl-live-team-abbrs"><b>{game.away.abbr}</b><b>{game.home.abbr}</b></div></div><div className="nfl-live-leaders-grid">{[game.away, game.home].map((team) => {
      const teamLeaders = liveLeaders.filter((leader) => leader.teamId === team.id).sort((first, second) => second.yards - first.yards);
      return <div className="nfl-live-team" key={team.id}>{teamLeaders.length ? teamLeaders.map((leader) => <div className="nfl-live-leader-row" key={`${leader.teamId}:${leader.category}`}><span>{leader.position || leader.category.replace(' YDS', '')}</span><div><b>{leader.name}</b></div><strong>{leader.yards} YDS</strong></div>) : <p className="nfl-live-empty">Yardage leaders appear as stats are recorded.</p>}</div>;
    })}</div></section> : <section className="nfl-team-stats"><header><span className="nfl-team-abbr">{game.away.abbr}</span><span className="eyebrow">TEAM SEASON AVERAGES</span><span className="nfl-team-abbr">{game.home.abbr}</span></header>{stats.map(([label, key]) => <div className="nfl-team-stat-row" key={key}><b>{awayForm?.stats[key] ?? '—'}</b><span>{label}</span><b>{homeForm?.stats[key] ?? '—'}</b></div>)}</section>}
  </div>;
}

function NFLGameCenter({ game, favorites, onToggleFavorite, onOpenPlayers }: { game: Game; favorites: FavoriteTarget[]; onToggleFavorite: (favorite: FavoriteTarget) => void; onOpenPlayers: (game: Game) => void }) {
  const [details, setDetails] = useState<NFLGameDetails | null>(null);
  const [liveLeaders, setLiveLeaders] = useState<NFLGameLeader[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [detailsFailed, setDetailsFailed] = useState(false);
  const gameId = game.id;
  const eventId = game.eventId;
  const feedPath = game.feedPath;
  const homeTeamId = game.home.id;
  const homeTeamName = game.home.name;
  const awayTeamId = game.away.id;
  const awayTeamName = game.away.name;

  useEffect(() => {
    if (game.status !== 'LIVE') {
      setLiveLeaders([]);
      return;
    }
    let current = true;
    const controller = new AbortController();
    const refreshLeaders = async () => {
      try {
        const result = await fetchNFLGameLeaders(feedPath, eventId, controller.signal);
        if (current) setLiveLeaders(result);
      } catch {
        if (!controller.signal.aborted) return;
      }
    };

    setLiveLeaders([]);
    void refreshLeaders();
    const refreshId = window.setInterval(() => void refreshLeaders(), 30_000);
    return () => {
      current = false;
      controller.abort();
      window.clearInterval(refreshId);
    };
  }, [game.status, gameId, eventId, feedPath]);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const loadDetails = async () => {
      try {
        const result = await fetchNFLGameDetails(feedPath, eventId, game.seasonYear, [
          { id: awayTeamId, name: awayTeamName },
          { id: homeTeamId, name: homeTeamName },
        ], controller.signal);
        if (current) {
          setDetails(result);
          setDetailsFailed(false);
          setLoadingDetails(false);
        }
      } catch {
        if (current && !controller.signal.aborted) {
          setDetailsFailed(true);
          setLoadingDetails(false);
        }
      }
    };

    setDetails(null);
    setLoadingDetails(true);
    void loadDetails();
    const refreshId = window.setInterval(() => void loadDetails(), 60_000);
    return () => {
      current = false;
      controller.abort();
      window.clearInterval(refreshId);
    };
  }, [gameId, eventId, feedPath, game.seasonYear, homeTeamId, homeTeamName, awayTeamId, awayTeamName]);

  return <section className="panel game-center nfl-game-center">
    <div className="panel-heading"><div><span className="eyebrow">NFL GAME CENTER</span><h2>Trends &amp; lines</h2></div><span className="odds-source">{game.nflMarket?.provider ?? 'NFL'}</span></div>
    <div className="matchup"><div className="match-team"><button className="game-center-team-players" aria-label={`View ${game.away.name} players`} title="View team players" onClick={() => onOpenPlayers(game)}><TeamMark team={game.away} large /></button><b>{game.away.abbr}</b><span className="match-team-name">{game.away.name}</span><TeamFavoriteButton game={game} team={game.away} favorites={favorites} onToggleFavorite={onToggleFavorite} /></div><div className="match-score nfl-match-score">{game.status === 'UPCOMING' ? <span className="nfl-score-rule" aria-hidden="true" /> : <strong>{game.away.score}</strong>}<span className={game.status === 'LIVE' ? 'live-clock' : ''}>{game.status === 'LIVE' ? `${game.period} · ${game.clock}` : game.status === 'FINAL' ? 'FINAL' : formatGameTime(game)}</span>{game.status === 'UPCOMING' ? <span className="nfl-score-rule" aria-hidden="true" /> : <strong>{game.home.score}</strong>}</div><div className="match-team"><button className="game-center-team-players" aria-label={`View ${game.home.name} players`} title="View team players" onClick={() => onOpenPlayers(game)}><TeamMark team={game.home} large /></button><b>{game.home.abbr}</b><span className="match-team-name">{game.home.name}</span><TeamFavoriteButton game={game} team={game.home} favorites={favorites} onToggleFavorite={onToggleFavorite} /></div></div>
    {detailsFailed && <p className="nfl-inline-warning">Some matchup trends could not be loaded. Available scoreboard data remains visible.</p>}
    {loadingDetails && !details && game.status !== 'LIVE' ? <p className="lineup-message">Loading game trends and lines…</p> : <NFLTrends game={game} details={details} liveLeaders={liveLeaders} />}
  </section>;
}

function GameCenter({ game, favorites, onToggleFavorite, onOpenPlayers }: { game: Game; favorites: FavoriteTarget[]; onToggleFavorite: (favorite: FavoriteTarget) => void; onOpenPlayers: (game: Game) => void }) {
  if (game.sport === 'Football') return <NFLGameCenter game={game} favorites={favorites} onToggleFavorite={onToggleFavorite} onOpenPlayers={onOpenPlayers} />;
  return <GeneralGameCenter game={game} favorites={favorites} onToggleFavorite={onToggleFavorite} />;
}

function GeneralGameCenter({ game, favorites, onToggleFavorite }: { game: Game; favorites: FavoriteTarget[]; onToggleFavorite: (favorite: FavoriteTarget) => void }) {
  const [tab, setTab] = useState<'Summary' | 'Lineups'>('Summary');
  const isSoccer = game.sport === 'Soccer';
  useEffect(() => setTab('Summary'), [game.id]);

  return (
    <section className="panel game-center">
      <div className="panel-heading"><div><span className="eyebrow">GAME CENTER</span><h2>{game.league} <span className="muted-dot">·</span> {game.status === 'LIVE' ? 'Live now' : game.status === 'FINAL' ? 'Final' : 'Upcoming'}</h2></div><button className="icon-button" aria-label="Open full game center"><ArrowUpRight size={17} /></button></div>
      <div className="matchup">
        <div className="match-team"><TeamMark team={game.away} large /><b>{game.away.abbr}</b><span>{game.away.name}</span><TeamFavoriteButton game={game} team={game.away} favorites={favorites} onToggleFavorite={onToggleFavorite} /></div>
        <div className="match-score"><strong>{game.status === 'UPCOMING' ? '—' : game.away.score}</strong><span className={game.status === 'LIVE' ? 'live-clock' : ''}>{game.status === 'LIVE' ? `${game.period} · ${game.clock}` : game.status === 'FINAL' ? 'FINAL' : formatGameTime(game)}</span><strong>{game.status === 'UPCOMING' ? '—' : game.home.score}</strong></div>
        <div className="match-team"><TeamMark team={game.home} large /><b>{game.home.abbr}</b><span>{game.home.name}</span><TeamFavoriteButton game={game} team={game.home} favorites={favorites} onToggleFavorite={onToggleFavorite} /></div>
      </div>
      {isSoccer && <div className="tab-strip"><button className={tab === 'Summary' ? 'active' : ''} onClick={() => setTab('Summary')}>Summary</button><button className={tab === 'Lineups' ? 'active' : ''} onClick={() => setTab('Lineups')}>Starting XI</button></div>}
      {(!isSoccer || tab === 'Summary') && <div className="game-summary"><div className="summary-line"><span><Activity size={15} /> Game status</span><b>{game.status === 'LIVE' ? `${game.period} · ${game.clock}` : game.status === 'FINAL' ? 'Game complete' : formatGameTime(game)}</b></div><div className="summary-line"><span><Trophy size={15} /> Venue</span><b>{game.venue}</b></div><div className="summary-line"><span><Users size={15} /> Records</span><b>{game.away.record || '—'} <em>·</em> {game.home.record || '—'}</b></div><p className="live-feed-note">Scoreboard refreshes automatically every 30 seconds.</p></div>}
      {isSoccer && tab === 'Lineups' && <SoccerLineups game={game} />}
    </section>
  );
}

function NFLPlayersDirectory({ games, favorites, onToggleFavorite, initialGameId }: { games: Game[]; favorites: FavoriteTarget[]; onToggleFavorite: (favorite: FavoriteTarget) => void; initialGameId: string | null }) {
  const nflGames = games.filter((game) => game.sport === 'Football');
  const [selectedGameId, setSelectedGameId] = useState(initialGameId && nflGames.some((game) => game.id === initialGameId) ? initialGameId : nflGames[0]?.id ?? '');
  const [details, setDetails] = useState<NFLGameDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState('All');
  const [query, setQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<NFLSkillPlayer | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const game = nflGames.find((item) => item.id === selectedGameId) ?? nflGames[0];
  const searchQuery = query.trim().toLowerCase();
  const nflGameKey = nflGames.map((item) => item.id).sort().join('|');

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchStatus('');
      return;
    }
    const matchingGames = nflGames.filter((item) => [item.away, item.home].some((team) => (
      team.name.toLowerCase().includes(searchQuery)
      || team.abbr.toLowerCase().includes(searchQuery)
      || team.featuredPlayers?.some((player) => player.name.toLowerCase().includes(searchQuery))
    )));
    if (matchingGames.length) {
      setSelectedGameId(matchingGames[0].id);
      setSearchStatus(`${matchingGames.length} matching game${matchingGames.length === 1 ? '' : 's'}`);
      return;
    }
    let active = true;
    setSearchStatus('Searching active NFL rosters…');
    void findNFLTeamsForPlayerSearch(nflGames, searchQuery).then((teamIds) => {
      if (!active) return;
      const playerGames = nflGames.filter((item) => teamIds.includes(item.away.id) || teamIds.includes(item.home.id));
      if (playerGames.length) {
        setSelectedGameId(playerGames[0].id);
        setSearchStatus(`${playerGames.length} matching game${playerGames.length === 1 ? '' : 's'}`);
      } else {
        setSearchStatus(`No games this week found for “${query.trim()}”.`);
      }
    }).catch(() => {
      if (active) setSearchStatus('Could not search player rosters. Try again shortly.');
    });
    return () => { active = false; };
  }, [searchQuery, nflGameKey]);

  useEffect(() => {
    if (nflGames.length > 0 && !nflGames.some((item) => item.id === selectedGameId)) setSelectedGameId(nflGames[0].id);
  }, [games, nflGames, selectedGameId]);

  const gameId = game?.id;
  const feedPath = game?.feedPath;
  const eventId = game?.eventId;
  const seasonYear = game?.seasonYear;
  const homeTeamId = game?.home.id;
  const homeTeamName = game?.home.name;
  const awayTeamId = game?.away.id;
  const awayTeamName = game?.away.name;

  useEffect(() => {
    if (!gameId || !feedPath || !eventId || !seasonYear || !homeTeamId || !awayTeamId) {
      setLoading(false);
      return;
    }
    let current = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await fetchNFLGameDetails(feedPath, eventId, seasonYear, [
          { id: awayTeamId, name: awayTeamName ?? '' },
          { id: homeTeamId, name: homeTeamName ?? '' },
        ], controller.signal);
        if (current) {
          setDetails(result);
          setFailed(false);
          setLoading(false);
        }
      } catch {
        if (current && !controller.signal.aborted) {
          setFailed(true);
          setLoading(false);
        }
      }
    };

    setDetails(null);
    setSelectedPlayer(null);
    setSelectedTeam(null);
    setLoading(true);
    void load();
    return () => {
      current = false;
      controller.abort();
    };
  }, [gameId, feedPath, eventId, seasonYear, homeTeamId, homeTeamName, awayTeamId, awayTeamName]);

  const teamGroups = game ? getNFLGamePlayerPools(game, details).map((group, index) => ({
    ...group,
    side: index === 0 ? 'AWAY TEAM' : 'HOME TEAM',
    players: group.players.filter((player) => position === 'All' || player.position === position),
  })) : [];
  const visiblePlayerCount = teamGroups.reduce((total, group) => total + group.players.length, 0);

  return <div className="nfl-players-directory">
    <div className="nfl-directory-controls">
      <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players or teams" /></label>
      {game ? <NFLGameWheel games={nflGames} selectedGame={game} onSelect={setSelectedGameId} /> : <p className="nfl-empty-note">No NFL games are available.</p>}
    </div>
    {searchStatus && <p className="nfl-player-search-status" role="status">{searchStatus}</p>}
    <div className="nfl-directory-position-bar"><div className="sport-filter" role="tablist" aria-label="Filter players by position">{['All', 'QB', 'RB', 'WR', 'TE'].map((item) => <button key={item} role="tab" aria-selected={position === item} className={position === item ? 'active' : ''} onClick={() => setPosition(item)}>{item}</button>)}</div><span>{visiblePlayerCount} players with recent usage</span></div>
    {failed && <div className="feed-warning">Could not load this game’s players. Try selecting the game again later.</div>}
    {loading ? <div className="empty-games">Loading active rosters and recent player usage…</div> : <div className="nfl-directory-grid">{teamGroups.map((group) => <section className="nfl-directory-team" key={group.team.id}><header><TeamMark team={group.team} /><span><b>{group.team.name}</b><small>{group.side} · {group.team.record}</small></span>{game && <TeamFavoriteButton game={game} team={group.team} favorites={favorites} onToggleFavorite={onToggleFavorite} />}</header><div className="nfl-directory-player-list">{group.players.map((player) => <div className="nfl-directory-player" key={player.id}><button className="nfl-directory-player-main" aria-label={`View ${player.name} stats`} onClick={() => { setSelectedPlayer(player); setSelectedTeam(group.team); }}><span className="nfl-player-avatar">{player.headshot ? <img src={player.headshot} alt="" /> : player.name.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('')}</span><span><b>{player.name}</b><small>{player.position}{player.jersey && ` · #${player.jersey}`}</small></span></button><FavoriteStarButton favorite={favorites.some((favorite) => favorite.key === nflPlayerFavoriteTarget(player, group.team).key)} label={player.name} onClick={() => onToggleFavorite(nflPlayerFavoriteTarget(player, group.team))} /></div>)}</div>{group.players.length === 0 && <p className="nfl-empty-note">No players match these filters.</p>}</section>)}</div>}
    <p className="nfl-data-note">ESPN's public feed does not publish an official depth chart or fantasy projections. Players are selected from active rosters by recent usage: 1 QB, 2 RBs, 1 TE, and up to 4 WRs per team.</p>
    {selectedPlayer && selectedTeam && <NFLPlayerMiniWindow key={selectedPlayer.id} player={selectedPlayer} team={selectedTeam} isFavorite={favorites.some((favorite) => favorite.key === nflPlayerFavoriteTarget(selectedPlayer, selectedTeam).key)} onToggleFavorite={onToggleFavorite} onClose={() => { setSelectedPlayer(null); setSelectedTeam(null); }} />}
  </div>;
}

type MatchupPosition = 'QB' | 'RB' | 'WR' | 'TE';
type FavorableMatchup = {
  player: NFLSkillPlayer;
  team: Team;
  opponent: Team;
  game: Game;
  averageYards: number;
  gamesPlayed: number;
  yardsAllowed: number;
  defenseRank: number;
  difference: number;
};

const matchupPositions: MatchupPosition[] = ['QB', 'RB', 'WR', 'TE'];
const matchupStatByPosition: Record<MatchupPosition, { playerStat: NFLPlayerStatKey; defenseRankKey: 'passing' | 'rushing' | 'receiving'; yardsLabel: string; defenseLabel: string; title: string }> = {
  QB: { playerStat: 'passingYards', defenseRankKey: 'passing', yardsLabel: 'Pass yards', defenseLabel: 'Pass defense rank', title: 'Quarterbacks' },
  RB: { playerStat: 'rushingYards', defenseRankKey: 'rushing', yardsLabel: 'Rush yards', defenseLabel: 'Rush defense rank', title: 'Running backs' },
  WR: { playerStat: 'receivingYards', defenseRankKey: 'receiving', yardsLabel: 'Rec yards', defenseLabel: 'Receiving defense rank', title: 'Wide receivers' },
  TE: { playerStat: 'receivingYards', defenseRankKey: 'receiving', yardsLabel: 'Rec yards', defenseLabel: 'Receiving defense rank', title: 'Tight ends' },
};

function selectTopMatchups(matchups: FavorableMatchup[]) {
  const qualifyingMatchups = matchups.filter((matchup) => matchup.difference > 0);
  const percentileRanks = (metric: (matchup: FavorableMatchup) => number) => {
    const sorted = [...qualifyingMatchups].sort((first, second) => metric(first) - metric(second));
    return new Map(sorted.map((matchup, index) => [matchup, sorted.length < 2 ? 100 : index / (sorted.length - 1) * 100]));
  };
  const playerAverageRanks = percentileRanks((matchup) => matchup.averageYards);
  const weightedScore = (matchup: FavorableMatchup) => (playerAverageRanks.get(matchup) ?? 0) * 0.4
    + ((matchup.defenseRank - 1) / 31 * 100) * 0.6;
  const ranked = [...qualifyingMatchups].sort((first, second) => weightedScore(second) - weightedScore(first)
    || second.defenseRank - first.defenseRank);
  const preferred = ranked.filter((matchup) => matchup.defenseRank >= 26 && matchup.defenseRank <= 32);
  const fallback = ranked.filter((matchup) => matchup.defenseRank < 26 || matchup.defenseRank > 32);
  return [...preferred, ...fallback].slice(0, 4);
}

function NFLFavorableMatchups({ games }: { games: Game[] }) {
  const [matchups, setMatchups] = useState<Record<MatchupPosition, FavorableMatchup[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const allNFLGames = games.filter((game) => game.sport === 'Football');
  const weeklyGames = allNFLGames.filter((game) => game.status !== 'FINAL');
  const weeklyGameKey = allNFLGames.map((game) => `${game.id}:${game.status}`).sort().join('|');

  useEffect(() => {
    if (!weeklyGameKey) {
      setMatchups(null);
      setLoading(false);
      return;
    }
    let current = true;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setFailed(false);
      const results: Array<{ game: Game; details: NFLGameDetails } | null> = [];
      for (let start = 0; start < weeklyGames.length; start += 3) {
        const batch = await Promise.all(weeklyGames.slice(start, start + 3).map(async (game) => {
          try {
            const teams = [game.away, game.home].map((team) => ({ id: team.id, name: team.name }));
            const details = await fetchNFLGameDetails(game.feedPath, game.eventId, game.seasonYear, teams, controller.signal);
            return { game, details };
          } catch {
            return null;
          }
        }));
        results.push(...batch);
      }

      if (!current || controller.signal.aborted) return;
      const candidates: Record<MatchupPosition, FavorableMatchup[]> = { QB: [], RB: [], WR: [], TE: [] };
      results.forEach((result) => {
        if (!result) return;
        getNFLGamePlayerPools(result.game, result.details).forEach(({ team, players: teamPlayers }) => {
          const opponent = team.id === result.game.away.id ? result.game.home : result.game.away;
          const defenseForm = result.details.teamForms.find((form) => form.teamId === opponent.id);
          if (!defenseForm) return;
          teamPlayers.forEach((player) => {
            if (!matchupPositions.includes(player.position as MatchupPosition)) return;
            const position = player.position as MatchupPosition;
            const stat = matchupStatByPosition[position];
            const defenseRank = defenseForm.defenseRanks[stat.defenseRankKey];
            const yardsAllowed = position === 'QB'
              ? defenseForm.primaryPassingYardsAllowedPerGame
              : position === 'RB'
                ? defenseForm.primaryRushingYardsAllowedPerGame
                : position === 'TE'
                  ? defenseForm.primaryTightEndReceivingYardsAllowedPerGame
                  : defenseForm.primaryReceivingYardsAllowedPerGame;
              if (yardsAllowed === null || defenseRank === null) return;
            const playerYards = player.recentGames.flatMap((recentGame) => {
              const value = recentGame.stats[stat.playerStat];
              return value === undefined ? [] : [value];
            });
            if (playerYards.length < 3) return;
            const averageYards = playerYards.reduce((total, value) => total + value, 0) / playerYards.length;
            const difference = Number((Number(averageYards.toFixed(1)) - Number(yardsAllowed.toFixed(1))).toFixed(1));
            candidates[position].push({
              player,
              team,
              opponent,
              game: result.game,
              averageYards,
              gamesPlayed: playerYards.length,
              yardsAllowed,
              defenseRank,
              difference,
            });
          });
        });
      });
      setMatchups({ QB: selectTopMatchups(candidates.QB), RB: selectTopMatchups(candidates.RB), WR: selectTopMatchups(candidates.WR), TE: selectTopMatchups(candidates.TE) });
      setFailed(results.every((result) => result === null));
      setLoading(false);
    };

    void load();
    return () => {
      current = false;
      controller.abort();
    };
  }, [weeklyGameKey]);

  return <section className="favorable-matchups">
    <header className="favorable-matchups-heading"><div><span className="eyebrow">THIS WEEK · NFL</span><h2>Favorable matchups</h2><p>Only above-allowance players qualify. Defenses ranked 26–32 are prioritized; rankings weigh player averages 40% and defense rank 60%.</p></div>{matchups && <span className="favorable-matchups-count">{matchups.QB.length + matchups.RB.length + matchups.WR.length + matchups.TE.length} PLAYERS</span>}</header>
    {loading ? <p className="favorable-matchups-message">Comparing player averages with recent opponent allowances…</p> : failed ? <p className="favorable-matchups-message">Matchup data is unavailable right now. The list will retry when the weekly schedule refreshes.</p> : !matchups || !weeklyGameKey ? <p className="favorable-matchups-message">No upcoming NFL matchups are available.</p> : <div className="favorable-matchup-groups">{matchupPositions.map((position) => {
      const stat = matchupStatByPosition[position];
      const positionMatchups = matchups[position];
      return <section className="favorable-matchup-group" key={position}>
        <header><h3>{stat.title}</h3><span>{positionMatchups.length} / 4</span></header>
        {positionMatchups.length === 0 ? <p className="nfl-empty-note">No above-allowance players are available for this position this week.</p> : <div className="favorable-matchup-list">{positionMatchups.map((matchup, index) => <article className="favorable-matchup-item" key={`${matchup.player.id}:${matchup.game.id}`}>
          <div className="favorable-matchup-player"><span className="favorable-matchup-rank">{String(index + 1).padStart(2, '0')}</span><span className="nfl-player-avatar">{matchup.player.headshot ? <img src={matchup.player.headshot} alt="" /> : matchup.player.name.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('')}</span><span className="favorable-matchup-player-copy"><b>{matchup.player.name}</b><small>{matchup.team.abbr} · {matchup.team.name}</small><small>{matchup.team.id === matchup.game.home.id ? 'vs' : '@'} {matchup.opponent.abbr} · {formatGameTime(matchup.game)}</small></span></div>
          <div className="favorable-matchup-metrics"><div><b className="is-positive">{matchup.averageYards.toFixed(1)}</b><span>{stat.yardsLabel} / game</span><small>last {matchup.gamesPlayed} games</small></div><div><b>#{matchup.defenseRank}</b><span>{stat.defenseLabel}</span><small>{matchup.opponent.abbr} · NFL rank</small></div><div><b className="is-positive">+{matchup.difference.toFixed(1)}</b><span>Above allowed</span><small>yards / game</small></div></div>
        </article>)}</div>}
      </section>;
    })}</div>}
    <p className="nfl-data-note">ESPN season-to-date yards ranks use 26–32 as the preferred range. Player averages require at least three games and must exceed the recent allowance to that same position.</p>
  </section>;
}

function TheDen({ favorites, items, plays, livePlayerGames, loadingNews, onToggleFavorite }: { favorites: FavoriteTarget[]; items: DenItem[]; plays: DenPlayItem[]; livePlayerGames: number; loadingNews: boolean; onToggleFavorite: (favorite: FavoriteTarget) => void }) {
  const [denTab, setDenTab] = useState<'plays' | 'updates'>('plays');
  const [followingTab, setFollowingTab] = useState<'teams' | 'players'>('teams');
  const teamFavorites = favorites.filter((favorite) => favorite.type === 'team')
    .sort((first, second) => first.name.localeCompare(second.name, 'en', { sensitivity: 'base' }));
  const playerFavorites = favorites.filter((favorite) => favorite.type === 'player')
    .sort((first, second) => playerLastName(first.name).localeCompare(playerLastName(second.name), 'en', { sensitivity: 'base' })
      || first.name.localeCompare(second.name, 'en', { sensitivity: 'base' }));
  const visibleFavorites = followingTab === 'teams' ? teamFavorites : playerFavorites;
  const favoriteKeys = new Set(favorites.map((favorite) => favorite.key));
  const visibleItems = items.filter((item) => favoriteKeys.has(item.favoriteKey));
  const visiblePlays = plays.filter((play) => favoriteKeys.has(play.favoriteKey));
  const hasNFLFavorite = favorites.some((favorite) => favorite.feedPath === 'football/nfl' && (favorite.type === 'team' || favorite.type === 'player'));
  return <div className="den-layout">
    <aside className="den-favorites"><div className="panel-heading"><div><span className="eyebrow">YOUR LOCKER ROOM</span><h2>Following</h2></div><span className="den-favorite-count">{favorites.length}</span></div><div className="player-mode-tabs den-mode-tabs" role="tablist" aria-label="Following filter"><button id="den-following-teams-tab" role="tab" aria-controls="den-following-panel" aria-selected={followingTab === 'teams'} className={followingTab === 'teams' ? 'active' : ''} onClick={() => setFollowingTab('teams')}>Teams</button><button id="den-following-players-tab" role="tab" aria-controls="den-following-panel" aria-selected={followingTab === 'players'} className={followingTab === 'players' ? 'active' : ''} onClick={() => setFollowingTab('players')}>Players</button></div>{visibleFavorites.length ? <div className="den-favorite-list" id="den-following-panel" role="tabpanel" aria-labelledby={`den-following-${followingTab}-tab`}>{visibleFavorites.map((favorite) => <div className="den-favorite" key={favorite.key}><span className="den-favorite-avatar">{favorite.headshot ? <img src={favorite.headshot} alt="" /> : favorite.type === 'team' ? favorite.shortName : favorite.name.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('')}</span><span><b>{favorite.name}</b><small>{favorite.type === 'team' ? 'Team' : `${favorite.teamAbbr ?? ''}${favorite.position ? ` · ${favorite.position}` : 'Player'}`}</small></span><FavoriteStarButton favorite label={favorite.name} onClick={() => onToggleFavorite(favorite)} /></div>)}</div> : <p className="den-empty" id="den-following-panel" role="tabpanel" aria-labelledby={`den-following-${followingTab}-tab`}>{followingTab === 'teams' ? 'No favorite teams yet.' : 'No favorite players yet.'}</p>}</aside>
    <div className="den-activity-column">
      <div className="player-mode-tabs den-mode-tabs" role="tablist" aria-label="Den view">
        <button id="den-plays-tab" role="tab" aria-controls="den-plays-panel" aria-selected={denTab === 'plays'} className={denTab === 'plays' ? 'active' : ''} onClick={() => setDenTab('plays')}>Latest plays</button>
        <button id="den-updates-tab" role="tab" aria-controls="den-updates-panel" aria-selected={denTab === 'updates'} className={denTab === 'updates' ? 'active' : ''} onClick={() => setDenTab('updates')}>Latest updates</button>
      </div>
      {denTab === 'plays' ? <section className="den-timeline den-tab-panel" id="den-plays-panel" role="tabpanel" aria-labelledby="den-plays-tab"><div className="den-timeline-heading"><div><span className="eyebrow">{livePlayerGames ? 'LIVE NFL' : 'NFL PLAY WATCH'}</span><h2>Latest plays</h2></div><span className="den-refresh">{livePlayerGames ? 'Checks every 15 sec' : 'Waiting for a favorited team or player’s live game'}</span></div>{visiblePlays.length ? <div className="den-play-list">{visiblePlays.map((play) => <article className="den-play-item" key={play.id}><span className="den-play-avatar">{play.headshot ? <img src={play.headshot} alt="" /> : play.teamLogo ? <img src={play.teamLogo} alt="" /> : play.favoriteName.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('')}</span><div className="den-play-copy"><header><b>{play.favoriteName}</b><time>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(play.timestamp))}</time><span className="den-feed-type">{play.isDefensive ? 'DEFENSE' : play.isTouchdown ? 'TOUCHDOWN' : 'BIG PLAY'}</span></header><strong>{play.playLabel}</strong><p>{play.teamAbbr} vs {play.opponentAbbr} · {play.description}</p></div></article>)}</div> : <div className="den-plays-empty"><b>{hasNFLFavorite ? livePlayerGames ? 'No qualifying plays yet' : 'No favorited NFL team or player is in a live game' : 'Favorite an NFL team or player to follow their plays'}</b><p>Tracks offensive big plays and scores, plus defensive turnovers and scoring plays.</p></div>}</section> : <section className="den-timeline den-tab-panel" id="den-updates-panel" role="tabpanel" aria-labelledby="den-updates-tab"><div className="den-timeline-heading"><div><span className="eyebrow">YOUR LOCKER ROOM</span><h2>Latest updates</h2></div><span className="den-refresh">Scores check every 30 sec · News checks every 5 min</span></div>{favorites.length === 0 ? <div className="den-empty-main"><span className="den-empty-mark"><Star size={20} /></span><b>Your favorites live here</b><p>Follow a team or player and their score updates and related headlines will collect in this feed.</p></div> : visibleItems.length === 0 ? <div className="den-empty-main"><span className="live-indicator"><i /></span><b>{loadingNews ? 'Checking your favorite news…' : 'You’re all caught up'}</b><p>New score changes and matching headlines appear here as they arrive.</p></div> : <div className="den-feed-list">{visibleItems.map((item) => <article className="den-feed-item" key={item.id}>
        <div className="den-feed-marker">{item.kind === 'score' ? <Activity size={15} /> : <Star size={14} />}</div><div className="den-feed-content"><header><span>{item.favoriteName}</span><time>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(item.kind === 'news' ? item.published : item.timestamp))}</time><span className="den-feed-type">{item.kind === 'score' ? 'SCORE UPDATE' : 'NEWS'}</span></header>
          {item.kind === 'score' ? <div className="den-score-update"><div><TeamMark team={item.away} /><b>{item.away.abbr} {item.away.score}</b><TeamMark team={item.home} /><b>{item.home.abbr} {item.home.score}</b></div><p>{item.league} · {item.status === 'LIVE' ? `${item.period} ${item.clock}` : item.status === 'FINAL' ? 'Final' : 'Game update'}</p></div> : <div className="den-news-update">{item.image && <img src={item.image} alt="" />}{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.headline}</a> : <b>{item.headline}</b>}{item.description && <p>{item.description}</p>}</div>}
        </div>
      </article>)}</div>}</section>}
    </div>
  </div>;
}

function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const splashStartedAt = useRef<number | null>(Date.now());
  const [splashReplay, setSplashReplay] = useState(0);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [view, setView] = useState<'Scores' | 'Players' | 'Den' | 'Profile'>('Scores');
  const [profileReturnView, setProfileReturnView] = useState<'Scores' | 'Players' | 'Den'>('Scores');
  const [playerMode, setPlayerMode] = useState<'NFL' | 'Matchups'>('NFL');
  const [favorites, setFavorites] = useState<FavoriteTarget[]>(() => supabase ? [] : loadGuestFavorites());
  const [favoritesOwnerId, setFavoritesOwnerId] = useState<string | null>(null);
  const [favoriteSyncError, setFavoriteSyncError] = useState('');
  const [selectedNFLWeek, setSelectedNFLWeek] = useState<number | null>(null);
  const [currentNFLWeek, setCurrentNFLWeek] = useState<number | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const liveStripRef = useRef<HTMLElement | null>(null);
  const [loadingScores, setLoadingScores] = useState(true);
  const [failedLeagues, setFailedLeagues] = useState<string[]>([]);
  const [newsItems, setNewsItems] = useState<DenNewsFeedItem[]>([]);
  const [scoreUpdates, setScoreUpdates] = useState<DenScoreItem[]>([]);
  const [playUpdates, setPlayUpdates] = useState<DenPlayItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const previousGameStates = useRef(new Map<string, string>());
  const favoritesRef = useRef(favorites);
  const seenPlayIds = useRef(new Set<string>());
  const nflPlayFavorites = favorites.filter((favorite) => favorite.feedPath === 'football/nfl'
    && (favorite.type === 'team' || (favorite.type === 'player'
      && favorite.teamId
      && ['QB', 'RB', 'WR', 'TE'].includes(favorite.position ?? ''))));
  const favoriteTeamId = (favorite: FavoriteTarget) => favorite.type === 'team' ? favorite.id : favorite.teamId ?? '';
  const livePlayerGames = games.filter((game) => game.sport === 'Football'
    && game.status === 'LIVE'
    && nflPlayFavorites.some((favorite) => favoriteTeamId(favorite) === game.home.id || favoriteTeamId(favorite) === game.away.id));
  const livePlayGameKey = livePlayerGames.map((game) => game.eventId).sort().join('|');
  const nflPlayFavoritesKey = nflPlayFavorites.map((favorite) => favorite.key).sort().join('|');
  const playPollInputs = useRef({ games: livePlayerGames, favorites: nflPlayFavorites });
  playPollInputs.current = { games: livePlayerGames, favorites: nflPlayFavorites };

  useEffect(() => {
    if (authLoading) return undefined;
    if (supabase && !authUser) {
      setShowSplash(false);
      return undefined;
    }
    setShowSplash(true);
    const startedAt = splashStartedAt.current ?? Date.now();
    splashStartedAt.current = null;
    const timer = window.setTimeout(() => setShowSplash(false), Math.max(0, 1000 - (Date.now() - startedAt)));
    return () => window.clearTimeout(timer);
  }, [authLoading, authUser?.id, splashReplay]);

  const signedInRef = useRef(false);
  signedInRef.current = !supabase || Boolean(authUser);

  useEffect(() => {
    let hiddenAt: number | null = null;
    const replayAfterAbsence = () => {
      if (hiddenAt !== null && Date.now() - hiddenAt >= 5000 && signedInRef.current) {
        setSplashReplay((count) => count + 1);
      }
      hiddenAt = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else replayAfterAbsence();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') setRecoveringPassword(true);
      setAuthUser(session?.user ?? null);
      setAuthLoading(false);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setFavoriteSyncError('Could not restore your session. Please sign in again.');
      setAuthUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    if (!authUser) {
      setFavorites([]);
      setFavoritesOwnerId(null);
      return;
    }
    let active = true;
    setFavorites([]);
    setFavoritesOwnerId(null);
    setFavoriteSyncError('');
    void supabase.from('user_favorites').select('favorites').eq('user_id', authUser.id).maybeSingle().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setFavoriteSyncError('Could not load saved favorites. Check that the Supabase favorites table is set up.');
        return;
      }
      setFavorites(parseFavorites(data?.favorites));
      setFavoritesOwnerId(authUser.id);
    });
    return () => { active = false; };
  }, [authUser?.id]);

  useEffect(() => {
    if (!supabase || !authUser || favoritesOwnerId !== authUser.id) return;
    let active = true;
    void supabase.from('user_favorites').upsert({
      user_id: authUser.id,
      favorites,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).then(({ error }) => {
      if (!active) return;
      setFavoriteSyncError(error ? 'Your favorites could not be saved. Please check your connection.' : '');
    });
    return () => { active = false; };
  }, [authUser?.id, favorites, favoritesOwnerId]);

  useEffect(() => {
    favoritesRef.current = favorites;
    if (!supabase) localStorage.setItem(guestFavoriteStorageKey, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (!livePlayGameKey || !nflPlayFavoritesKey) return;
    let current = true;
    let refreshing = false;
    const controller = new AbortController();
    const refreshPlays = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const { games: liveGames, favorites: playerFavorites } = playPollInputs.current;
        const result = await fetchNFLFavoritePlays(liveGames, playerFavorites, controller.signal);
        if (!current || controller.signal.aborted) return;
        const unseen = result.filter((play) => !seenPlayIds.current.has(play.id));
        unseen.forEach((play) => seenPlayIds.current.add(play.id));
        if (unseen.length) {
          setPlayUpdates((previous) => [...unseen.map((play) => ({ ...play, kind: 'play' as const })), ...previous]
            .sort((first, second) => Date.parse(second.timestamp) - Date.parse(first.timestamp))
            .slice(0, 50));
        }
      } catch {
        if (controller.signal.aborted) return;
      } finally {
        refreshing = false;
      }
    };
    void refreshPlays();
    const refreshId = window.setInterval(() => void refreshPlays(), 15_000);
    return () => {
      current = false;
      controller.abort();
      window.clearInterval(refreshId);
    };
  }, [livePlayGameKey, nflPlayFavoritesKey]);

  const toggleFavorite = (favorite: FavoriteTarget) => {
    if (favorites.some((item) => item.key === favorite.key)) {
      setFavorites((current) => current.filter((item) => item.key !== favorite.key));
      return;
    }
    setFavorites((current) => [...current, favorite]);
    const matchingGames = games.filter((game) => game.status !== 'UPCOMING' && (
      game.feedPath === favorite.feedPath && (favorite.type === 'team'
        ? game.away.id === favorite.id || game.home.id === favorite.id
        : favorite.teamId === game.away.id || favorite.teamId === game.home.id)
    ));
    const snapshots: DenScoreItem[] = matchingGames.map((game) => ({
      id: `score:${game.id}:follow:${favorite.key}:${Date.now()}`,
      kind: 'score',
      favoriteKey: favorite.key,
      favoriteName: favorite.name,
      timestamp: new Date().toISOString(),
      league: game.league,
      away: game.away,
      home: game.home,
      status: game.status,
      period: game.period,
      clock: game.clock,
    }));
    if (snapshots.length) setScoreUpdates((current) => [...snapshots, ...current].slice(0, 100));
  };

  useEffect(() => {
    if (supabase && !authUser) {
      setGames([]);
      setFailedLeagues([]);
      setLoadingScores(false);
      return;
    }
    let current = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const result = await fetchScoreboards(controller.signal, selectedNFLWeek ?? undefined);
        if (!current) return;
        setCurrentNFLWeek(result.nflWeek);
        const changedItems: DenScoreItem[] = [];
        result.games.forEach((game) => {
          const previousState = previousGameStates.current.get(game.id);
          const nextState = `${game.away.score}:${game.home.score}:${game.status}:${game.period}:${game.clock}`;
          previousGameStates.current.set(game.id, nextState);
          if (!previousState || previousState === nextState) return;
          [game.away, game.home].forEach((team) => {
            const matchingFavorites = favoritesRef.current.filter((favorite) => favorite.type === 'team'
              ? favorite.key === teamFavoriteTarget(team, game.feedPath).key
              : favorite.teamId === team.id && favorite.feedPath === game.feedPath);
            matchingFavorites.forEach((favorite) => changedItems.push({
              id: `score:${game.id}:${nextState}:${favorite.key}`,
              kind: 'score',
              favoriteKey: favorite.key,
              favoriteName: favorite.name,
              timestamp: new Date().toISOString(),
              league: game.league,
              away: game.away,
              home: game.home,
              status: game.status,
              period: game.period,
              clock: game.clock,
            }));
          });
        });
        if (changedItems.length) setScoreUpdates((current) => [...changedItems, ...current].slice(0, 100));
        setGames(result.games);
        setFailedLeagues(result.failedLeagues);
        setLoadingScores(false);
        setSelectedGameId((previous) => result.games.some((game) => game.id === previous) ? previous : result.games[0]?.id ?? null);
      } catch {
        if (current && !controller.signal.aborted) {
          setFailedLeagues(['Scoreboards']);
          setLoadingScores(false);
        }
      }
    };

    void refresh();
    const refreshId = window.setInterval(() => void refresh(), 30_000);
    return () => {
      current = false;
      controller.abort();
      window.clearInterval(refreshId);
    };
  }, [authUser?.id, selectedNFLWeek]);

  useEffect(() => {
    if (favorites.length === 0) {
      setNewsItems([]);
      setLoadingNews(false);
      return;
    }
    let current = true;
    const controller = new AbortController();
    const refreshNews = async () => {
      setLoadingNews(true);
      try {
        const result = await fetchFavoriteNews(favorites, controller.signal);
        if (current) setNewsItems(result.map((item) => ({ ...item, kind: 'news' as const })));
      } catch {
        if (current && !controller.signal.aborted) setNewsItems([]);
      } finally {
        if (current) setLoadingNews(false);
      }
    };
    void refreshNews();
    const refreshId = window.setInterval(() => void refreshNews(), 5 * 60_000);
    return () => {
      current = false;
      controller.abort();
      window.clearInterval(refreshId);
    };
  }, [favorites]);

  const filteredGames = games;
  const selectedGame = filteredGames.find((game) => game.id === selectedGameId) ?? filteredGames[0] ?? null;
  const liveCount = games.filter((game) => game.status === 'LIVE').length;
  const scheduleWeek = selectedNFLWeek ?? currentNFLWeek;
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
  const denItems: DenItem[] = [...newsItems, ...scoreUpdates].sort((first, second) => Date.parse(second.kind === 'news' ? second.published : second.timestamp) - Date.parse(first.kind === 'news' ? first.published : first.timestamp));
  const displayName = typeof authUser?.user_metadata.display_name === 'string' ? authUser.user_metadata.display_name : authUser?.email ?? 'Account';
  const openProfile = () => {
    if (view !== 'Profile') setProfileReturnView(view);
    setView('Profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const selectGameAndReturnToTop = (gameId: string) => {
    setSelectedGameId(gameId);
    const liveStrip = liveStripRef.current;
    if (liveStrip) {
      window.scrollTo({ top: liveStrip.getBoundingClientRect().bottom + window.scrollY, behavior: 'smooth' });
    }
  };
  const openGamePlayers = (game: Game) => {
    setSelectedGameId(game.id);
    setPlayerMode('NFL');
    setView('Players');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (recoveringPassword && authUser) return <ResetPasswordScreen onDone={() => setRecoveringPassword(false)} />;
  if (showSplash || (supabase && authLoading)) return <SplashScreen />;
  if (supabase && !authUser) return <AuthScreen />;

  return (
    <div className="app-shell">
      <header className="topbar"><a className="brand" href="#scores" onClick={() => setView('Scores')}><img className="brand-logo" src={`${import.meta.env.BASE_URL}gamewire-mark.png`} alt="" /><span>GAMEWIRE</span></a><nav className="primary-nav" aria-label="Main navigation"><button className={view === 'Scores' ? 'active' : ''} onClick={() => setView('Scores')}>Scores</button><button className={view === 'Players' ? 'active' : ''} onClick={() => { setPlayerMode('NFL'); setView('Players'); }}>Players</button><button className={view === 'Den' ? 'active' : ''} onClick={() => setView('Den')}>Locker Room</button></nav><div className="topbar-right">{authUser ? <><button className={`account-profile-button${view === 'Profile' ? ' active' : ''}`} aria-label={`Open ${displayName} profile`} onClick={openProfile}>{displayName}</button><button className="sign-out-button" onClick={() => { void supabase?.auth.signOut(); }}><LogOut size={15} /><span>Sign out</span></button></> : <span className="edition-label">GUEST · THIS BROWSER</span>}</div></header>
      <main className={view === 'Players' ? 'page-wrap players-zoom' : 'page-wrap'}>
        <div className="page-heading"><div><div className="date-line"><span>{dateLabel}</span><span className="date-divider" /> <span>LOCAL GAME TIMES</span></div><h1>{view === 'Scores' ? 'The scoreboard' : view === 'Den' ? 'Locker Room' : view === 'Profile' ? 'Profile' : 'Player stats'}</h1><p>{view === 'Scores' ? 'Every game. Every moment. All in one place.' : view === 'Den' ? 'Your home for updates on the teams and players you follow.' : view === 'Profile' ? 'Manage your account details and security.' : 'The numbers behind the names.'}</p></div><div className="heading-actions">{view !== 'Profile' && <><span className={`feed-status${failedLeagues.length ? ' feed-status-warning' : ''}`}><i />{failedLeagues.length ? 'FEED ISSUE' : view === 'Den' ? 'LIVE FEED' : 'LIVE SCORES'}</span><label className="date-button"><Clock3 size={15} /><select aria-label="NFL week" value={selectedNFLWeek ?? 'current'} onChange={(event) => setSelectedNFLWeek(event.target.value === 'current' ? null : Number(event.target.value))}><option value="current">{currentNFLWeek ? `Current · Week ${currentNFLWeek}` : 'Current NFL week'}</option>{Array.from({ length: 18 }, (_, index) => index + 1).map((week) => <option key={week} value={week}>Week {week}</option>)}</select><ChevronRight size={14} /></label></>}</div></div>
        {favoriteSyncError && <div className="feed-warning" role="status">{favoriteSyncError}</div>}
        {view === 'Profile' ? authUser ? <ProfilePage user={authUser} onBack={() => { setView(profileReturnView); window.scrollTo({ top: 0, behavior: 'smooth' }); }} /> : <AuthScreen /> : view === 'Scores' ? <>
          <section className="live-strip" ref={liveStripRef}><div className="live-strip-title"><span className="live-indicator"><i /> LIVE</span><b>{liveCount} NFL games in progress</b></div><div className="ticker-games">{games.filter((game) => game.status === 'LIVE').map((game) => <button className="ticker-game" key={game.id} onClick={() => selectGameAndReturnToTop(game.id)}><span>{game.away.abbr} <b>{game.away.score}</b></span><span>{game.home.abbr} <b>{game.home.score}</b></span><small>{game.clock}</small></button>)}{liveCount === 0 && <span className="no-live-games">No NFL games live right now</span>}</div><button className="all-live" onClick={() => { const liveGame = games.find((game) => game.status === 'LIVE'); if (liveGame) selectGameAndReturnToTop(liveGame.id); }}>Open live game <ChevronRight size={15} /></button></section>
          {failedLeagues.length > 0 && <div className="feed-warning">Could not refresh {failedLeagues.join(', ')}. Available scores remain visible while those feeds retry.</div>}
          <div className="score-layout"><section className="scores-column"><div className="scores-heading"><div><span className="eyebrow">NFL · {scheduleWeek ? `WEEK ${scheduleWeek}` : 'CURRENT WEEK'}</span><h2>{scheduleWeek ? `Week ${scheduleWeek} games` : 'NFL games'} <span>{filteredGames.length}</span></h2></div><span className="refresh-label">Refreshes every 30 sec</span></div><div className="games-list">{filteredGames.map((game) => <GameCard key={game.id} game={game} selected={selectedGame?.id === game.id} onSelect={() => selectGameAndReturnToTop(game.id)} onOpenPlayers={() => openGamePlayers(game)} />)}{filteredGames.length === 0 && <div className="empty-games">{loadingScores ? 'Loading NFL games…' : failedLeagues.includes('NFL') ? 'NFL scoreboard is unavailable. Retrying automatically.' : `No NFL games scheduled for Week ${scheduleWeek ?? ''}.`}</div>}</div></section><aside className="detail-column">{selectedGame ? <GameCenter game={selectedGame} favorites={favorites} onToggleFavorite={toggleFavorite} onOpenPlayers={openGamePlayers} /> : <section className="panel empty-detail">Select an NFL game to open its game center.</section>}</aside></div>
        </> : view === 'Den' ? <TheDen favorites={favorites} items={denItems} plays={playUpdates} livePlayerGames={livePlayerGames.length} loadingNews={loadingNews} onToggleFavorite={toggleFavorite} /> : <><div className="player-mode-tabs" role="tablist" aria-label="Player view"><button role="tab" aria-selected={playerMode === 'NFL'} className={playerMode === 'NFL' ? 'active' : ''} onClick={() => setPlayerMode('NFL')}>NFL game players</button><button role="tab" aria-selected={playerMode === 'Matchups'} className={playerMode === 'Matchups' ? 'active' : ''} onClick={() => setPlayerMode('Matchups')}>Favorable matchups</button></div>{playerMode === 'NFL' ? <NFLPlayersDirectory games={games} favorites={favorites} onToggleFavorite={toggleFavorite} initialGameId={selectedGameId} /> : <NFLFavorableMatchups games={games} />}</>}
        <footer className="page-footer"><span>GAMEWIRE <i>·</i> NFL IN FOCUS</span><span>NFL scores, player stats, and matchups from ESPN public feeds.</span></footer>
      </main>
    </div>
  );
}

export default App;
