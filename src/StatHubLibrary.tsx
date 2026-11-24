import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { PlayerProfile } from './NBAExperience';
import StatHubHeader from './StatHubHeader';
import TeamAbbrMark from './TeamAbbrMark';
import { readStatHubDirectory, readStatHubGroups, statHubWeek, warmStatHubLibrary } from './services/statHubLibrary';
import { restoreStatSnapshots, subscribeRenderSnapshots } from './services/renderSnapshots';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';
import type { FavoriteTarget, NFLSkillPlayer, Team } from './services/sportsData';
import type { NBAPlayer } from './services/nbaData';

export default function StatHubLibrary({ league, query, favorites, toggle, openNFL }: {
  league: 'NFL' | 'NBA'; query: string; favorites: FavoriteTarget[];
  toggle: (favorite: FavoriteTarget) => void; openNFL: (player: NFLSkillPlayer, team: Team) => void;
}) {
  const [groups, setGroups] = useState(() => readStatHubGroups(league));
  const [season, setSeason] = useState(() => readStatHubDirectory(league)?.season);
  const [teamId, setTeamId] = useState('All'), [position, setPosition] = useState('All');
  const [favoritesOnly, setFavoritesOnly] = useState(false), [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false), [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<{ player: NBAPlayer; team: Team } | null>(null);
  useEffect(() => {
    const update = () => { setGroups(readStatHubGroups(league)); setSeason(readStatHubDirectory(league)?.season); };
    const subscriptions = ['teamDirectory', 'nflStatHubTeam', 'nbaRoster'] as const;
    const stops = subscriptions.map(kind => subscribeRenderSnapshots(update, { kind }));
    void restoreStatSnapshots().then(update);
    update();
    return () => stops.forEach(stop => stop());
  }, [league]);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false, force = retry > 0;
    const refresh = async () => {
      if (pending || controller.signal.aborted) return;
      if (!navigator.onLine) { setError('Offline: saved players and logs remain available. Connect to download missing stats.'); return; }
      pending = true; setLoading(true); setError('');
      const forceThisRun = force; force = false;
      try {
        await warmStatHubLibrary(league, controller.signal, (label, failures) => {
          if (!controller.signal.aborted) { setProgress(label); setError(failures.length ? `${failures.length} downloads could not refresh. ${failures.at(-1)}` : ''); }
        }, forceThisRun);
      } catch (cause) {
        if (!controller.signal.aborted) {
          console.error('Stat Hub library refresh failed', cause);
          setError(cause instanceof Error ? cause.message : 'Player library could not refresh. Saved players remain available.');
        }
      } finally { pending = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh();
    const stop = subscribeForegroundRefresh(() => void refresh());
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, statHubWeek);
    return () => { controller.abort(); stop(); window.clearInterval(timer); };
  }, [league, retry]);
  const target = (player: { id: string; name: string; position: string }, team: Team): FavoriteTarget => ({
    key: `player:${league === 'NFL' ? 'football/nfl' : 'basketball/nba'}:${player.id}`, type: 'player',
    id: player.id, name: player.name, shortName: player.name, position: player.position, teamId: team.id, teamName: team.name,
    teamAbbr: team.abbr, feedPath: league === 'NFL' ? 'football/nfl' : 'basketball/nba',
  });
  const positions = [...new Set(groups.flatMap(group => group.players.map(player => player.position)))].sort();
  const search = query.trim().toLowerCase();
  const visible = groups.filter(group => teamId === 'All' || group.team.id === teamId).map(group => ({ ...group,
    players: group.players.filter(player => (position === 'All' || player.position === position)
      && `${player.name} ${group.team.name} ${group.team.abbr}`.toLowerCase().includes(search)
      && (!favoritesOnly || favorites.some(favorite => favorite.key === target(player, group.team).key)))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter(group => group.players.length);
  return <section className="nfl-players-directory stat-hub-workspace" aria-label={`${league} saved player library`}>
    <StatHubHeader sport={league} />
    <div className="stat-hub-filters">
      <label>Team<select value={teamId} onChange={event => setTeamId(event.target.value)}><option value="All">All teams</option>
        {groups.map(group => <option key={group.team.id} value={group.team.id}>{group.team.name}</option>)}</select></label>
      <label>Position<select value={position} onChange={event => setPosition(event.target.value)}><option value="All">All positions</option>
        {positions.map(item => <option key={item}>{item}</option>)}</select></label>
      <button type="button" className={favoritesOnly ? 'active' : ''} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}>Favorites</button>
      <button type="button" disabled={loading || !navigator.onLine} onClick={() => setRetry(value => value + 1)}>Refresh saved stats</button>
    </div>
    <div className="stat-hub-library-status"><b>{visible.reduce((count, group) => count + group.players.length, 0)} players</b>
      <span role="status">{loading ? `Saving in background: ${progress || 'team directory'}` : 'Saved locally · weekly refresh'}</span></div>
    {error && <p className="feed-warning" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    <div className="nfl-directory-grid">{visible.map(group => <section className="nfl-directory-team" key={group.team.id}>
      <header><TeamAbbrMark abbr={group.team.abbr} color={group.team.color} name={group.team.name} /><b>{group.team.name}</b></header>
      <div className="nfl-directory-player-list">{group.players.map(player => <div className="nfl-directory-player" key={player.id}>
        <button type="button" className="nfl-directory-player-main" aria-label={`View ${player.name} stats`} onClick={() => {
          if ('recentGames' in player) openNFL(player, group.team); else setProfile({ player, team: group.team });
        }}><span><b>{player.name}</b><small>{player.position}{player.jersey && ` · #${player.jersey}`}</small></span><span className="stat-hub-open">Game logs <ChevronRight size={14} /></span></button>
        <button type="button" className="favorite-star-button" aria-label={`${favorites.some(favorite => favorite.key === target(player, group.team).key) ? 'Unfavorite' : 'Favorite'} ${player.name}`}
          aria-pressed={favorites.some(favorite => favorite.key === target(player, group.team).key)} onClick={() => toggle(target(player, group.team))}>★</button>
      </div>)}</div></section>)}</div>
    {!visible.length && <p role="status">{groups.some(group => group.players.length) ? 'No players match these filters.' : loading ? 'Downloading rosters. Players appear as each team is saved.' : 'No saved players yet. Connect and refresh to download the library.'}</p>}
    {profile && season && <PlayerProfile player={profile.player} team={profile.team} season={season} favorites={favorites} toggle={toggle}
      cacheAge={statHubWeek} close={() => setProfile(null)} />}
  </section>;
}
