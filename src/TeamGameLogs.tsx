import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import TeamAbbrMark from './TeamAbbrMark';
import TheWire from './TheWire';
import NBAExperience from './NBAExperience';
import { useSwipeBack } from './useSwipeBack';
import { useOnlineStatus } from './OfflineStatus';
import { fetchTeamGameLog, fetchTeamLogDirectory, teamLogKey, teamLogResult, teamSeasonLabel } from './services/teamGameLogs';
import type { TeamLogDirectory, TeamLogEntry, TeamLogLeague } from './services/teamGameLogs';
import { readRenderSnapshot } from './services/renderSnapshots';
import type { FavoriteTarget, Game, NFLSkillPlayer, Team } from './services/sportsData';

type Props = {
  league: TeamLogLeague;
  favorites: FavoriteTarget[];
  onToggleFavorite: (favorite: FavoriteTarget) => void;
  onOpenPlayer: (player: NFLSkillPlayer, team: Team) => void;
};
const phases = { 1: 'Preseason', 2: 'Regular season', 3: 'Playoffs' } as const;

export default function TeamGameLogs({ league, favorites, onToggleFavorite, onOpenPlayer }: Props) {
  const [team, setTeam] = useState<Team | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [search, setSearch] = useState('');
  const [directoryRetry, setDirectoryRetry] = useState(0), [gamesRetry, setGamesRetry] = useState(0);
  const [directory, setDirectory] = useState<{ data: TeamLogDirectory | null; loading: boolean; error: string }>(() => ({
    data: readRenderSnapshot('teamDirectory', league), loading: true, error: '',
  }));
  const [schedule, setSchedule] = useState<{ key: string; entries: TeamLogEntry[]; loading: boolean; error: string }>({
    key: '', entries: [], loading: false, error: '',
  });
  const online = useOnlineStatus();
  const returnGame = useRef<string | null>(null);
  const back = () => { if (game) setGame(null); else setTeam(null); };
  const root = useSwipeBack<HTMLDivElement>(back, !!team && (!game || league === 'NBA'));
  const season = selectedSeason ?? directory.data?.season;
  const key = team && season ? teamLogKey(league, team.id, season) : '';
  const entries = schedule.key === key ? schedule.entries : readRenderSnapshot('teamGameLog', key)?.entries ?? [];

  useEffect(() => {
    const controller = new AbortController();
    setDirectory(previous => ({ ...previous, loading: true, error: '' }));
    void fetchTeamLogDirectory(league, controller.signal, directoryRetry > 0).then(data => {
      if (!controller.signal.aborted) setDirectory({ data, loading: false, error: '' });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setDirectory(previous => ({ ...previous, loading: false,
        error: cause instanceof Error ? cause.message : 'Team directory is unavailable.' }));
    });
    return () => controller.abort();
  }, [league, directoryRetry]);

  useEffect(() => {
    if (!team || !season) return;
    const controller = new AbortController();
    const teamId = team.id;
    setSchedule(previous => ({ key, entries: previous.key === key ? previous.entries : readRenderSnapshot('teamGameLog', key)?.entries ?? [], loading: true, error: '' }));
    void fetchTeamGameLog(league, teamId, season, controller.signal, gamesRetry > 0).then(data => {
      if (!controller.signal.aborted) setSchedule({ key, entries: data, loading: false, error: '' });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setSchedule(previous => ({ ...previous, loading: false,
        error: cause instanceof Error ? cause.message : 'Team game log is unavailable.' }));
    });
    return () => controller.abort();
  }, [league, team?.id, season, key, gamesRetry]);

  useEffect(() => {
    if (!game && returnGame.current) {
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>('[data-team-log-game]');
      [...buttons ?? []].find(button => button.dataset.teamLogGame === returnGame.current)?.focus();
      returnGame.current = null;
    } else root.current?.focus();
  }, [team?.id, game?.id, season, root]);

  if (game) return <div className="team-game-logs" ref={root} tabIndex={-1}>
    <h2>{team?.name} · {teamSeasonLabel(league, game.seasonYear)}</h2>
    {league === 'NBA' ? <NBAExperience mode="wire" heading="Box score" games={[game]} status="ready" query="" favorites={favorites}
      onToggleFavorite={onToggleFavorite} onRetry={() => setGamesRetry(value => value + 1)}
      initialGameId={game.id} openGameId={game.id} onBackToGames={() => setGame(null)} backLabel="Team game log" />
      : <TheWire games={[game]} query="" favorites={favorites} featuredFavoriteTeamId={team?.id ?? null}
        onToggleFavorite={onToggleFavorite} onOpenPlayer={onOpenPlayer} initialGameId={game.id} openGameId={game.id}
        onBackToGames={() => setGame(null)} backLabel="Team game log" gameListLabel="NFL · SELECTED GAME" />}
  </div>;

  return <div className="team-game-logs" ref={root} tabIndex={-1}>
    {!online && <p className="nfl-data-note" role="status">Offline: previously loaded teams, games and box scores remain available when saved on this device.</p>}
    {directory.error && <p className="feed-warning" role="alert">{directory.error} {directory.data && 'Showing saved teams.'} <button type="button" onClick={() => setDirectoryRetry(value => value + 1)}>Retry teams</button></p>}
    {team ? <>
      <button type="button" className="wire-back-button" onClick={() => setTeam(null)}><ChevronLeft size={16} aria-hidden="true" />All {league} teams</button>
      <header className="team-log-heading"><TeamAbbrMark large abbr={team.abbr} name={team.name} color={team.color} /><div><span className="eyebrow">{league} TEAM GAME LOG</span><h2>{team.name}</h2></div>
        <label>Season<select aria-label={`${league} team game-log season`} value={season ?? ''} onChange={event => setSelectedSeason(Number(event.target.value))}>
          {directory.data && Array.from({ length: directory.data.season - 2001 }, (_, index) => directory.data!.season - index).map(year =>
            <option key={year} value={year}>{teamSeasonLabel(league, year)}</option>)}
        </select></label>
      </header>
      <p className="nfl-data-note">Every available completed game in the selected season, newest first. Select a matchup to inspect player and team box scores.</p>
      {schedule.key === key && schedule.loading && <p role="status">{entries.length ? 'Refreshing team games…' : 'Loading team games…'}</p>}
      {schedule.key === key && schedule.error && <p className="feed-warning" role="alert">{schedule.error} {entries.length > 0 && 'Showing saved games.'} <button type="button" onClick={() => setGamesRetry(value => value + 1)}>Retry games</button></p>}
      {entries.length > 0 && <><p className="team-log-count">{entries.length} completed games · {teamSeasonLabel(league, season!)}</p>
        <ol className="team-log-games">{entries.map(entry => {
          const item = entry.game, home = item.home.id === team.id, own = home ? item.home : item.away, opponent = home ? item.away : item.home;
          const result = teamLogResult(item, team.id);
          const date = new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          return <li key={item.id}><button type="button" className="team-game-row" data-team-log-game={item.id}
            aria-label={`${date}, ${team.name} ${home ? 'vs' : 'at'} ${opponent.name}, ${result === 'W' ? 'win' : result === 'L' ? 'loss' : 'tie'} ${own.score} to ${opponent.score}. Open box score`}
            onClick={() => { returnGame.current = item.id; setGame(item); }}>
            <span className="team-log-date">{date}<small>{phases[entry.seasonType]}</small></span>
            <span className="team-log-opponent"><small>{home ? 'vs' : '@'}</small><TeamAbbrMark abbr={opponent.abbr} color={opponent.color} name={opponent.name} /><b>{opponent.name}</b></span>
            <span className={`team-log-result is-${result.toLowerCase()}`}>{result}</span>
            <strong className="team-log-score">{own.score}–{opponent.score}</strong>
            <span className="team-log-open">Box score <ChevronRight size={14} aria-hidden="true" /></span>
          </button></li>;
        })}</ol></>}
      {schedule.key === key && !schedule.loading && !schedule.error && !entries.length && <p role="status">No completed {league} games are available for this team in {teamSeasonLabel(league, season!)}.</p>}
    </> : <>
      <header className="team-log-heading"><div><span className="eyebrow">{league} · TEAM GAME LOGS</span><h2>Choose a team</h2></div>
        <label>Find a team<input type="search" aria-label={`Find ${league} team`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Team name or abbreviation" /></label>
      </header>
      {directory.loading && !directory.data && <p role="status">Loading {league} teams…</p>}
      <div className="team-log-directory">{directory.data?.teams.filter(item => `${item.name} ${item.abbr}`.toLowerCase().includes(search.trim().toLowerCase())).map(item =>
        <button type="button" key={item.id} onClick={() => { setTeam(item); setSelectedSeason(null); }}>
          <TeamAbbrMark abbr={item.abbr} color={item.color} name={item.name} /><span>{item.name}</span><ChevronRight size={16} aria-hidden="true" />
        </button>)}</div>
      {directory.data && !directory.data.teams.some(item => `${item.name} ${item.abbr}`.toLowerCase().includes(search.trim().toLowerCase())) && <p role="status">No teams match your search.</p>}
    </>}
  </div>;
}
