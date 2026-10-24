import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Star, X } from 'lucide-react';
import OfflineImage from './OfflineImage';
import type { FavoriteTarget, Game, Team } from './services/sportsData';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';
import {
  fetchNBALeague, fetchNBAPlayerProfile, fetchNBARoster, fetchNBASummary, fetchNBATeamSeason,
  nbaPlayerFavorite, nbaStatOptions, nbaTeamFavorite,
} from './services/nbaData';
import type { NBABoxTeam, NBAPlay, NBAPlayer, NBAPlayerStatKey, NBAStats, NBATeamStat } from './services/nbaData';
import './nba.css';

type Props = {
  mode: 'wire' | 'stats';
  games: Game[];
  status: 'loading' | 'ready' | 'error';
  query: string;
  favorites: FavoriteTarget[];
  onToggleFavorite: (favorite: FavoriteTarget) => void;
  onRetry: () => void;
  onOpenStatHub?: (gameId: string) => void;
  initialGameId?: string | null;
  onSelectGame?: (id: string) => void;
};
type Resource<T> = { key: string; data: T | null; loading: boolean; error: string };

function useNBAResource<T>(key: string, load: ((signal: AbortSignal) => Promise<T>) | null, poll = 0) {
  const [state, setState] = useState<Resource<T>>({ key, data: null, loading: !!load, error: '' });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!load) return;
    let disposed = false;
    let request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      setState((previous) => ({ key, data: previous.key === key ? previous.data : null, loading: true, error: '' }));
      void load(controller.signal).then((data) => {
        if (!disposed && !controller.signal.aborted) setState({ key, data, loading: false, error: '' });
      }, (error: unknown) => {
        if (!disposed && !controller.signal.aborted) setState((previous) => ({
          key, data: previous.key === key ? previous.data : null, loading: false,
          error: error instanceof Error ? error.message : 'Unable to load ESPN NBA data.',
        }));
      });
    };
    refresh();
    const timer = poll ? window.setInterval(() => { if (document.visibilityState !== 'hidden' && navigator.onLine) refresh(); }, poll) : undefined;
    const unsubscribe = subscribeForegroundRefresh(refresh);
    return () => { disposed = true; request?.abort(); if (timer !== undefined) window.clearInterval(timer); unsubscribe(); };
  }, [key, load, poll, revision]);
  return { ...(state.key === key ? state : { key, data: null, loading: !!load, error: '' }), retry };
}

function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  return {
    ref,
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || !ref.current) return;
      drag.current = { x: event.clientX, scroll: ref.current.scrollLeft, moved: false };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag.current || !ref.current || !(event.buttons & 1)) return;
      const delta = event.clientX - drag.current.x;
      if (Math.abs(delta) > 6) drag.current.moved = true;
      if (drag.current.moved) { event.preventDefault(); ref.current.scrollLeft = drag.current.scroll - delta; }
    },
    onPointerLeave: () => { drag.current = null; },
    onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
      if (drag.current?.moved) { event.preventDefault(); event.stopPropagation(); }
      drag.current = null;
    },
  };
}

function format(value: number | undefined) { return value === undefined ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 1 }); }
function gameDate(date: string, time = false) {
  const value = new Date(date);
  return Number.isFinite(value.getTime()) ? value.toLocaleString('en-US', time ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' }) : 'Date unavailable';
}
function FavoriteButton({ target, favorites, toggle }: { target: FavoriteTarget; favorites: FavoriteTarget[]; toggle: Props['onToggleFavorite'] }) {
  const saved = favorites.some((favorite) => favorite.key === target.key);
  return <button type="button" className={`nba-favorite${saved ? ' is-favorite' : ''}`} aria-label={`${saved ? 'Unfavorite' : 'Favorite'} ${target.name}`} aria-pressed={saved} onClick={() => toggle(target)}><Star size={18} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" /></button>;
}
function ResourceMessage({ loading, error, data, retry }: { loading: boolean; error: string; data: unknown; retry: () => void }) {
  return <>{loading && !data && <p role="status">Loading ESPN NBA data…</p>}{error && <div className="nba-warning" role="status"><span>{data ? 'Showing the last successful update. ' : ''}{error}</span><button type="button" onClick={retry}>Retry</button></div>}</>;
}
function ScrollRow({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  const drag = useDragScroll();
  return <div {...drag} className={`nba-scroll ${className}`} role="group" aria-label={label} tabIndex={0}>{children}</div>;
}
function TableScroll({ children, label }: { children: ReactNode; label: string }) {
  const drag = useDragScroll();
  return <div {...drag} className="nba-table-scroll" tabIndex={0} role="region" aria-label={label}>{children}</div>;
}
function TeamHeading({ team, favorites, toggle }: { team: Team; favorites: FavoriteTarget[]; toggle: Props['onToggleFavorite'] }) {
  return <header className="nba-team-heading">{team.logo && <OfflineImage src={team.logo} alt="" />}<div><h3>{team.name}</h3>{team.record && <small>{team.record}</small>}</div><FavoriteButton target={nbaTeamFavorite(team)} favorites={favorites} toggle={toggle} /></header>;
}
function Comparison({ away, home, awayStats, homeStats }: { away: Team; home: Team; awayStats: NBATeamStat[]; homeStats: NBATeamStat[] }) {
  const keys = [...new Set([...awayStats, ...homeStats].map((stat) => stat.name))];
  return keys.length ? <TableScroll label="Team comparison table"><table className="nba-table"><thead><tr><th scope="col">{away.abbr}</th><th scope="col">Statistic</th><th scope="col">{home.abbr}</th></tr></thead><tbody>{keys.map((key) => {
    const a = awayStats.find((stat) => stat.name === key), b = homeStats.find((stat) => stat.name === key);
    return <tr key={key}><td>{a?.display ?? '—'}</td><th scope="row">{a?.label ?? b?.label}</th><td>{b?.display ?? '—'}</td></tr>;
  })}</tbody></table></TableScroll> : <p>Team statistics have not been provided by ESPN yet.</p>;
}
const boxColumns: Array<{ label: string; key: NBAPlayerStatKey; display?: string }> = [
  { label: 'MIN', key: 'minutes', display: 'MIN' }, { label: 'PTS', key: 'points' },
  { label: 'FG', key: 'fieldGoalsMade', display: 'FG' }, { label: '3PT', key: 'threePointersMade', display: '3PT' }, { label: 'FT', key: 'freeThrowsMade', display: 'FT' },
  { label: 'REB', key: 'rebounds' }, { label: 'AST', key: 'assists' }, { label: 'STL', key: 'steals' }, { label: 'BLK', key: 'blocks' },
  { label: 'TO', key: 'turnovers' }, { label: 'PF', key: 'fouls' }, { label: '+/−', key: 'plusMinus', display: '+/-' },
];
function PlayerBox({ team, box, favorites, toggle, open }: { team: Team; box?: NBABoxTeam; favorites: FavoriteTarget[]; toggle: Props['onToggleFavorite']; open: (player: NBAPlayer, team: Team) => void }) {
  const players = [...box?.players ?? []].sort((a, b) => Number(b.starter) - Number(a.starter));
  return <section><TeamHeading team={team} favorites={favorites} toggle={toggle} />
    {!players.length ? <p>Player box scores are not available yet.</p> : <TableScroll label={`${team.name} player box score`}><table className="nba-table nba-box"><thead><tr><th scope="col">Player</th>{boxColumns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{players.map((player) => <tr key={player.id}>
      <th scope="row"><div className="nba-box-identity"><button type="button" className="nba-player-link" onClick={() => open(player, team)}>{player.headshot && <OfflineImage src={player.headshot} alt="" />}<span>{player.name}<small>{player.position}{player.starter ? ' · Starter' : ' · Bench'}</small></span></button><FavoriteButton target={nbaPlayerFavorite(player, team)} favorites={favorites} toggle={toggle} /></div></th>
      {player.didNotPlay ? <td className="nba-dnp" colSpan={boxColumns.length}>DNP{player.reason ? ` · ${player.reason}` : ''}</td> : boxColumns.map((column) => <td data-label={column.label} key={column.key}>{column.display ? player.display[column.display] ?? '—' : format(player.stats[column.key])}</td>)}
    </tr>)}</tbody></table></TableScroll>}
  </section>;
}
function PlayByPlay({ plays, game, upcoming }: { plays: NBAPlay[]; game: Game; upcoming: boolean }) {
  const periods = [...new Set(plays.map((play) => play.period))].sort((a, b) => b - a);
  return <section aria-label="Play-by-play"><h3>Play-by-Play</h3><p className="nba-note">ESPN plays · most recent first · {plays.length} available</p>
    {!plays.length ? <p>{upcoming ? 'Play-by-play begins when the game starts.' : 'No plays are available from ESPN yet.'}</p> : periods.map((period) => <section className="nba-play-quarter" key={period} aria-label={period > 4 ? `Overtime ${period - 4}` : period > 0 ? `Quarter ${period}` : 'Period unavailable'}>
      <h4>{period > 4 ? `Overtime ${period - 4}` : period > 0 ? `Quarter ${period}` : 'Period unavailable'}</h4>
      <ol className="nba-plays">{plays.filter((play) => play.period === period).slice().reverse().map((play) => <li className={play.scoring ? 'is-scoring' : ''} key={play.id}><div><time>{play.clock || 'Clock unavailable'}</time>{play.scoring && <span>Scoring play</span>}</div><p>{play.text}</p><small>{game.away.abbr} {play.awayScore ?? '—'} – {play.homeScore ?? '—'} {game.home.abbr}</small></li>)}</ol>
    </section>)}
  </section>;
}
function Roster({ team, season, query, favorites, toggle, open }: { team: Team; season: number; query: string; favorites: FavoriteTarget[]; toggle: Props['onToggleFavorite']; open: (player: NBAPlayer, team: Team) => void }) {
  const load = useCallback((signal: AbortSignal) => fetchNBARoster(team.id, season, signal), [team.id, season]);
  const roster = useNBAResource(`roster:${team.id}:${season}`, load);
  const [position, setPosition] = useState('All');
  const players = roster.data?.filter((player) => (position === 'All' || player.position === position) && `${player.name} ${team.name} ${team.abbr} ${player.position}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const positions = [...new Set(roster.data?.map((player) => player.position).filter(Boolean))].sort();
  return <section><TeamHeading team={team} favorites={favorites} toggle={toggle} /><ResourceMessage {...roster} />
    {!!positions.length && <label className="nba-filter">Position <select value={position} onChange={(event) => setPosition(event.target.value)}><option>All</option>{positions.map((item) => <option key={item}>{item}</option>)}</select></label>}
    {roster.data && !players.length && <p>{roster.data.length ? 'No players match these filters.' : 'No roster players are available for this season.'}</p>}
    <div className="nba-roster">{players.map((player) => <article key={player.id} className="nba-player-card"><button type="button" className="nba-player-link" onClick={() => open(player, team)}>{player.headshot && <OfflineImage src={player.headshot} alt="" />}<span><strong>{player.name}</strong><small>{player.position || 'Position unavailable'}{player.jersey ? ` · #${player.jersey}` : ''}</small></span></button><FavoriteButton target={nbaPlayerFavorite(player, team)} favorites={favorites} toggle={toggle} /></article>)}</div>
  </section>;
}
function TeamSeason({ team, season }: { team: Team; season: number }) {
  const load = useCallback((signal: AbortSignal) => fetchNBATeamSeason(team.id, season, signal), [team.id, season]);
  const resource = useNBAResource(`season:${team.id}:${season}`, load);
  return <section><h4>{team.abbr} · {season - 1}–{String(season).slice(-2)} regular season</h4><ResourceMessage {...resource} />{resource.data && (resource.data.length ? <dl className="nba-season-grid">{resource.data.map((stat) => <div key={stat.name}><dt>{stat.label}</dt><dd>{stat.display}</dd></div>)}</dl> : <p>No season averages are available yet.</p>)}</section>;
}
function PregameComparison({ game }: { game: Game }) {
  const load = useCallback(async (signal: AbortSignal) => {
    const [away, home] = await Promise.all([fetchNBATeamSeason(game.away.id, game.seasonYear, signal), fetchNBATeamSeason(game.home.id, game.seasonYear, signal)]);
    return { away, home };
  }, [game.away.id, game.home.id, game.seasonYear]);
  const resource = useNBAResource(`comparison:${game.away.id}:${game.home.id}:${game.seasonYear}`, load);
  return <><p className="nba-note">{game.seasonYear - 1}–{String(game.seasonYear).slice(-2)} regular-season team averages · not game projections.</p><ResourceMessage {...resource} />{resource.data && <Comparison away={game.away} home={game.home} awayStats={resource.data.away} homeStats={resource.data.home} />}</>;
}
function profileOptions(position: string) {
  const priority: NBAPlayerStatKey[] = /^(C|PF|F-C|C-F)$/.test(position) ? ['points', 'rebounds', 'blocks', 'offensiveRebounds', 'assists'] : /^(PG|SG|G|G-F)$/.test(position) ? ['points', 'assists', 'threePointersMade', 'steals', 'rebounds'] : ['points', 'rebounds', 'assists', 'threePointersMade', 'steals'];
  return [...nbaStatOptions].sort((a, b) => (priority.includes(a.key) ? priority.indexOf(a.key) : 99) - (priority.includes(b.key) ? priority.indexOf(b.key) : 99));
}
function StatsGrid({ stats, label }: { stats: NBAStats; label: string }) {
  return <dl className="nba-season-grid" aria-label={label}>{nbaStatOptions.filter((option) => option.key !== 'plusMinus').map((option) => <div key={option.key}><dt>{option.label}</dt><dd>{format(stats[option.key])}</dd></div>)}</dl>;
}
function PlayerProfile({ player, team, season, favorites, toggle, close }: { player: NBAPlayer; team: Team; season: number; favorites: FavoriteTarget[]; toggle: Props['onToggleFavorite']; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback((signal: AbortSignal) => fetchNBAPlayerProfile(player.id, season, signal), [player.id, season]);
  const resource = useNBAResource(`profile:${player.id}:${season}`, load);
  const [stat, setStat] = useState<NBAPlayerStatKey>('points');
  const [seasonMode, setSeasonMode] = useState<'averages' | 'totals'>('averages');
  const [gameType, setGameType] = useState('All');
  useEffect(() => {
    const trigger = document.activeElement, element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  const games = (resource.data?.games ?? []).filter((game) => gameType === 'All' || game.seasonType === gameType).slice(0, 15);
  const maximum = Math.max(1, ...games.map((game) => Math.abs(game.stats[stat] ?? 0)));
  const label = nbaStatOptions.find((option) => option.key === stat)?.label ?? stat;
  return <dialog ref={dialog} className="nba-profile" aria-labelledby="nba-profile-title" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(); } }}>
    <header className="nba-profile-header">{player.headshot && <OfflineImage src={player.headshot} alt="" />}<div><small>{team.abbr} · {player.position}{player.jersey ? ` · #${player.jersey}` : ''}</small><h2 id="nba-profile-title">{player.name}</h2></div><FavoriteButton target={nbaPlayerFavorite(player, team)} favorites={favorites} toggle={toggle} /><button type="button" className="nba-close" aria-label="Close player profile" onClick={close}><X size={20} aria-hidden="true" /></button></header>
    <ResourceMessage {...resource} />
    {resource.data && <><h3>{season - 1}–{String(season).slice(-2)} regular season · {resource.data.gamesPlayed ?? '—'} games</h3><div className="nba-segments" role="group" aria-label="Season statistic display">{(['averages', 'totals'] as const).map((mode) => <button type="button" key={mode} aria-pressed={seasonMode === mode} onClick={() => setSeasonMode(mode)}>{mode === 'averages' ? 'Per-game averages' : 'Season totals'}</button>)}</div><StatsGrid stats={resource.data[seasonMode]} label={seasonMode} />
      <h3>Recent game logs</h3><label className="nba-filter">Competition <select value={gameType} onChange={(event) => setGameType(event.target.value)}><option>All</option>{[...new Set(resource.data.games.map((game) => game.seasonType))].map((type) => <option key={type}>{type}</option>)}</select></label>
      <ScrollRow label={`${player.position} game statistics`} className="nba-stat-picker">{profileOptions(player.position).map((option) => <button type="button" key={option.key} aria-pressed={stat === option.key} onClick={() => setStat(option.key)}>{option.label}</button>)}</ScrollRow>
      {!games.length ? <p>No game logs are available for this season.</p> : <><p className="nba-note">{label} · last {games.length} games · oldest to newest</p><ScrollRow className="nba-chart" label={`${label} per game`}>{[...games].reverse().map((game) => {
        const value = game.stats[stat];
        return <div className="nba-chart-column" role="listitem" key={game.id} aria-label={`${gameDate(game.date)}, ${game.opponent}, ${label}: ${format(value)}`}><strong>{format(value)}</strong><div className="nba-chart-track">{value !== undefined && <i style={{ height: `${Math.abs(value) / maximum * 100}%` }} />}</div><b>{game.opponent || '—'}</b><small>{gameDate(game.date)}</small></div>;
      })}</ScrollRow><TableScroll label="Recent game statistics"><table className="nba-table"><thead><tr><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col">Result</th><th scope="col">{label}</th></tr></thead><tbody>{games.map((game) => <tr key={game.id}><td>{gameDate(game.date)}</td><td>{game.opponent || '—'}</td><td>{game.result} {game.score}</td><td>{format(game.stats[stat])}</td></tr>)}</tbody></table></TableScroll></>}
    </>}
    <p className="nba-note">Actual ESPN statistics. Percentages remain percentages in both views. Missing values are unavailable, never estimated. Rosters do not imply confirmed starters.</p>
  </dialog>;
}

export default function NBAExperience({ mode, games, status, query, favorites, onToggleFavorite, onRetry, onOpenStatHub, initialGameId, onSelectGame }: Props) {
  const nbaGames = useMemo(() => games.filter((game) => game.feedPath === 'basketball/nba'), [games]);
  const [selectedId, setSelectedId] = useState(initialGameId ?? '');
  const [openedGameId, setOpenedGameId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<string | null>(null);
  const [tab, setTab] = useState<'players' | 'teams' | 'plays'>('players');
  const [teamId, setTeamId] = useState('');
  const [boxTeamId, setBoxTeamId] = useState('');
  const [profile, setProfile] = useState<{ player: NBAPlayer; team: Team } | null>(null);
  const game = nbaGames.find((item) => item.id === selectedId) ?? nbaGames[0];
  const showingDetails = mode === 'stats' || nbaGames.some((item) => item.id === openedGameId);
  useEffect(() => {
    if (mode !== 'wire') return;
    if (showingDetails) detailRef.current?.focus();
    else if (returnFocus.current) {
      const buttons = boardRef.current?.querySelectorAll<HTMLButtonElement>('button[data-game-id]');
      [...buttons ?? []].find((button) => button.dataset.gameId === returnFocus.current)?.focus();
      returnFocus.current = null;
    }
  }, [mode, showingDetails]);
  const openPlayer = (player: NBAPlayer, team: Team) => setProfile({ player, team });
  useEffect(() => { if (initialGameId) { setSelectedId(initialGameId); setTeamId(''); setProfile(null); } }, [initialGameId]);
  const firstFavoriteTeam = favorites.find((favorite) => favorite.feedPath === 'basketball/nba' && favorite.type === 'team')?.id;
  useEffect(() => {
    if (!nbaGames.length || nbaGames.some((item) => item.id === selectedId)) return;
    const explicit = nbaGames.find((item) => item.id === initialGameId);
    const favoriteGame = nbaGames.find((item) => item.home.id === firstFavoriteTeam || item.away.id === firstFavoriteTeam);
    setSelectedId((explicit ?? favoriteGame ?? nbaGames[0]).id);
  }, [nbaGames, selectedId, initialGameId, firstFavoriteTeam]);
  useEffect(() => { setProfile(null); }, [game?.id, mode]);
  const loadLeague = useCallback((signal: AbortSignal) => fetchNBALeague(signal), []);
  const league = useNBAResource('nba-league', mode === 'stats' ? loadLeague : null);
  const loadSummary = useCallback((signal: AbortSignal) => fetchNBASummary(game?.eventId ?? '', signal), [game?.eventId]);
  const summary = useNBAResource(`summary:${game?.eventId ?? ''}`, game && mode === 'wire' && showingDetails ? loadSummary : null, game?.status === 'LIVE' ? 15000 : 0);
  const currentSummary = summary.data;
  const season = game?.seasonYear ?? league.data?.season;
  const allTeams = league.data?.teams ?? (game ? [game.away, game.home] : []);
  const team = allTeams.find((entry) => entry.id === teamId) ?? (game ? allTeams.find((entry) => entry.id === game.away.id) : undefined) ?? allTeams[0];
  const visibleGames = nbaGames.filter((item) => !query.trim() || `${item.away.name} ${item.away.abbr} ${item.home.name} ${item.home.abbr}`.toLowerCase().includes(query.trim().toLowerCase()));
  const upcoming = game?.status === 'UPCOMING' && currentSummary?.status !== 'in' && currentSummary?.status !== 'post';
  const boxTeam = game && (game.home.id === boxTeamId ? game.home : game.away);
  const selectGame = (item: Game) => { setSelectedId(item.id); setOpenedGameId(item.id); setTab('players'); setTeamId(''); setBoxTeamId(''); setProfile(null); onSelectGame?.(item.id); };
  return <section className="nba-experience" aria-label={mode === 'wire' ? 'NBA Wire' : 'NBA Stat Hub'}>
    <header className="nba-heading"><div><span className="eyebrow">NBA · ESPN</span><h2>{mode === 'wire' ? 'The Wire' : 'Stat Hub'}</h2></div><button type="button" onClick={() => { onRetry(); summary.retry(); league.retry(); }}>Refresh</button></header>
    {status === 'loading' && !nbaGames.length && <p role="status">Loading NBA games…</p>}
    {status === 'error' && <div className="nba-warning" role="status"><span>NBA scoreboard could not be refreshed.{nbaGames.length ? ' Showing the last available games.' : ''}</span><button type="button" onClick={onRetry}>Retry scoreboard</button></div>}
    {!nbaGames.length && status === 'ready' && <p>No NBA games on this date.{mode === 'stats' ? ' Browse every NBA team and roster below.' : ' Choose another date to browse matchups.'}</p>}
    {mode === 'wire' && !showingDetails && !!nbaGames.length && <div className="wire-board" ref={boardRef}>
      <header className="wire-board-header"><span className="eyebrow">NBA GAMES · SELECT A MATCHUP</span></header>
      <ol className="wire-board-list">{visibleGames.map((item) => <li key={item.id}>
        <button type="button" className={`wire-board-card${item.status === 'LIVE' ? ' is-live' : ''}`} data-game-id={item.id} onClick={() => selectGame(item)} aria-label={`${item.away.name} at ${item.home.name}, ${item.status === 'LIVE' ? `live ${item.period} ${item.clock}` : item.status === 'FINAL' ? 'final' : gameDate(item.date, true)}. Open ${item.status === 'UPCOMING' ? 'pregame stats' : 'box score'}`}>
          <span className="wire-board-status">{item.status === 'LIVE' ? <><span className="live-pill"><i />LIVE</span><small>{item.period} {item.clock}</small></> : item.status === 'FINAL' ? <span className="wire-board-final">FINAL</span> : <small>{gameDate(item.date, true)}</small>}</span>
          <span className="wire-board-teams">{[item.away, item.home].map((side) => <span className="wire-board-team" key={side.id}>
            <span className="team-mark wire-board-mark">{side.logo ? <OfflineImage src={side.logo} alt="" /> : side.abbr}</span>
            <span className="wire-board-team-name"><b><span className="wire-board-team-label">{side.name}</span></b><small>{side.abbr}{side.record ? ` · ${side.record}` : ''}</small></span>
            <strong className="wire-board-score">{item.status === 'UPCOMING' ? '' : side.score}</strong>
          </span>)}</span>
          <span className="wire-board-footer"><span className="wire-board-meta">{item.venue}</span><span className="wire-board-open">{item.status === 'UPCOMING' ? 'Pregame stats' : 'Box score'}<ChevronRight size={14} aria-hidden="true" /></span></span>
        </button>
      </li>)}</ol>
      {!visibleGames.length && <p role="status">No NBA games match your search.</p>}
    </div>}
    {mode === 'wire' && showingDetails && <div ref={detailRef} tabIndex={-1} className="nba-detail-navigation"><button type="button" onClick={() => { returnFocus.current = game?.id ?? null; setOpenedGameId(null); setProfile(null); }}><ChevronLeft size={16} aria-hidden="true" />All games</button></div>}
    {!!nbaGames.length && showingDetails && <><ScrollRow label="NBA games · drag or scroll to choose a matchup" className="nba-game-wheel">{visibleGames.map((item) => <button type="button" key={item.id} className={`nba-game-option${game?.id === item.id ? ' is-selected' : ''}`} aria-pressed={game?.id === item.id} onClick={() => selectGame(item)}>
      <small>{item.status === 'LIVE' ? `LIVE · ${item.period} ${item.clock}` : item.status === 'FINAL' ? 'FINAL' : gameDate(item.date, true)}</small>
      {[item.away, item.home].map((side) => <span key={side.id}>{side.logo && <OfflineImage src={side.logo} alt="" />}<b>{side.abbr}</b><strong>{item.status === 'UPCOMING' ? '—' : side.score}</strong></span>)}
    </button>)}</ScrollRow>{!visibleGames.length && <p>No matchups match your search. Player searches apply to the roster below.</p>}</>}
    {game && showingDetails && <><div className="nba-matchup"><div>{game.away.logo && <OfflineImage src={game.away.logo} alt="" />}<strong>{game.away.name}</strong><FavoriteButton target={nbaTeamFavorite(game.away)} favorites={favorites} toggle={onToggleFavorite} /></div><div className="nba-score" aria-live="polite"><b>{upcoming ? 'vs' : `${currentSummary?.awayScore ?? game.away.score} – ${currentSummary?.homeScore ?? game.home.score}`}</b><small>{currentSummary?.status === 'post' || game.status === 'FINAL' ? 'FINAL' : upcoming ? gameDate(game.date, true) : `${currentSummary?.period || game.period} · ${currentSummary?.clock || game.clock}`}</small></div><div>{game.home.logo && <OfflineImage src={game.home.logo} alt="" />}<strong>{game.home.name}</strong><FavoriteButton target={nbaTeamFavorite(game.home)} favorites={favorites} toggle={onToggleFavorite} /></div></div>
      {game.venue && <p className="nba-note">{game.venue}</p>}
    </>}
    {mode === 'wire' && game && showingDetails && <>
      {onOpenStatHub && <button type="button" className="nba-open-stats" onClick={() => onOpenStatHub(game.id)}>Open matchup in Stat Hub</button>}
      <div className="nba-segments" role="group" aria-label="NBA game detail views">{([{ key: 'players', label: 'Player Box Score' }, { key: 'teams', label: 'Team Comparison' }, { key: 'plays', label: 'Play-by-Play' }] as const).map((item) => <button type="button" key={item.key} aria-pressed={tab === item.key} onClick={() => setTab(item.key)}>{item.label}</button>)}</div>
      <ResourceMessage {...summary} />
      {tab === 'players' && boxTeam && <><div className="nba-segments nba-team-toggle" role="group" aria-label="Box score team">{[game.away, game.home].map((side) => <button type="button" key={side.id} aria-pressed={boxTeam.id === side.id} onClick={() => setBoxTeamId(side.id)}>{side.logo && <OfflineImage src={side.logo} alt="" />}{side.name}</button>)}</div>
        {upcoming ? <><p className="nba-note">Pregame rosters · open a player for actual season statistics. Starters are not confirmed.</p><Roster key={`${boxTeam.id}:${game.seasonYear}`} team={boxTeam} season={game.seasonYear} query={query} favorites={favorites} toggle={onToggleFavorite} open={openPlayer} /></> : <PlayerBox key={boxTeam.id} team={boxTeam} box={currentSummary?.teams.find((item) => item.id === boxTeam.id)} favorites={favorites} toggle={onToggleFavorite} open={openPlayer} />}
      </>}
      {tab === 'teams' && (upcoming ? <PregameComparison game={game} /> : <Comparison away={game.away} home={game.home} awayStats={currentSummary?.teams.find((item) => item.id === game.away.id)?.stats ?? []} homeStats={currentSummary?.teams.find((item) => item.id === game.home.id)?.stats ?? []} />)}
      {tab === 'plays' && <PlayByPlay plays={currentSummary?.plays ?? []} game={game} upcoming={upcoming} />}
    </>}
    {mode === 'stats' && <><ResourceMessage {...league} />{!!allTeams.length && <label className="nba-filter">NBA team <select value={team?.id ?? ''} onChange={(event) => { setTeamId(event.target.value); setProfile(null); }}>{allTeams.map((side) => <option value={side.id} key={side.id}>{side.name}</option>)}</select></label>}{team && season !== undefined && <><TeamSeason key={`team:${team.id}:${season}`} team={team} season={season} /><Roster key={`roster:${team.id}:${season}`} team={team} season={season} query={query} favorites={favorites} toggle={onToggleFavorite} open={openPlayer} /></>}</>}
    <p className="nba-note">Public ESPN feeds · live game details refresh every 15 seconds while visible. Missing statistics display —; DNP is not zero. NBA favorites are saved to your Locker Room without NBA notifications.</p>
    {profile && season !== undefined && <PlayerProfile key={`${profile.player.id}:${season}`} {...profile} season={season} favorites={favorites} toggle={onToggleFavorite} close={() => setProfile(null)} />}
  </section>;
}
