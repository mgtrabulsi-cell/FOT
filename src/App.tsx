import OfflineImage from './OfflineImage';
import FantasyStartSit from './FantasyStartSit';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  Activity,
  ChartColumn,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  LogOut,
  Star,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { fetchFavoriteNews, fetchNFLFavoritePlays, fetchNFLGameDetails, fetchNFLNotificationGame, fetchScoreboards, findFeaturedNFLGame, findNFLTeamsForPlayerSearch, getPrimetimeLabel, getTuesdayCutoff, isPastTuesdayCutoff } from './services/sportsData';
import { readGameDetailsSnapshot, readRenderSnapshot, saveRenderSnapshot } from './services/renderSnapshots';
import { fetchLivewirePosts, livewireSnapshot } from './services/livewirePosts';
import type { FavoriteTarget, Game, NFLGameDetails, NFLPlayerStatKey, NFLSkillPlayer, Team } from './services/sportsData';
import { useLockerRoomHistory } from './useLockerRoomHistory';
import { useSiteOpenTracking } from './useSiteOpenTracking';
import NotificationOnboarding from './NotificationOnboarding';
import type { DenItem, DenNewsFeedItem, DenPlayItem, DenScoreItem, PlayerHistory } from './useLockerRoomHistory';
import AuthScreen, { ResetPasswordScreen } from './AuthScreen';
import AccountRequired from './AccountRequired';
import SplashScreen from './SplashScreen';
import PullToRefresh from './PullToRefresh';
import BannerSearch from './BannerSearch';
import PrimaryNavigation from './PrimaryNavigation';
import { useLivewireUnread } from './useLivewireUnread';
import { useAnalystUnread } from './useAnalystUnread';
import ProfilePage from './ProfilePage';
import TheWire from './TheWire';
import NBAExperience from './NBAExperience';
import DraggableTabs from './DraggableTabs';
import { preloadNBABoxes, preloadNBADates, preloadNBAPregame } from './services/nbaPreload';
import { preloadNFLLiveBoxes } from './services/nflBoxPreload';
import type { NBAPlayerStatKey } from './services/nbaData';
import { fetchNBAScoreboard, nbaCalendarDate, shiftNBACalendarDate } from './services/sportsData';
import LiveWire from './LiveWire';
import FavorableMatchups from './FavorableMatchups';
import TheAngle from './TheAngle';
import OurResults from './OurResults';
import { useSwipeBack } from './useSwipeBack';
import { useOnlineStatus } from './OfflineStatus';
import { useOfflineSnapshots } from './useOfflineSnapshots';
import { usePublicDataRevision } from './usePublicDataRevision';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';
import { completedScoreUpdates } from './services/lockerRoomScores';
import { publicSupabaseConfig, supabase } from './services/supabaseClient';
import { nflFieldPosition } from './services/nflSituation.ts';
import { connectMedianNavigation, hashForView, nbaNotificationFromHash, viewFromHash } from './services/medianNavigation';
import type { AppView } from './services/medianNavigation';


const guestFavoriteStorageKey = 'fieldhouse:favorites:v1';
const lockerRoomScoresStorageKey = 'gamewire:locker:scores:v1';
const lockerRoomPlaysStorageKey = 'gamewire:locker:plays:v1';

function loadStoredLockerRoomUpdates<T extends { timestamp: string }>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = getTuesdayCutoff();
    return parsed.filter((item): item is T => {
      const time = Date.parse(item?.timestamp);
      return Number.isFinite(time) && time >= cutoff;
    });
  } catch {
    return [];
  }
}

function parseFavorites(value: unknown): FavoriteTarget[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FavoriteTarget => item
    && typeof item.key === 'string'
    && typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.feedPath === 'string'
    && (item.type === 'team' || item.type === 'player'));
}

function topNFLFavoriteTeamId(favorites: FavoriteTarget[]) {
  return favorites.find((favorite) => favorite.type === 'team' && favorite.feedPath === 'football/nfl')?.id ?? null;
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
  return <span className={`team-mark${large ? ' team-mark-large' : ''}`} style={{ '--team-color': team.color } as React.CSSProperties}>{team.logo ? <OfflineImage src={team.logo} alt="" /> : team.abbr.slice(0, 2)}</span>;
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

function NFLGameWheel({ games, selectedGame, onSelect }: { games: Game[]; selectedGame: Game; onSelect: (gameId: string) => void }) {
  const options = games.map((game) => ({
    key: game.id,
    label: `${game.away.abbr}${game.status === 'LIVE' && game.situation?.possessionTeamId === game.away.id ? ' 🏈' : ''} @ ${game.home.abbr}${game.status === 'LIVE' && game.situation?.possessionTeamId === game.home.id ? ' 🏈' : ''}`,
    primetime: getPrimetimeLabel(game),
    secondary: `${game.status === 'LIVE' ? 'LIVE · ' : ''}${formatGameTime(game)}`,
  }));
  return <section className="nfl-game-wheel" data-swipe-back-ignore><span className="eyebrow">SELECT GAME</span><DraggableTabs options={options} ariaLabel="NFL games" className="nfl-game-wheel-tabs" selected={selectedGame.id} onSelect={onSelect} /></section>;
}

function getNFLPlayerStatValue(stats: Partial<Record<NFLPlayerStatKey, number>>, key: NFLPlayerStatKey) {
  if (key !== 'rushingReceivingTouchdowns') return stats[key];
  const rushing = stats.rushingTouchdowns;
  const receiving = stats.receivingTouchdowns;
  return rushing === undefined && receiving === undefined ? undefined : (rushing ?? 0) + (receiving ?? 0);
}

function NFLPlayerMiniWindow({ player, team, isFavorite, onToggleFavorite, onClose }: { player: NFLSkillPlayer; team: Team; isFavorite: boolean; onToggleFavorite: (favorite: FavoriteTarget) => void; onClose: () => void }) {
  const dialogRef = useSwipeBack<HTMLElement>(onClose);
  useEffect(() => {
    const trigger = document.activeElement;
    dialogRef.current?.focus();
    return () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
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
      { key: 'targets', label: 'Targets' },
      { key: 'receivingYards', label: 'Rec yards' },
      { key: 'rushingReceivingTouchdowns', label: 'Rushing + Receiving TD' },
      { key: 'rushingYards', label: 'Rush yards' },
      { key: 'totalYards', label: 'Total yards' },
    ],
    TE: [
      { key: 'receptions', label: 'Receptions' },
      { key: 'targets', label: 'Targets' },
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
    <section ref={dialogRef} tabIndex={-1} className="nfl-player-dialog" role="dialog" aria-modal="true" aria-labelledby="nfl-player-dialog-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <header className="nfl-player-dialog-heading"><span className="nfl-player-avatar nfl-player-avatar-large">{player.headshot ? <OfflineImage src={player.headshot} alt="" /> : player.name.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('')}</span><div><span className="eyebrow">{team.abbr} · RECENT PERFORMANCE</span><h3 id="nfl-player-dialog-title">{player.name}</h3><small>{player.position}{player.jersey && ` · #${player.jersey}`}</small></div><FavoriteStarButton favorite={isFavorite} label={player.name} onClick={() => onToggleFavorite(nflPlayerFavoriteTarget(player, team))} /><button className="icon-button" aria-label="Close player stats" onClick={onClose}><X size={16} /></button></header>
      <div className="nfl-player-stat-picker"><span className="nfl-player-stat-label">GAME STAT</span><DraggableTabs options={options} ariaLabel={`${player.position} game stats`} className="nfl-player-stat-tabs" selected={selectedStat} onSelect={setSelectedStat} /></div>
      <div className="nfl-game-chart-heading"><b>{selectedOption.label} · EACH GAME</b><span>LAST {playerGames.length || 5} GAMES</span></div>
      {playerGames.length === 0 ? <p className="nfl-player-games-message">Game-by-game stats are unavailable from the feed.</p> : <div className="nfl-player-game-chart">{[...playerGames].reverse().map((game) => { const value = getNFLPlayerStatValue(game.stats, selectedStat); const barHeight = value === undefined ? 0 : Math.max(5, value / maximumValue * 100); return <div className="nfl-game-bar" key={game.gameId} aria-label={`${game.opponent}, ${selectedOption.label}: ${value ?? 'unavailable'}`}><strong className="nfl-game-bar-value">{value === undefined ? '—' : value.toLocaleString('en-US')}</strong><div className="nfl-game-bar-track"><i style={{ height: `${barHeight}%` }} /></div><b title={game.opponent}>{game.opponentAbbreviation}</b><small>{formatNFLDate(game.date)}</small><span className={`nfl-game-result${game.result === 'W' ? ' is-win' : game.result === 'L' ? ' is-loss' : ''}`}>{game.result || '—'}</span></div>; })}</div>}
      <p className="nfl-data-note">Game values are read from each game's box score. Missing entries are not estimated.</p>
    </section>
  </div>;
}

function formatNFLDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed);
}

function NFLPlayersDirectory({ games, scoreboardStatus = 'ready', query, favorites, onToggleFavorite, initialGameId }: { games: Game[]; scoreboardStatus?: 'loading' | 'ready' | 'error'; query: string; favorites: FavoriteTarget[]; onToggleFavorite: (favorite: FavoriteTarget) => void; initialGameId: string | null }) {
  const dataRevision = usePublicDataRevision('sports');
  const detailsGame = useRef<string | null>(null);
  const nflGames = games.filter((game) => game.sport === 'Football');
  const [selectedGameId, setSelectedGameId] = useState(initialGameId && nflGames.some((game) => game.id === initialGameId) ? initialGameId : nflGames[0]?.id ?? '');
  const [loadedDetails, setDetails] = useState<NFLGameDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState('All');
  const [searchStatus, setSearchStatus] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<NFLSkillPlayer | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const game = nflGames.find((item) => item.id === selectedGameId) ?? nflGames[0];
  const savedDetails = useMemo(() => game
    ? readGameDetailsSnapshot(game.feedPath, game.eventId, game.seasonYear, [game.away.id, game.home.id])
    : null, [game?.id, game?.seasonYear, dataRevision]);
  const details = detailsGame.current === game?.id ? loadedDetails ?? savedDetails : savedDetails;
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
    setSelectedPlayer(null);
    setSelectedTeam(null);
  }, [gameId]);

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
        if (details && result.teamForms.some((team) => !team.skillPlayers.length)) {
          throw new Error('The roster refresh is incomplete; retaining saved players.');
        }
        if (current) {
          setDetails(result);
          detailsGame.current = gameId;
          setFailed(false);
          setLoading(false);
        }
      } catch (error) {
        if (current && !controller.signal.aborted) {
          console.error('Could not refresh player directory', error);
          setFailed(true);
          setLoading(false);
        }
      }
    };

    if (detailsGame.current !== gameId) {
      setDetails(null);
      setLoading(true);
    }
    void load();
    return () => {
      current = false;
      controller.abort();
    };
  }, [gameId, feedPath, eventId, seasonYear, homeTeamId, homeTeamName, awayTeamId, awayTeamName, dataRevision]);

  const teamGroups = game ? getNFLGamePlayerPools(game, details).map((group, index) => ({
    ...group,
    side: index === 0 ? 'AWAY TEAM' : 'HOME TEAM',
    players: group.players.filter((player) => position === 'All' || player.position === position),
  })) : [];
  const visiblePlayerCount = teamGroups.reduce((total, group) => total + group.players.length, 0);
  const isLiveGame = game?.status === 'LIVE';

  return <div className="nfl-players-directory">
    <div className="nfl-directory-controls">
      {game ? <NFLGameWheel games={nflGames} selectedGame={game} onSelect={setSelectedGameId} /> : <p className="nfl-empty-note" role="status">{scoreboardStatus === 'ready' ? 'No NFL games are available.' : scoreboardStatus === 'error' ? 'Can\u2019t reach live scores right now. Retrying automatically\u2026' : 'Loading this week\u2019s games\u2026'}</p>}
    </div>
    {isLiveGame && <p className="nfl-field-position">{nflFieldPosition(game.situation)}</p>}
    {searchStatus && <p className="nfl-player-search-status" role="status">{searchStatus}</p>}
    <div className="nfl-directory-position-bar"><div className="sport-filter" role="tablist" aria-label="Filter players by position">{['All', 'QB', 'RB', 'WR', 'TE'].map((item) => <button key={item} role="tab" aria-selected={position === item} className={position === item ? 'active' : ''} onClick={() => setPosition(item)}>{item}</button>)}</div>{isLiveGame ? <span className="live-clock">LIVE</span> : <span>{visiblePlayerCount} active players</span>}</div>
    {failed && <div className="feed-warning">Could not load this game’s players. Try selecting the game again later.</div>}
    {loading && !details ? <div className="empty-games">Loading active rosters and recent player usage…</div> : <div className="nfl-directory-grid">{teamGroups.map((group) => <section className="nfl-directory-team" key={group.team.id}><header><TeamMark team={group.team} /><span><b>{group.team.name}</b><small>{group.side} · {group.team.record}</small></span>{game && <TeamFavoriteButton game={game} team={group.team} favorites={favorites} onToggleFavorite={onToggleFavorite} />}</header><div className="nfl-directory-player-list">{group.players.map((player) => <div className="nfl-directory-player" key={player.id}><button className="nfl-directory-player-main" aria-label={`View ${player.name} stats`} onClick={() => { setSelectedPlayer(player); setSelectedTeam(group.team); }}><span className="nfl-player-avatar">{player.headshot ? <OfflineImage src={player.headshot} alt="" /> : player.name.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('')}</span><span><b>{player.name}</b><small>{player.position}{player.jersey && ` · #${player.jersey}`}</small></span></button><FavoriteStarButton favorite={favorites.some((favorite) => favorite.key === nflPlayerFavoriteTarget(player, group.team).key)} label={player.name} onClick={() => onToggleFavorite(nflPlayerFavoriteTarget(player, group.team))} /></div>)}</div>{group.players.length === 0 && <p className="nfl-empty-note">No players match these filters.</p>}</section>)}</div>}
    <p className="nfl-data-note">The public data feed does not publish an official depth chart or fantasy projections. Players are selected from active rosters by recent usage: 1 QB, 2 RBs, 1 TE, and up to 4 WRs per team.</p>
    {selectedPlayer && selectedTeam && <NFLPlayerMiniWindow key={selectedPlayer.id} player={selectedPlayer} team={selectedTeam} isFavorite={favorites.some((favorite) => favorite.key === nflPlayerFavoriteTarget(selectedPlayer, selectedTeam).key)} onToggleFavorite={onToggleFavorite} onClose={() => { setSelectedPlayer(null); setSelectedTeam(null); }} />}
  </div>;
}

function LockerRoomPlayerStats({ favorite, game, stats, live = game.status === 'LIVE' }: { favorite: FavoriteTarget; game: Game; stats?: Partial<Record<NFLPlayerStatKey | NBAPlayerStatKey, number>>; live?: boolean }) {
  const value = (key: NFLPlayerStatKey | NBAPlayerStatKey) => stats?.[key]?.toLocaleString('en-US') ?? '—';
  const metrics = game.league === 'NBA'
    ? [{ label: 'PTS', value: value('points') }, { label: 'REB', value: value('rebounds') }, { label: 'AST', value: value('assists') }]
    : favorite.position === 'QB'
    ? [
      { label: 'CMP/ATT', value: `${value('completions')}/${value('attempts')}` },
      { label: 'PASS YDS', value: value('passingYards') },
      { label: 'TD', value: value('passingTouchdowns') },
      { label: 'INT', value: value('interceptions') },
    ]
    : favorite.position === 'RB'
      ? [
        { label: 'RUSHES', value: value('carries') },
        { label: 'RUSH YDS', value: value('rushingYards') },
        { label: 'TD', value: value('rushingTouchdowns') },
      ]
      : [
        { label: 'REC/TGT', value: `${value('receptions')}/${value('targets')}` },
        { label: 'REC YDS', value: value('receivingYards') },
        { label: 'TD', value: value('receivingTouchdowns') },
      ];
  return <div className="den-player-live">
    <div className="den-player-live-heading"><b>{game.status === 'FINAL' ? 'FINAL' : live ? 'LIVE' : 'SAVED'}</b><span>{game.away.abbr} @ {game.home.abbr} · {game.status === 'FINAL' ? 'Final game stats' : live ? `${game.period} ${game.clock}` : 'Last saved live snapshot'}</span></div>
    {stats && Object.keys(stats).length > 0 ? <dl className="den-player-stat-row">{metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl> : <p>No player stats reported yet.</p>}
  </div>;
}

function TheDen({ favorites, games, items, plays, playerHistory, week, season, historyLoading, historyError, signedIn, onRetryHistory, livePlayerGames, loadingNews, onToggleFavorite, onMoveTeamFavorite, league = 'NFL', activityDate }: { favorites: FavoriteTarget[]; games: Game[]; items: DenItem[]; plays: DenPlayItem[]; playerHistory: PlayerHistory[]; week: number | null; season: number | null; historyLoading: boolean; historyError: string; signedIn: boolean; onRetryHistory: () => void; livePlayerGames: number; loadingNews: boolean; onToggleFavorite: (favorite: FavoriteTarget) => void; onMoveTeamFavorite: (favoriteKey: string, direction: -1 | 1) => void; league?: 'NFL' | 'NBA'; activityDate?: string }) {
  const [denTab, setDenTab] = useState<'plays' | 'updates'>('plays');
  const [followingTab, setFollowingTab] = useState<'teams' | 'players'>('teams');
  const [followingPosition, setFollowingPosition] = useState('All');
  const teamFavorites = favorites.filter((favorite) => favorite.type === 'team');
  const weekFavorites = new Map(favorites.map((favorite) => [favorite.key, favorite]));
  playerHistory.forEach(({ favorite }) => { if (!weekFavorites.has(favorite.key)) weekFavorites.set(favorite.key, favorite); });
  const playerFavorites = [...weekFavorites.values()].filter((favorite) => favorite.type === 'player')
    .sort((first, second) => playerLastName(first.name).localeCompare(playerLastName(second.name), 'en', { sensitivity: 'base' })
      || first.name.localeCompare(second.name, 'en', { sensitivity: 'base' }));
  const playerPosition = (favorite: FavoriteTarget) => favorite.position?.trim().toUpperCase() || 'Unknown';
  const followingPositions = [...new Set([...(league === 'NBA' ? ['PG', 'SG', 'SF', 'PF', 'C'] : ['QB', 'RB', 'WR', 'TE']), ...playerFavorites.map(playerPosition)])];
  const visibleFavorites = followingTab === 'teams' ? teamFavorites
    : playerFavorites.filter((favorite) => followingPosition === 'All' || playerPosition(favorite) === followingPosition);
  const visibleItems = items;
  const visiblePlays = plays;
  const hasNFLFavorite = favorites.some((favorite) => favorite.feedPath === (league === 'NBA' ? 'basketball/nba' : 'football/nfl'));
  return <><div className="den-week-summary" role="status"><b>{league === 'NBA' ? `NBA · ${activityDate}` : season && week ? `${season} · Week ${week}` : 'Loading NFL week…'}</b><span>{historyLoading ? 'Loading saved history…' : signedIn ? 'Account-backed history' : 'Sign in to keep history across devices.'}</span>{historyError && <p>{historyError} <button onClick={onRetryHistory}>Retry</button></p>}</div><div className="den-layout">
    <aside className="den-favorites"><div className="panel-heading"><div><span className="eyebrow">YOUR LOCKER ROOM</span><h2>Following</h2></div><span className="den-favorite-count">{weekFavorites.size}</span></div><div className="player-mode-tabs den-mode-tabs" role="tablist" aria-label="Following filter"><button id="den-following-teams-tab" role="tab" aria-controls="den-following-panel" aria-selected={followingTab === 'teams'} className={followingTab === 'teams' ? 'active' : ''} onClick={() => setFollowingTab('teams')}>Teams</button><button id="den-following-players-tab" role="tab" aria-controls="den-following-panel" aria-selected={followingTab === 'players'} className={followingTab === 'players' ? 'active' : ''} onClick={() => setFollowingTab('players')}>Players</button></div>
    {followingTab === 'players' && <div className="den-position-filter" role="group" aria-label="Filter followed players by position">{['All', ...followingPositions].map((position) => <button type="button" key={position} aria-pressed={followingPosition === position} onClick={() => setFollowingPosition(followingPosition === position ? 'All' : position)}>{position}</button>)}</div>}
    {followingTab === 'teams' && teamFavorites.length > 0 && <p className="den-favorite-order-help">First team is featured on The Wire.</p>}{visibleFavorites.length ? <div className="den-favorite-list" id="den-following-panel" role="tabpanel" aria-labelledby={`den-following-${followingTab}-tab`}>{visibleFavorites.map((favorite, index) => {
      const savedGames = playerHistory.filter((entry) => entry.favorite.key === favorite.key);
      const activeGame = favorite.type === 'player'
        ? games.find((game) => game.feedPath === favorite.feedPath && game.status !== 'UPCOMING' && (game.away.id === favorite.teamId || game.home.id === favorite.teamId))
        : undefined;
      return <div className="den-favorite" key={favorite.key}><span className="den-favorite-avatar">{favorite.headshot ? <OfflineImage src={favorite.headshot} alt="" /> : favorite.type === 'team' ? favorite.shortName : favorite.name.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('')}</span><span><b>{favorite.name}</b><small>{favorite.type === 'team' ? index === 0 ? 'Featured · Team' : 'Team' : `${favorite.teamAbbr ?? ''}${favorite.position ? ` · ${favorite.position}` : 'Player'}`}</small></span>{followingTab === 'teams' && <span className="den-favorite-order"><button type="button" aria-label={`Move ${favorite.name} up in favorite teams`} title="Move up" disabled={index === 0} onClick={() => onMoveTeamFavorite(favorite.key, -1)}><ChevronUp size={14} /></button><button type="button" aria-label={`Move ${favorite.name} down in favorite teams`} title="Move down" disabled={index === teamFavorites.length - 1} onClick={() => onMoveTeamFavorite(favorite.key, 1)}><ChevronDown size={14} /></button></span>}<FavoriteStarButton favorite={favorites.some((item) => item.key === favorite.key)} label={favorite.name} onClick={() => onToggleFavorite(favorite)} />{savedGames.map((entry) => <LockerRoomPlayerStats key={entry.game.id} favorite={favorite} game={entry.game} stats={entry.stats} live={games.some((game) => game.id === entry.game.id && game.status === 'LIVE')} />)}{!savedGames.length && activeGame && <LockerRoomPlayerStats favorite={favorite} game={activeGame} />}</div>;
    })}</div> : <p className="den-empty" id="den-following-panel" role="tabpanel" aria-labelledby={`den-following-${followingTab}-tab`}>{followingTab === 'teams' ? 'No favorite teams yet.' : followingPosition === 'All' ? 'No favorite players yet.' : `No followed players at ${followingPosition === 'Unknown' ? 'an unknown position' : followingPosition}. Select All to see every player.`}</p>}</aside>
    <div className="den-activity-column">
      <div className="player-mode-tabs den-mode-tabs" role="tablist" aria-label="Den view">
        <button id="den-plays-tab" role="tab" aria-controls="den-plays-panel" aria-selected={denTab === 'plays'} className={denTab === 'plays' ? 'active' : ''} onClick={() => setDenTab('plays')}>Latest plays</button>
        <button id="den-updates-tab" role="tab" aria-controls="den-updates-panel" aria-selected={denTab === 'updates'} className={denTab === 'updates' ? 'active' : ''} onClick={() => setDenTab('updates')}>Latest updates</button>
      </div>
      {denTab === 'plays' ? <section className="den-timeline den-tab-panel" id="den-plays-panel" role="tabpanel" aria-labelledby="den-plays-tab">
        <div className="den-timeline-heading"><div><span className="eyebrow">{livePlayerGames ? `LIVE ${league}` : `${league} PLAY WATCH`}</span><h2>Latest plays</h2></div><span className="den-refresh">{league === 'NBA' ? 'Checks live games every 15 sec · Saved by date' : livePlayerGames ? 'Checks every 15 sec · Saved by week' : 'Saved for the selected NFL week'}</span></div>
        {visiblePlays.length ? <div className="den-play-list">{visiblePlays.map((play) => <article className="den-play-item" key={play.id}>
          <span className="den-play-avatar">{play.headshot ? <OfflineImage src={play.headshot} alt="" /> : play.teamLogo ? <OfflineImage src={play.teamLogo} alt="" /> : play.favoriteName.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('')}</span>
          <div className="den-play-copy"><header><b>{play.favoriteName}</b><time>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(play.timestamp))}</time><span className="den-feed-type">{league === 'NBA' ? 'SCORING PLAY' : play.isDefensive ? 'DEFENSE' : play.isTouchdown ? 'TOUCHDOWN' : 'BIG PLAY'}</span></header><strong>{play.playLabel}</strong><p>{play.teamAbbr} vs {play.opponentAbbr} · {play.description}</p></div>
        </article>)}</div> : <div className="den-plays-empty"><b>{hasNFLFavorite ? (livePlayerGames ? 'No qualifying plays yet' : 'No qualifying plays for your favorites in this period yet') : `Favorite an ${league} team or player to follow their plays`}</b><p>{league === 'NBA' ? '        Tracks reported NBA scoring plays for favorite teams and players. Updates are saved by NBA date. Push quarter updates follow favorite NBA teams only; NBA highlights cover any player.' : 'Tracks offensive big plays and scores, plus defensive turnovers and scoring plays. Updates are saved by NFL week.'}</p></div>}
      </section> : <section className="den-timeline den-tab-panel" id="den-updates-panel" role="tabpanel" aria-labelledby="den-updates-tab"><div className="den-timeline-heading"><div><span className="eyebrow">YOUR LOCKER ROOM</span><h2>Latest updates</h2></div><span className="den-refresh">{league === 'NBA' ? 'Live game stats every 15 sec · Saved by date' : 'Scores check every 30 sec · Saved by week'}</span></div>{favorites.length === 0 && visibleItems.length === 0 ? <div className="den-empty-main"><span className="den-empty-mark"><Star size={20} /></span><b>Your favorites live here</b><p>Follow a team or player and their score updates and related headlines will collect in this feed.</p></div> : visibleItems.length === 0 ? <div className="den-empty-main"><span className="live-indicator"><i /></span><b>{loadingNews ? 'Checking your favorite news…' : 'You’re all caught up'}</b><p>Score changes and matching headlines collected for this period appear here. Saved updates remain available when you revisit the period.</p></div> : <div className="den-feed-list">{visibleItems.map((item) => <article className="den-feed-item" key={`${item.id}:${item.favoriteKey}`}>
        <div className="den-feed-marker">{item.kind === 'score' ? <Activity size={15} /> : <Star size={14} />}</div><div className="den-feed-content"><header><span>{item.favoriteName}</span><time>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(item.kind === 'news' ? item.published : item.timestamp))}</time><span className="den-feed-type">{item.kind === 'score' ? 'SCORE UPDATE' : 'NEWS'}</span></header>
          {item.kind === 'score' ? <div className="den-score-update"><div><TeamMark team={item.away} /><b>{item.away.abbr} {item.away.score}</b><TeamMark team={item.home} /><b>{item.home.abbr} {item.home.score}</b></div><p>{item.league} · {item.status === 'LIVE' ? `${item.period} ${item.clock}` : item.status === 'FINAL' ? 'Final' : 'Game update'}</p></div> : <div className="den-news-update">{item.image && <OfflineImage src={item.image} alt="" />}{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.headline}</a> : <b>{item.headline}</b>}{item.description && <p>{item.description}</p>}</div>}
        </div>
      </article>)}</div>}</section>}
    </div>
  </div></>;
}

function App() {
  const scoreboardRevision = usePublicDataRevision('scoreboard');
  const newsRevision = usePublicDataRevision('news');
  const [deletedAccount, setDeletedAccount] = useState<string[] | null>(null);
  const online = useOnlineStatus();
  const [sessionUser, setAuthUser] = useState<User | null>(null);
  const authUser = online ? sessionUser : null;
  const [authLoading, setAuthLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const splashStartedAt = useRef<number | null>(Date.now());
  const [splashReplay, setSplashReplay] = useState(0);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [savedGuestMode, setGuestMode] = useState(() => localStorage.getItem('gamewire-guest-mode') === 'true');
  const guestMode = savedGuestMode || !online;
  const livewireUnread = useLivewireUnread(authUser?.id ?? null, deletedAccount === null && !authLoading && !!authUser);
  const [notificationHash, setNotificationHash] = useState(window.location.hash);
  const [storyOpenKey, setStoryOpenKey] = useState(0);
  const [view, setView] = useState<AppView>(() => viewFromHash(window.location.hash) ?? 'Wire');
  const [sportLeague, setSportLeague] = useState<'NFL' | 'NBA'>('NFL');
  const [selectedNBADate, setSelectedNBADate] = useState(nbaCalendarDate);
  const [nbaDateOverride, setNBADateOverride] = useState(false);
  const [nbaSelectedGameId, setNBASelectedGameId] = useState<string | null>(null);
  const [loadedNBAGames, setNBAGames] = useState<Game[]>(() => readRenderSnapshot('scoreboard', `NBA:${nbaCalendarDate()}`)?.games ?? []);
  const [nbaGamesDate, setNBAGamesDate] = useState(nbaCalendarDate);
  const savedNBADateGames = useMemo(() => readRenderSnapshot('scoreboard', `NBA:${selectedNBADate}`)?.games ?? [], [selectedNBADate]);
  const nbaGames = nbaGamesDate === selectedNBADate ? loadedNBAGames : savedNBADateGames;
  const [nbaStatus, setNBAStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [nbaError, setNBAError] = useState('');
  const [nbaRetry, setNBARetry] = useState(0);
  useEffect(() => subscribeForegroundRefresh(() => {
    if (!nbaDateOverride) setSelectedNBADate(nbaCalendarDate());
    setNBARetry((value) => value + 1);
  }), [nbaDateOverride]);
  const warmNBA = !window.matchMedia('(max-width: 760px)').matches || sportLeague === 'NBA';
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let refreshing = false;
    let preloadingBoxes = false;
    const saved = readRenderSnapshot('scoreboard', `NBA:${selectedNBADate}`)?.games ?? [];
    setNBAGames(saved); setNBAGamesDate(selectedNBADate); setNBAStatus('loading'); setNBAError('');
    const preload = (next: Game[]) => {
      if (!warmNBA || preloadingBoxes || !next.length) return;
      preloadingBoxes = true;
      void Promise.all([preloadNBABoxes(next, controller.signal), preloadNBAPregame(next, controller.signal)]).then((results) => {
        if (active && results.some((failed) => failed.length)) setNBAError('Some NBA statistics could not be saved yet. Automatic refresh will retry.');
      }, (error: unknown) => {
        if (!controller.signal.aborted) console.error('NBA box-score preload failed', error);
      }).finally(() => { preloadingBoxes = false; });
    };
    preload(saved);
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await fetchNBAScoreboard(selectedNBADate, controller.signal);
        if (active) {
          setNBAGames(next); setNBAStatus('ready'); setNBAError('');
          preload(next);
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          console.error('Could not refresh NBA scoreboard', cause);
          setNBAStatus('error');
          setNBAError('Could not refresh NBA games. Previously loaded games remain visible. Retry to check the latest scores.');
        }
      } finally { refreshing = false; }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (!nbaDateOverride && selectedNBADate !== nbaCalendarDate()) setSelectedNBADate(nbaCalendarDate());
      else void refresh();
    }, 30_000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [selectedNBADate, nbaDateOverride, nbaRetry, warmNBA]);
  useEffect(() => {
    if (!warmNBA) return;
    const controller = new AbortController();
    void preloadNBADates(selectedNBADate, controller.signal).then((failed) => {
      if (!controller.signal.aborted && failed.length) setNBAError('Some nearby NBA dates could not be preloaded. Selecting a date will retry.');
    }, (error: unknown) => {
      if (!controller.signal.aborted) console.error('NBA date preload failed', error);
    });
    return () => controller.abort();
  }, [selectedNBADate, nbaRetry, warmNBA]);
  useEffect(() => {
    if (!publicSupabaseConfig || authLoading || deletedAccount !== null || !authUser) return;
    const controller = new AbortController();
    void fetchLivewirePosts(publicSupabaseConfig, { limit: 20, themes: [] }, controller.signal)
      .then((posts) => {
        if (!controller.signal.aborted) saveRenderSnapshot('posts', 'livewire', livewireSnapshot(posts, 20));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error('Could not preload LIVEWIRE; opening the feed will retry', error);
      });
    return () => controller.abort();
  }, [authLoading, authUser?.id, deletedAccount]);
  const previousView = useRef(view);
  useEffect(() => connectMedianNavigation(), []);
  useEffect(() => {
    const hash = hashForView(view, window.location.hash);
    if (previousView.current !== view && hash !== window.location.hash) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
      setNotificationHash(hash);
    }
    previousView.current = view;
  }, [view]);
  useEffect(() => {
    const openNotification = () => {
      setNotificationHash(window.location.hash);
      if (window.location.hash.startsWith('#livewire')) {
        setView('LiveWire');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (window.location.hash === '#wire' || window.location.hash.startsWith('#wire/game/') || nbaNotificationFromHash(window.location.hash)) {
        setView('Wire');
        const nbaLink = nbaNotificationFromHash(window.location.hash);
        if (nbaLink) {
          setSportLeague('NBA');
          setNBADateOverride(true);
          setSelectedNBADate(nbaLink.date);
          setNBASelectedGameId(`NBA:${nbaLink.eventId}`);
          setWireSearchQuery('');
          setWirePlayerCard(null);
        }
        const eventId = /^#wire\/game\/(\d+)$/.exec(window.location.hash)?.[1];
        if (eventId) {
          setSportLeague('NFL');
          setSelectedGameId(`NFL:${eventId}`);
          setWireSearchQuery('');
          setWirePlayerCard(null);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        const nextView = viewFromHash(window.location.hash);
        if (nextView) {
          if (nextView === 'Analyst' && window.location.hash.startsWith('#analyst-desk/story/')) {
            setAnalystMode('Angle');
            setStoryOpenKey((value) => value + 1);
          }
          setView(nextView);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    };
    const onNotification = (event: MessageEvent) => {
      if (event.data?.type !== 'GAMEWIRE_NOTIFICATION_OPEN' || typeof event.data.url !== 'string') return;
      const url = new URL(event.data.url, window.location.href);
      if (url.origin !== window.location.origin) return;
      window.location.hash = url.hash;
      openNotification();
    };
    window.addEventListener('hashchange', openNotification);
    navigator.serviceWorker?.addEventListener('message', onNotification);
    return () => {
      window.removeEventListener('hashchange', openNotification);
      navigator.serviceWorker?.removeEventListener('message', onNotification);
    };
  }, []);
  const [profileReturnView, setProfileReturnView] = useState<Exclude<AppView, 'Profile'>>('Wire');
  const [analystMode, setAnalystMode] = useState<'Fantasy' | 'Angle' | 'Results'>('Angle');
  const [fantasyMode, setFantasyMode] = useState<'Matchups' | 'News' | 'Hate' | 'StartSit'>('StartSit');
  const [favorites, setFavorites] = useState<FavoriteTarget[]>(() => supabase ? [] : loadGuestFavorites());
  const [favoritesOwnerId, setFavoritesOwnerId] = useState<string | null>(null);
  const [favoriteSyncError, setFavoriteSyncError] = useState('');
  const [selectedNFLWeek, setSelectedNFLWeek] = useState<number | null>(null);
  const [currentNFLWeek, setCurrentNFLWeek] = useState<number | null>(() => readRenderSnapshot('scoreboard', 'current')?.nflWeek ?? null);
  const [loadedNFLWeek, setLoadedNFLWeek] = useState<number | null>(() => readRenderSnapshot('scoreboard', 'current')?.nflWeek ?? null);
  const [wireSearchQuery, setWireSearchQuery] = useState('');
  const [wireBoardKey, setWireBoardKey] = useState(0);
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');
  const [wirePlayerCard, setWirePlayerCard] = useState<{ player: NFLSkillPlayer; team: Team } | null>(null);
  const [games, setGames] = useState<Game[]>(() => readRenderSnapshot('scoreboard', 'current')?.games ?? []);
  const [scoreboardStatus, setScoreboardStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [scoreboardRetry, setScoreboardRetry] = useState(0);
  useEffect(() => subscribeForegroundRefresh(() => setScoreboardRetry((value) => value + 1)), []);
  useOfflineSnapshots(games, view !== 'LiveWire' && deletedAccount === null && (!!authUser || guestMode));
  useSiteOpenTracking(authUser?.id, deletedAccount === null && !authLoading && (!!authUser || guestMode));
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const notificationEventId = /^#wire\/game\/(\d+)$/i.exec(notificationHash)?.[1] ?? null;
  const nbaNotification = nbaNotificationFromHash(notificationHash);
  useEffect(() => {
    if (!nbaNotification) return;
    setView('Wire');
    setSportLeague('NBA');
    setNBADateOverride(true);
    setSelectedNBADate(nbaNotification.date);
    setNBASelectedGameId(`NBA:${nbaNotification.eventId}`);
    setWireSearchQuery('');
  }, [nbaNotification?.date, nbaNotification?.eventId]);
  const notificationEventRef = useRef(notificationEventId);
  notificationEventRef.current = notificationEventId;
  const [notificationGame, setNotificationGame] = useState<Game | null>(null);
  const [notificationGameError, setNotificationGameError] = useState('');
  const [notificationGameRetry, setNotificationGameRetry] = useState(0);
  useEffect(() => {
    if (!notificationEventId) { setNotificationGame(null); setNotificationGameError(''); return; }
    const controller = new AbortController();
    setSelectedGameId(`NFL:${notificationEventId}`);
    setWireSearchQuery('');
    setWirePlayerCard(null);
    setNotificationGame(null);
    setNotificationGameError('');
    const load = async () => {
      try {
        const game = await fetchNFLNotificationGame(notificationEventId, controller.signal);
        if (!controller.signal.aborted) { setNotificationGame(game); setNotificationGameError(''); }
      } catch (cause) {
        if (!controller.signal.aborted) setNotificationGameError(cause instanceof Error ? cause.message : 'Could not load this notification matchup.');
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [notificationEventId, notificationGameRetry]);
  const [failedLeagues, setFailedLeagues] = useState<string[]>([]);
  const [newsItems, setNewsItems] = useState<DenNewsFeedItem[]>([]);
  const [scoreUpdates, setScoreUpdates] = useState<DenScoreItem[]>(() => supabase ? [] : loadStoredLockerRoomUpdates<DenScoreItem>(lockerRoomScoresStorageKey));
  const scoreUpdatesRef = useRef(scoreUpdates);
  scoreUpdatesRef.current = scoreUpdates;
  const [playUpdates, setPlayUpdates] = useState<DenPlayItem[]>(() => supabase ? [] : loadStoredLockerRoomUpdates<DenPlayItem>(lockerRoomPlaysStorageKey));
  const playUpdatesRef = useRef(playUpdates);
  playUpdatesRef.current = playUpdates;
  const [loadingNews, setLoadingNews] = useState(false);
  const favoritesRef = useRef(favorites);
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const liveNFLBoxKey = games.filter((game) => game.league === 'NFL' && game.status === 'LIVE').map((game) => game.eventId).sort().join(',');
  useEffect(() => {
    if (!liveNFLBoxKey) return;
    const controller = new AbortController();
    let running = false;
    const warm = async () => {
      if (running || document.visibilityState === 'hidden') return;
      running = true;
      try {
        await preloadNFLLiveBoxes(gamesRef.current, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) console.error('Could not warm live NFL box scores', error);
      } finally { running = false; }
    };
    void warm();
    const stopForeground = subscribeForegroundRefresh(() => { void warm(); });
    const timer = window.setInterval(() => { void warm(); }, 30_000);
    return () => { controller.abort(); stopForeground(); window.clearInterval(timer); };
  }, [liveNFLBoxKey]);
  const featuredFavoriteTeamId = topNFLFavoriteTeamId(favorites);
  const nflPlayFavorites = favorites.filter((favorite) => favorite.feedPath === 'football/nfl'
    && (favorite.type === 'team' || (favorite.type === 'player'
      && favorite.teamId
      && ['QB', 'RB', 'WR', 'TE'].includes(favorite.position ?? ''))));
  const favoriteTeamId = (favorite: FavoriteTarget) => favorite.type === 'team' ? favorite.id : favorite.teamId ?? '';
  const weeklyPlayerGames = games.filter((game) => game.sport === 'Football'
    && (game.status === 'LIVE' || (game.status === 'FINAL' && (!game.date || !isPastTuesdayCutoff(game.date))))
    && nflPlayFavorites.some((favorite) => favoriteTeamId(favorite) === game.home.id || favoriteTeamId(favorite) === game.away.id));
  const livePlayerGames = weeklyPlayerGames.filter((game) => game.status === 'LIVE');
  const weeklyPlayGameKey = weeklyPlayerGames.map((game) => `${game.eventId}:${game.status}`).sort().join('|');
  const nflPlayFavoritesKey = nflPlayFavorites.map((favorite) => favorite.key).sort().join('|');
  const playPollInputs = useRef({ games: weeklyPlayerGames, favorites: nflPlayFavorites });
  playPollInputs.current = { games: weeklyPlayerGames, favorites: nflPlayFavorites };

  const pruneExpiredLockerRoomUpdates = () => {
    const cutoff = getTuesdayCutoff();
    setScoreUpdates((current) => {
      const valid = current.filter((item) => Date.parse(item.timestamp) >= cutoff);
      return valid.length === current.length ? current : valid;
    });
    setPlayUpdates((current) => {
      const valid = current.filter((item) => Date.parse(item.timestamp) >= cutoff);
      return valid.length === current.length ? current : valid;
    });
  };

  useEffect(() => {
    if (supabase) return;
    const cutoff = getTuesdayCutoff();
    const valid = scoreUpdates.filter((item) => Date.parse(item.timestamp) >= cutoff);
    try {
      localStorage.setItem(lockerRoomScoresStorageKey, JSON.stringify(valid.slice(0, 100)));
    } catch {
      // Ignore quota errors
    }
  }, [scoreUpdates]);

  useEffect(() => {
    if (supabase) return;
    const cutoff = getTuesdayCutoff();
    const valid = playUpdates.filter((item) => Date.parse(item.timestamp) >= cutoff);
    try {
      localStorage.setItem(lockerRoomPlaysStorageKey, JSON.stringify(valid.slice(0, 100)));
    } catch {
      // Ignore quota errors
    }
  }, [playUpdates]);

  useEffect(() => {
    if (authLoading) return undefined;
    if ((supabase && !authUser) || document.querySelector('.angle-editor')) {
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
      if (hiddenAt !== null && Date.now() - hiddenAt >= 5000 && signedInRef.current && !document.querySelector('.angle-editor')) {
        setSplashReplay((count) => count + 1);
      }
      hiddenAt = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else {
        pruneExpiredLockerRoomUpdates();
        replayAfterAbsence();
      }
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
    setScoreUpdates([]);
    setPlayUpdates([]);
    setNewsItems([]);
    if (!authUser) {
      setFavorites(loadGuestFavorites());
      setFavoritesOwnerId('guest');
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
    if (!supabase || (!authUser && !authLoading && favoritesOwnerId === 'guest')) {
      try {
        localStorage.setItem(guestFavoriteStorageKey, JSON.stringify(favorites));
      } catch (error) {
        console.error('Guest favorites could not save', error);
        setFavoriteSyncError('Your favorites could not be saved on this device. Check browser storage and try again.');
      }
    }
  }, [favorites, authUser?.id, authLoading, favoritesOwnerId]);

  useEffect(() => {
    if (!weeklyPlayGameKey || !nflPlayFavoritesKey) return;
    let current = true;
    let refreshing = false;
    const controller = new AbortController();
    const refreshPlays = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const { games: activeGames, favorites: playerFavorites } = playPollInputs.current;
        const result = await fetchNFLFavoritePlays(activeGames, playerFavorites, controller.signal);
        if (!current || controller.signal.aborted) return;
        const cutoff = getTuesdayCutoff();
        setPlayUpdates((previous) => {
          const map = new Map<string, DenPlayItem>();
          previous.forEach((play) => {
            if (Date.parse(play.timestamp) >= cutoff) map.set(play.id, play);
          });
          result.forEach((play) => {
            if (Date.parse(play.timestamp) >= cutoff) {
              map.set(play.id, { ...play, kind: 'play' as const });
            }
          });
          return Array.from(map.values())
            .sort((first, second) => Date.parse(second.timestamp) - Date.parse(first.timestamp))
            .slice(0, 100);
        });
      } catch {
        if (controller.signal.aborted) return;
      } finally {
        refreshing = false;
      }
    };
    void refreshPlays();
    const refreshId = window.setInterval(() => {
      pruneExpiredLockerRoomUpdates();
      if (playPollInputs.current.games.some((game) => game.status === 'LIVE')) {
        void refreshPlays();
      }
    }, 15_000);
    return () => {
      current = false;
      controller.abort();
      window.clearInterval(refreshId);
    };
  }, [weeklyPlayGameKey, nflPlayFavoritesKey, scoreboardRetry]);

  const toggleFavorite = (favorite: FavoriteTarget) => {
    if (!online) { setFavoriteSyncError('Reconnect to change favorites. Offline browsing is read-only.'); return; }
    if (favorites.some((item) => item.key === favorite.key)) {
      setFavorites((current) => current.filter((item) => item.key !== favorite.key));
      return;
    }
    setFavorites((current) => [...current, favorite]);
    const cutoff = getTuesdayCutoff();
    const matchingGames = games.filter((game) => game.status !== 'UPCOMING'
      && (!game.date || Date.parse(game.date) >= cutoff)
      && (
        game.feedPath === favorite.feedPath && (favorite.type === 'team'
          ? game.away.id === favorite.id || game.home.id === favorite.id
          : favorite.teamId === game.away.id || favorite.teamId === game.home.id)
      ));
    const snapshots = matchingGames.flatMap((game) => completedScoreUpdates(game, favorite));
    if (snapshots.length) {
      setScoreUpdates((current) => {
        const map = new Map<string, DenScoreItem>();
        current.forEach((item) => {
          if (Date.parse(item.timestamp) >= cutoff) map.set(item.id, item);
        });
        snapshots.forEach((item) => {
          if (Date.parse(item.timestamp) >= cutoff) map.set(item.id, item);
        });
        return Array.from(map.values())
          .sort((first, second) => Date.parse(second.timestamp) - Date.parse(first.timestamp))
          .slice(0, 100);
      });
    }
  };

  const moveTeamFavorite = (favoriteKey: string, direction: -1 | 1) => {
    if (!online) { setFavoriteSyncError('Reconnect to reorder favorites. Offline browsing is read-only.'); return; }
    setFavorites((current) => {
      const feedPath = current.find((favorite) => favorite.key === favoriteKey)?.feedPath;
      const teamIndexes = current.flatMap((favorite, index) => favorite.type === 'team' && favorite.feedPath === feedPath ? [index] : []);
      const teamPosition = teamIndexes.findIndex((index) => current[index]?.key === favoriteKey);
      const otherPosition = teamPosition + direction;
      if (teamPosition < 0 || otherPosition < 0 || otherPosition >= teamIndexes.length) return current;
      const next = [...current];
      const currentIndex = teamIndexes[teamPosition];
      const otherIndex = teamIndexes[otherPosition];
      [next[currentIndex], next[otherIndex]] = [next[otherIndex], next[currentIndex]];
      return next;
    });
  };

  useEffect(() => {
    if (notificationEventRef.current) return;
    const featured = findFeaturedNFLGame(games, featuredFavoriteTeamId);
    if (featured) setSelectedGameId(featured.id);
  }, [featuredFavoriteTeamId]);

  const shownNFLWeekRef = useRef<number | null>(selectedNFLWeek);
  useEffect(() => {
    if (shownNFLWeekRef.current === selectedNFLWeek) return;
    shownNFLWeekRef.current = selectedNFLWeek;
    const saved = readRenderSnapshot('scoreboard', String(selectedNFLWeek ?? 'current'));
    gamesRef.current = saved?.games ?? [];
    setGames(gamesRef.current);
    setFailedLeagues([]);
    setScoreboardStatus('loading');
  }, [selectedNFLWeek]);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    let hasGames = gamesRef.current.length > 0;
    let quickRetryId: number | undefined;
    let quickRetries = 0;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      window.clearTimeout(quickRetryId);
      try {
        const result = await fetchScoreboards(controller.signal, selectedNFLWeek ?? undefined);
        if (!current) return;
        setCurrentNFLWeek(result.nflWeek);
        const changedItems: DenScoreItem[] = [];
        const cutoff = getTuesdayCutoff();
        result.games.forEach((game) => {
          const matchingFavorite = favoritesRef.current.find((favorite) => [game.away, game.home].some((team) => favorite.type === 'team'
            ? favorite.key === teamFavoriteTarget(team, game.feedPath).key
            : favorite.teamId === team.id && favorite.feedPath === game.feedPath));
          if (!matchingFavorite) return;
          if (game.status === 'UPCOMING') return;
          if (game.date && isPastTuesdayCutoff(game.date)) return;

          const checkpoints = completedScoreUpdates(game, matchingFavorite);
          checkpoints.forEach((item) => {
            const existing = scoreUpdatesRef.current.find((saved) => saved.id === item.id && saved.checkpoint);
            if (!existing || existing.away.score !== item.away.score || existing.home.score !== item.home.score) {
              changedItems.push({ ...item, timestamp: existing?.timestamp ?? new Date().toISOString() });
            }
          });
        });
        if (changedItems.length) {
          setScoreUpdates((current) => {
            const map = new Map<string, DenScoreItem>();
            current.forEach((item) => {
              if (Date.parse(item.timestamp) >= cutoff) map.set(item.id, item);
            });
            changedItems.forEach((item) => {
              if (Date.parse(item.timestamp) >= cutoff) {
                const gameId = item.id.split(':')[1];
                if (gameId) {
                  for (const [key, existing] of map.entries()) {
                    if (key.startsWith(`score:${gameId}:`) && existing.period === item.period) {
                      const pointDiff = Math.abs((item.away.score + item.home.score) - (existing.away.score + existing.home.score));
                      const timeDiff = Math.abs(Date.parse(item.timestamp) - Date.parse(existing.timestamp));
                      if (pointDiff <= 2 && timeDiff < 300_000) {
                        map.delete(key);
                      }
                    }
                  }
                }
                map.set(item.id, item);
              }
            });
            return Array.from(map.values())
              .sort((first, second) => Date.parse(second.timestamp) - Date.parse(first.timestamp))
              .slice(0, 100);
          });
        }
        if (!result.games.length && result.failedLeagues.length) {
          setFailedLeagues(result.failedLeagues);
          if (!hasGames) {
            setScoreboardStatus('error');
            if (quickRetries < 6) quickRetryId = window.setTimeout(() => { quickRetries++; void refresh(); }, 5_000);
          }
          return;
        }
        hasGames = hasGames || result.games.length > 0;
        setScoreboardStatus('ready');
        setGames(result.games);
        setLoadedNFLWeek(selectedNFLWeek ?? result.nflWeek);
        setFailedLeagues(result.failedLeagues);
        setSelectedGameId((previous) => {
          if (notificationEventRef.current && previous === `NFL:${notificationEventRef.current}`) return previous;
          const prevGame = previous ? result.games.find((game) => game.id === previous) : null;
          if (prevGame && prevGame.status === 'LIVE') return previous;
          const autoGame = findFeaturedNFLGame(result.games, topNFLFavoriteTeamId(favoritesRef.current), previous);
          return autoGame?.id ?? (previous && result.games.some((game) => game.id === previous) ? previous : result.games[0]?.id ?? null);
        });
      } catch {
        if (current && !controller.signal.aborted) {
          setFailedLeagues(['Scoreboards']);
          if (!hasGames) {
            setScoreboardStatus('error');
            if (quickRetries < 6) quickRetryId = window.setTimeout(() => { quickRetries++; void refresh(); }, 5_000);
          }
        }
      } finally {
        refreshing = false;
      }
    };

    void refresh();
    const refreshId = window.setInterval(() => {
      pruneExpiredLockerRoomUpdates();
      void refresh();
    }, 30_000);
    return () => {
      current = false;
      controller.abort();
      window.clearInterval(refreshId);
      window.clearTimeout(quickRetryId);
    };
  }, [selectedNFLWeek, scoreboardRevision, scoreboardRetry]);

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
  }, [favorites, newsRevision]);

  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
  const nbaScreen = sportLeague === 'NBA' && (view === 'Wire' || view === 'Players' || view === 'Den');
  const displayedFeedFailure = nbaScreen ? nbaStatus === 'error' : failedLeagues.length > 0;
  const denItems: DenItem[] = [...newsItems, ...scoreUpdates].sort((first, second) => Date.parse(second.kind === 'news' ? second.published : second.timestamp) - Date.parse(first.kind === 'news' ? first.published : first.timestamp));
  const now = new Date();
  const lockerRoomSeason = games.find((game) => game.league === 'NFL')?.seasonYear
    ?? now.getFullYear() - (now.getMonth() < 2 ? 1 : 0);
  const lockerRoomWeek = selectedNFLWeek ?? currentNFLWeek;
  const analystUnread = useAnalystUnread(authUser?.id ?? null,
    deletedAccount === null && !authLoading && !!authUser, lockerRoomSeason, lockerRoomWeek ?? 0);
  const lockerRoomReady = loadedNFLWeek !== null && loadedNFLWeek === (selectedNFLWeek ?? currentNFLWeek);
  const lockerRoomHistory = useLockerRoomHistory({
    userId: authUser?.id ?? null, season: lockerRoomSeason, week: lockerRoomWeek,
    games: lockerRoomReady ? games : [], favorites: !supabase || favoritesOwnerId === (authUser?.id ?? 'guest') ? favorites : [],
    items: denItems.filter((item) => favorites.find((favorite) => favorite.key === item.favoriteKey)?.feedPath === 'football/nfl'), plays: playUpdates, enabled: lockerRoomReady,
  });
  const nbaFavorites = favorites.filter((favorite) => favorite.feedPath === 'basketball/nba');
  const nbaFavoriteKeys = new Set(nbaFavorites.map((favorite) => favorite.key));
  const nbaHistory = useLockerRoomHistory({
    userId: authUser?.id ?? null, season: null, week: null, archiveDate: selectedNBADate,
    games: nbaGames, favorites: !supabase || favoritesOwnerId === (authUser?.id ?? 'guest') ? nbaFavorites : [],
    items: newsItems.filter((item) => nbaFavoriteKeys.has(item.favoriteKey)), plays: [],
    enabled: nbaGames.length > 0,
  });
  const denHistory = sportLeague === 'NBA' ? nbaHistory : lockerRoomHistory;
  const displayName = typeof authUser?.user_metadata.display_name === 'string' ? authUser.user_metadata.display_name : authUser?.email ?? 'Account';
  const openProfile = () => {
    if (view !== 'Profile') setProfileReturnView(view);
    setView('Profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const openGamePlayers = (game: Game) => {
    setSportLeague(game.league === 'NBA' ? 'NBA' : 'NFL');
    setSelectedGameId(game.id);
    setView('Players');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const openWireTab = () => {
    const auto = findFeaturedNFLGame(games, topNFLFavoriteTeamId(favorites));
    if (auto) {
      setSelectedGameId(auto.id);
    }
    setWireBoardKey((value) => value + 1);
    if (/^#wire\/(?:game|nba)\//i.test(window.location.hash)) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#wire`);
      setNotificationHash('#wire');
    }
    setView('Wire');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (deletedAccount) return <main className="page-wrap"><section className="account-profile" role="status"><h2>Account deleted</h2><p>Your account and associated personal data have been deleted.</p>{deletedAccount.length > 0 && <p className="auth-error">Some data on this device could not be cleared: {deletedAccount.join(', ')}. Clear this site's browsing data in your browser settings.</p>}<button onClick={() => window.location.replace(import.meta.env.BASE_URL)}>Back to GameWire</button></section></main>;
  if (recoveringPassword && authUser) return <ResetPasswordScreen onDone={() => setRecoveringPassword(false)} />;
  if (online && supabase && authLoading) return <SplashScreen />;
  if (supabase && !authUser && !guestMode) return <AuthScreen onContinueGuest={() => { localStorage.setItem('gamewire-guest-mode', 'true'); setGuestMode(true); }} />;

  return (
    <div className="app-shell">
      {online && showSplash && <SplashScreen />}
      {authUser && !authLoading && !showSplash && online && <NotificationOnboarding key={authUser.id} user={authUser} />}
      <header className="topbar">
        <a className="brand" href="#wire" onClick={openWireTab}>
          <OfflineImage className="brand-logo" src={`${import.meta.env.BASE_URL}gamewire-mark.png`} alt="" />
          <span>GAMEWIRE</span>
        </a>
        <PrimaryNavigation>
          <button className={view === 'Wire' ? 'active' : ''} aria-current={view === 'Wire' ? 'page' : undefined} onClick={openWireTab}><Activity size={20} aria-hidden="true" /><span>The Wire</span></button>
          <button className={view === 'Players' ? 'active' : ''} aria-current={view === 'Players' ? 'page' : undefined} onClick={() => setView('Players')}><ChartColumn size={20} aria-hidden="true" /><span>Stat Hub</span></button>
          <button className={view === 'Analyst' ? 'active' : ''} aria-current={view === 'Analyst' ? 'page' : undefined} aria-label={analystUnread.unread ? 'Analyst Desk, unread posts' : 'Analyst Desk'} onClick={() => { setView('Analyst'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span className="analyst-nav-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10h18M4 10v11M20 10v11M14 10v8h6M16 14h2M7 10V3h10v7M10 6h4" /></svg>{analystUnread.unread && <i className="analyst-unread-dot" aria-hidden="true" />}</span><span>Analyst Desk</span></button>
          <button className={view === 'LiveWire' ? 'active' : ''} aria-current={view === 'LiveWire' ? 'page' : undefined} aria-label={livewireUnread.unread ? 'LIVEWIRE, unread posts' : 'LIVEWIRE'} onClick={() => { setView('LiveWire'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span className="livewire-nav-icon"><Zap size={20} aria-hidden="true" />{livewireUnread.unread && <i className="livewire-unread-dot" aria-hidden="true" />}</span><span>LIVEWIRE</span></button>
          <button className={view === 'Den' ? 'active' : ''} aria-current={view === 'Den' ? 'page' : undefined} onClick={() => setView('Den')}><Users size={20} aria-hidden="true" /><span>Locker Room</span></button>
        </PrimaryNavigation>
        <div className="topbar-right">
          {(view === 'Wire' || view === 'Players') && (
            <BannerSearch
              key={view}
              kind={view === 'Wire' ? 'games' : 'players'}
              league={sportLeague}
              query={view === 'Wire' ? wireSearchQuery : playerSearchQuery}
              onQueryChange={view === 'Wire' ? setWireSearchQuery : setPlayerSearchQuery}
            />
          )}
          {authUser ? (
            <>
              <button className={`account-profile-button${view === 'Profile' ? ' active' : ''}`} aria-label={`Open ${displayName} profile`} onClick={openProfile}>{displayName}</button>
              <button className="sign-out-button" onClick={() => { void supabase?.auth.signOut(); }}><LogOut size={15} /><span>Sign out</span></button>
            </>
          ) : (
            <div className="guest-nav-controls">
              <span className="edition-label">GUEST</span>
              <button className="guest-signin-btn" disabled={!online} onClick={() => { localStorage.removeItem('gamewire-guest-mode'); setGuestMode(false); }}>Sign in</button>
            </div>
          )}
        </div>
      </header>
      <main className={view === 'Players' || view === 'Analyst' ? `page-wrap players-zoom${view === 'Analyst' ? ' analyst-page' : ''}` : view === 'Wire' ? 'page-wrap wire-page' : view === 'Den' ? 'page-wrap locker-room-zoom' : view === 'LiveWire' ? 'page-wrap livewire-page' : 'page-wrap'}>
        <PullToRefresh />
        {livewireUnread.error && <p className="feed-warning" role="status">{livewireUnread.error}</p>}
        {analystUnread.error && <p className="feed-warning" role="status">{analystUnread.error}</p>}
        <div className="page-heading">
          <div>
            <div className="date-line"><span>{dateLabel}</span><span className="date-divider" /> <span>LOCAL GAME TIMES</span></div>
            {view !== 'Wire' && <>
              <h1>{view === 'LiveWire' ? 'LIVEWIRE' : view === 'Den' ? 'Locker Room' : view === 'Profile' ? 'Profile' : view === 'Analyst' ? 'Analyst Desk' : 'Stat Hub'}</h1>
              {view !== 'Analyst' && <p>{view === 'LiveWire' ? 'Player news and takes from the GameWire desk.' : view === 'Den' ? 'Your home for updates on the teams and players you follow.' : view === 'Profile' ? 'Manage your account details and security.' : 'The numbers behind the names.'}</p>}
            </>}
          </div>
          <div className="heading-actions">
            {view !== 'Profile' && view !== 'LiveWire' && (view !== 'Analyst' || !!sessionUser) && (
              <>
                {(view !== 'Wire' || displayedFeedFailure) && <span className={`feed-status${displayedFeedFailure ? ' feed-status-warning' : ''}`}>
                  <i />
                  {displayedFeedFailure ? 'FEED ISSUE' : view === 'Den' ? 'LIVE FEED' : 'LIVE STATS'}
                </span>}
                <label className={`date-button${sportLeague !== 'NFL' && (view === 'Wire' || view === 'Players' || view === 'Den') ? ' sport-week-placeholder' : ''}`} aria-hidden={sportLeague !== 'NFL' && (view === 'Wire' || view === 'Players' || view === 'Den') || undefined}>
                  <Clock3 size={15} />
                  <span aria-hidden="true">{selectedNFLWeek === null ? (currentNFLWeek ? `Current · Week ${currentNFLWeek}` : 'Current NFL week') : `Week ${selectedNFLWeek}`}</span>
                  <select aria-label="NFL week" disabled={sportLeague !== 'NFL' && (view === 'Wire' || view === 'Players' || view === 'Den')} value={selectedNFLWeek ?? 'current'} onChange={(event) => setSelectedNFLWeek(event.target.value === 'current' ? null : Number(event.target.value))}>
                    <option value="current">{currentNFLWeek ? `Current · Week ${currentNFLWeek}` : 'Current NFL week'}</option>
                    {Array.from({ length: 18 }, (_, index) => index + 1).map((week) => <option key={week} value={week}>Week {week}</option>)}
                  </select>
                  <ChevronRight size={14} />
                </label>
              </>
            )}
          </div>
        </div>
        {(view === 'Wire' || view === 'Players' || view === 'Den') && <div className="league-banner" role="group" aria-label="Select sport">
            {(['NFL', 'NBA'] as const).map((league) => <button key={league} type="button" aria-pressed={sportLeague === league} onClick={() => {
              setSportLeague(league); setWireSearchQuery(''); setPlayerSearchQuery(''); setWirePlayerCard(null);
            }}>{league}</button>)}
            {sportLeague === 'NBA' && <><div className="nba-date-navigation" role="group" aria-label="NBA date navigation"><button type="button" className="nba-date-arrow" aria-label="Previous NBA day" title="Previous day" disabled={selectedNBADate <= '2000-01-01'} onClick={() => {
              setNBADateOverride(true); setSelectedNBADate((date) => shiftNBACalendarDate(date, -1)); setNBASelectedGameId(null);
            }}><ChevronLeft size={16} aria-hidden="true" /></button><label><span className="league-date-label">NBA date (Eastern)</span><input type="date" aria-label="NBA date (Eastern)" title="NBA date (Eastern)" value={selectedNBADate} min="2000-01-01" max="2200-12-31" onChange={(event) => {
              if (!event.target.value) return;
              setNBADateOverride(true); setSelectedNBADate(event.target.value); setNBASelectedGameId(null);
            }} /></label><button type="button" className="nba-date-arrow" aria-label="Next NBA day" title="Next day" disabled={selectedNBADate >= '2200-12-31'} onClick={() => {
              setNBADateOverride(true); setSelectedNBADate((date) => shiftNBACalendarDate(date, 1)); setNBASelectedGameId(null);
            }}><ChevronRight size={16} aria-hidden="true" /></button></div><button type="button" onClick={() => { setNBADateOverride(false); setSelectedNBADate(nbaCalendarDate()); setNBARetry((value) => value + 1); }}>Today</button></>}
          </div>}
          {sportLeague === 'NBA' && (view === 'Wire' || view === 'Players' || view === 'Den') && nbaError && <p className="feed-warning" role="alert">{nbaError} <button type="button" onClick={() => setNBARetry((value) => value + 1)}>Retry NBA games</button></p>}
        {favoriteSyncError && <div className="feed-warning" role="status">{favoriteSyncError}</div>}
        <AccountRequired hasAccount={!!sessionUser} section={view === 'Analyst' ? 'Analyst Desk' : view === 'LiveWire' ? 'LIVEWIRE' : null} online={online} onSignIn={() => { localStorage.removeItem('gamewire-guest-mode'); setGuestMode(false); }}>
        {view === 'Analyst' && <div className="player-mode-tabs" role="tablist" aria-label="Analyst Desk view">
          <button role="tab" aria-selected={analystMode === 'Angle'} aria-label={analystUnread.angle ? 'The Angle, unread posts' : 'The Angle'} className={analystMode === 'Angle' ? 'active' : ''} onClick={() => setAnalystMode('Angle')}>The Angle{analystUnread.angle && <i className="analyst-tab-dot" aria-hidden="true" />}</button>
          <button role="tab" aria-selected={analystMode === 'Fantasy'} aria-label={analystUnread.news || analystUnread.picks || analystUnread.hate ? 'Fantasy, unread updates' : 'Fantasy'} className={analystMode === 'Fantasy' ? 'active' : ''} onClick={() => setAnalystMode('Fantasy')}>Fantasy{(analystUnread.news || analystUnread.picks || analystUnread.hate) && <i className="analyst-tab-dot" aria-hidden="true" />}</button>
          <button role="tab" aria-selected={analystMode === 'Results'} className={analystMode === 'Results' ? 'active' : ''} onClick={() => setAnalystMode('Results')}>Our Results</button>
        </div>}
        {view === 'Analyst' && analystMode === 'Fantasy' && <div className="player-mode-tabs fantasy-mode-tabs" role="tablist" aria-label="Fantasy view">
          <button role="tab" aria-selected={fantasyMode === 'StartSit'} className={fantasyMode === 'StartSit' ? 'active' : ''} onClick={() => setFantasyMode('StartSit')}>Start/Sit</button>
          <button role="tab" aria-selected={fantasyMode === 'News'} aria-label={analystUnread.news ? 'Fantasy News, unread posts' : 'Fantasy News'} className={fantasyMode === 'News' ? 'active' : ''} onClick={() => setFantasyMode('News')}>Fantasy News{analystUnread.news && <i className="analyst-tab-dot" aria-hidden="true" />}</button>
          <button role="tab" aria-selected={fantasyMode === 'Matchups'} aria-label={analystUnread.picks ? 'Top Performers, unread updates' : 'Top Performers'} className={fantasyMode === 'Matchups' ? 'active' : ''} onClick={() => setFantasyMode('Matchups')}>Top Performers{analystUnread.picks && <i className="analyst-tab-dot" aria-hidden="true" />}</button>
          <button role="tab" aria-selected={fantasyMode === 'Hate'} aria-label={analystUnread.hate ? 'Hate Watch, unread updates' : 'Hate Watch'} className={fantasyMode === 'Hate' ? 'active' : ''} onClick={() => setFantasyMode('Hate')}>Hate Watch{analystUnread.hate && <i className="analyst-tab-dot" aria-hidden="true" />}</button>
        </div>}
        {view === 'Analyst' && (['top', 'hate'] as const).map((boardType) => {
          const active = analystMode === 'Fantasy' && fantasyMode === (boardType === 'hate' ? 'Hate' : 'Matchups');
          return <div key={`${boardType}:${authUser?.id ?? 'guest'}:${lockerRoomSeason}:${lockerRoomWeek}`} hidden={!active}>
            <FavorableMatchups active={active} boardType={boardType} games={lockerRoomReady ? games : []} season={lockerRoomSeason} week={lockerRoomWeek} user={authUser} onSeen={analystUnread.markRead} />
          </div>;
        })}
        <FantasyStartSit key={`start-sit:${sessionUser?.id ?? 'guest'}`} active={view === 'Analyst' && analystMode === 'Fantasy' && fantasyMode === 'StartSit'} games={lockerRoomReady ? games : []} season={lockerRoomSeason} week={lockerRoomWeek} user={sessionUser} />
        {(['angle', 'news'] as const).map((section) => <TheAngle
          key={`${section}:${sessionUser?.id ?? 'guest'}`}
          active={view === 'Analyst' && (section === 'news' ? analystMode === 'Fantasy' && fantasyMode === 'News' : analystMode === 'Angle')}
          section={section}
          onOpenSection={(next) => { setAnalystMode(next === 'news' ? 'Fantasy' : 'Angle'); if (next === 'news') setFantasyMode('News'); }}
          games={lockerRoomReady ? games : []}
          season={lockerRoomSeason}
          week={lockerRoomWeek}
          user={sessionUser}
          onSeen={analystUnread.markRead}
          storyId={/^#analyst-desk\/story\/([0-9a-f-]{36})$/i.exec(notificationHash)?.[1] ?? null}
          storyOpenKey={storyOpenKey}
        />)}
        <div hidden={view !== 'LiveWire'}>
          <LiveWire key={authUser?.id ?? 'guest'} active={view === 'LiveWire'} user={authUser} onPostSeen={livewireUnread.markRead} postId={/^#livewire\/post\/([0-9a-f-]{36})$/i.exec(notificationHash)?.[1] ?? null} />
        </div>
        {view === 'Analyst' && analystMode === 'Results' && <OurResults key={authUser?.id ?? 'guest'} user={authUser} />}
        </AccountRequired>
        {view === 'Profile' ? (
          authUser ? <ProfilePage user={authUser} onDeleted={(warnings) => { setDeletedAccount(warnings); setAuthUser(null); setFavorites([]); setScoreUpdates([]); setPlayUpdates([]); setNewsItems([]); setWirePlayerCard(null); }} onBack={() => { setView(profileReturnView); window.scrollTo({ top: 0, behavior: 'smooth' }); }} /> : !online ? <p className="feed-warning">Reconnect to view or change your account. Guest saved browsing is available in The Wire and Stat Hub.</p> : <AuthScreen onContinueGuest={() => { localStorage.setItem('gamewire-guest-mode', 'true'); setGuestMode(true); }} />
        ) : view === 'Wire' && sportLeague === 'NBA' ? (
          <NBAExperience mode="wire" games={nbaGames} status={nbaStatus} query={wireSearchQuery} favorites={favorites} onToggleFavorite={toggleFavorite} onRetry={() => setNBARetry((value) => value + 1)} initialGameId={nbaSelectedGameId} openGameId={nbaNotification ? `NBA:${nbaNotification.eventId}` : null} onSelectGame={setNBASelectedGameId} onOpenStatHub={(id) => { setNBASelectedGameId(id); setView('Players'); }} />
        ) : view === 'Wire' ? (
          <>
          {notificationEventId && notificationGameError && <div className="feed-warning" role="alert">{notificationGameError} <button onClick={() => setNotificationGameRetry((value) => value + 1)}>Retry matchup</button></div>}
          {notificationEventId && !notificationGame && !notificationGameError && <p role="status">Loading your notification matchup...</p>}
          {(!notificationEventId || notificationGame?.eventId === notificationEventId) && <TheWire
            key={wireBoardKey}
            games={notificationGame && !games.some((game) => game.id === notificationGame.id) ? [notificationGame, ...games] : games}
            scoreboardStatus={scoreboardStatus}
            onRetryScoreboard={() => { setScoreboardStatus('loading'); setScoreboardRetry((value) => value + 1); }}
            query={wireSearchQuery}
            favorites={favorites}
            featuredFavoriteTeamId={featuredFavoriteTeamId}
            onToggleFavorite={toggleFavorite}
            initialGameId={selectedGameId}
            openGameId={notificationEventId ? `NFL:${notificationEventId}` : null}
            onSelectGame={setSelectedGameId}
            onOpenStatHub={openGamePlayers}
            onOpenPlayer={(player, team) => setWirePlayerCard({ player, team })}
          />}
          {wirePlayerCard && <NFLPlayerMiniWindow
            key={wirePlayerCard.player.id}
            player={wirePlayerCard.player}
            team={wirePlayerCard.team}
            isFavorite={favorites.some((favorite) => favorite.key === nflPlayerFavoriteTarget(wirePlayerCard.player, wirePlayerCard.team).key)}
            onToggleFavorite={toggleFavorite}
            onClose={() => setWirePlayerCard(null)}
          />}
          </>
        ) : view === 'LiveWire' ? null : view === 'Den' ? (
          <TheDen league={sportLeague} activityDate={selectedNBADate} favorites={favorites.filter((favorite) => favorite.feedPath === (sportLeague === 'NBA' ? 'basketball/nba' : 'football/nfl'))} games={sportLeague === 'NBA' ? nbaGames : lockerRoomReady ? games : []} items={denHistory.items.sort((first, second) => Date.parse(second.kind === 'news' ? second.published : second.timestamp) - Date.parse(first.kind === 'news' ? first.published : first.timestamp))} plays={denHistory.plays.sort((first, second) => Date.parse(second.timestamp) - Date.parse(first.timestamp))} playerHistory={denHistory.players} week={lockerRoomWeek} season={lockerRoomSeason} historyLoading={denHistory.loading} historyError={denHistory.error} signedIn={!!authUser} onRetryHistory={denHistory.retry} livePlayerGames={sportLeague === 'NBA' ? nbaGames.filter((game) => game.status === 'LIVE').length : livePlayerGames.length} loadingNews={loadingNews} onToggleFavorite={toggleFavorite} onMoveTeamFavorite={moveTeamFavorite} />
        ) : view === 'Players' ? (
          sportLeague === 'NBA'
            ? <NBAExperience mode="stats" games={nbaGames} status={nbaStatus} query={playerSearchQuery} favorites={favorites} onToggleFavorite={toggleFavorite} onRetry={() => setNBARetry((value) => value + 1)} initialGameId={nbaSelectedGameId} onSelectGame={setNBASelectedGameId} />
            : <NFLPlayersDirectory games={games} scoreboardStatus={scoreboardStatus} query={playerSearchQuery} favorites={favorites} onToggleFavorite={toggleFavorite} initialGameId={selectedGameId} />
        ) : null}
        <footer className="page-footer"><span>GAMEWIRE <i>·</i> NFL + NBA</span><span>NFL and NBA scores, player stats, and matchups.</span></footer>
      </main>
    </div>
  );
}

export default App;
