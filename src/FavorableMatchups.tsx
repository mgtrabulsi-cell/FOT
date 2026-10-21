import OfflineImage from './OfflineImage';
import { usePublicDataRevision } from './usePublicDataRevision';
import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { supabase } from './services/supabaseClient';
import { fetchNFLActiveSkillRoster, fetchNFLGameDetails } from './services/sportsData';
import type { Game, NFLGameDetails } from './services/sportsData';
import { fetchPlayerAverage, fetchPPRWeek, isMatchupPosition, matchupPositions, matchupStats, moveMatchupPick, readMatchupPicks } from './services/matchupBoard';
import type { MatchupPick } from './services/matchupBoard';
import { picksReadKey } from './services/analystReads';
import { useAnalystReadObserver } from './useAnalystReadObserver';
import type { AnalystSeen } from './useAnalystReadObserver';

type Board = { picks: MatchupPick[]; revision: number };
type Props = { games: Game[]; season: number | null; week: number | null; user: User | null; onSeen?: AnalystSeen; boardType?: 'top' | 'hate' };
const message = (cause: unknown) => cause !== null && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
  ? cause.message : 'The matchup request failed. Please retry.';

export default function FavorableMatchups({ games, season, week, user, onSeen, boardType = 'top' }: Props) {
  const title = boardType === 'hate' ? 'Hate Watch' : 'Admins Top Performers';
  const publicRevision = usePublicDataRevision('matchups');
  const [published, setPublished] = useState<Board>({ picks: [], revision: 0 });
  const [draft, setDraft] = useState<Board | null>(null);
  const [admin, setAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [accessError, setAccessError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<MatchupPick[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');
  const [details, setDetails] = useState<Map<string, NFLGameDetails>>(new Map());
  const [projections, setProjections] = useState<Map<string, number>>(new Map());
  const [actuals, setActuals] = useState<Map<string, number>>(new Map());
  const [statsError, setStatsError] = useState('');
  const [projectionError, setProjectionError] = useState('');
  const [averages, setAverages] = useState<Map<string, { average: number | null; games: number }>>(new Map());
  const [averageLoading, setAverageLoading] = useState(false);
  const [averageError, setAverageError] = useState('');
  const boardRevision = useRef(0);
  const picks = (admin ? draft : null)?.picks ?? published.picks;
  const weeklyGames = games.filter((game) => game.league === 'NFL' && game.seasonYear === season);
  const scheduleKey = weeklyGames.map((game) => `${game.id}:${game.status}`).sort().join('|');
  const pickGameKey = [...new Set(picks.map((pick) => pick.gameId))].sort().join('|');
  const pickPlayerKey = picks.map((pick) => pick.id).sort().join('|');
  const publishedVisible = loaded && published.revision > 0 && !(admin && draft);
  const readObserver = useAnalystReadObserver(boardType === 'hate' ? 'hate' : 'picks', onSeen, user?.id, `${boardType}:${season}:${week}:${published.revision}:${publishedVisible}`);
  const readKey = (playerId: string) => publishedVisible && season && week ? picksReadKey(season, week, published.revision, playerId) : undefined;

  useEffect(() => { setProjections(new Map()); setActuals(new Map()); }, [season, week, pickPlayerKey]);
  useEffect(() => { setAdmin(false); }, [user?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setAccessError('');
    if (supabase && user) {
      void Promise.resolve(supabase.from('livewire_roles').select('role').eq('user_id', user.id).maybeSingle()).then(({ data, error }) => {
        if (!active) return;
        if (error) { setAdmin(false); setAccessError(`Could not check matchup publishing permissions: ${error.message}`); }
        else setAdmin(data?.role === 'admin' || data?.role === 'owner');
      }).catch((cause: unknown) => { if (active) { setAdmin(false); setAccessError(message(cause)); } });
    }
    return () => { active = false; };
  }, [user?.id, refresh]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) throw new Error('Matchup publishing is unavailable: account services are not configured.');
      if (!season || !week) return;
      const board = await supabase.from('matchup_boards').select('picks,revision').eq('board_type', boardType).eq('season', season).eq('week', week).maybeSingle();
      if (!active) return;
      if (board.error) throw new Error(`Could not load published matchups: ${board.error.message}`);
      const next = { picks: readMatchupPicks(board.data?.picks ?? []), revision: board.data?.revision ?? 0 };
      if (next.revision >= boardRevision.current) {
        boardRevision.current = next.revision;
        setPublished(next);
      }
      setLoaded(true);
      setLoadError('');
    }
    void load().catch((cause: unknown) => { if (active) setLoadError(message(cause)); });
    return () => { active = false; };
  }, [boardType, season, week, user?.id, refresh, publicRevision]);

  useEffect(() => {
    if (!admin || !season || !scheduleKey) { setCandidates([]); return; }
    let active = true;
    async function load() {
      setRosterLoading(true); setRosterError('');
      const next: MatchupPick[] = [];
      const failures: string[] = [];
      const teams = weeklyGames.flatMap((game) => [game.away, game.home].map((team) => ({ game, team })));
      for (let start = 0; start < teams.length; start += 6) {
        await Promise.all(teams.slice(start, start + 6).map(async ({ game, team }) => {
          try {
            const roster = await fetchNFLActiveSkillRoster(game.feedPath, team.id, game.seasonYear);
            roster.forEach((player) => {
              if (isMatchupPosition(player.position)) next.push({
                id: player.id, name: player.name, position: player.position, teamId: team.id, gameId: game.id, headshot: player.headshot ?? '',
              });
            });
          } catch (cause) { failures.push(`${team.abbr}: ${message(cause)}`); }
        }));
        if (!active) return;
      }
      setCandidates(next.sort((first, second) => first.name.localeCompare(second.name)));
      setRosterError(failures.length ? `Some rosters could not load. ${failures.join(' ')}` : '');
      setRosterLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [admin, season, scheduleKey, refresh, publicRevision]);

  useEffect(() => {
    const controller = new AbortController();
    if (!season || !week || !pickGameKey) { setDetails(new Map()); setStatsError(''); return; }
    async function loadStats() {
      setStatsError('');
      const selected = weeklyGames.filter((game) => pickGameKey.split('|').includes(game.id));
      const results = await Promise.allSettled(selected.map(async (game) => ({
        id: game.id,
        details: await fetchNFLGameDetails(game.feedPath, game.eventId, game.seasonYear, [game.away, game.home], controller.signal),
      })));
      if (controller.signal.aborted) return;
      const next = new Map<string, NFLGameDetails>();
      const errors: string[] = [];
      results.forEach((result) => {
        if (result.status === 'fulfilled') next.set(result.value.id, result.value.details);
        else errors.push(message(result.reason));
      });
      setDetails((previous) => new Map(selected.flatMap((game) => {
        const value = next.get(game.id) ?? previous.get(game.id);
        return value ? [[game.id, value] as const] : [];
      })));
      setStatsError(errors.length ? `Some player statistics are unavailable. ${errors.join(' ')}` : '');
    }
    void loadStats().catch((cause: unknown) => {
      if (!controller.signal.aborted) setStatsError(message(cause));
    });
    return () => controller.abort();
  }, [season, week, scheduleKey, pickGameKey, refresh, publicRevision]);

  useEffect(() => {
    const controller = new AbortController();
    if (!pickPlayerKey || !scheduleKey) { setAverages(new Map()); setAverageLoading(false); setAverageError(''); return; }
    async function load() {
      setAverageLoading(true); setAverageError('');
      const next = new Map<string, { average: number | null; games: number }>();
      const errors: string[] = [];
      for (let start = 0; start < picks.length; start += 4) {
        await Promise.all(picks.slice(start, start + 4).map(async (pick) => {
          const game = weeklyGames.find((item) => item.id === pick.gameId);
          if (!game) return;
          try { next.set(pick.id, await fetchPlayerAverage(pick, game, controller.signal)); }
          catch (cause) { errors.push(`${pick.name}: ${message(cause)}`); }
        }));
        if (controller.signal.aborted) return;
      }
      setAverages((previous) => new Map(picks.flatMap((pick) => {
        const value = next.get(pick.id) ?? previous.get(pick.id);
        return value ? [[pick.id, value] as const] : [];
      })));
      setAverageError(errors.length ? `Player game logs could not refresh. ${errors.join(' ')}` : '');
      setAverageLoading(false);
    }
    void load();
    return () => controller.abort();
  }, [season, week, scheduleKey, pickGameKey, pickPlayerKey, refresh, publicRevision]);

  useEffect(() => {
    const controller = new AbortController();
    setProjectionError('');
    if (!season || !week || !pickPlayerKey) return;
    void fetchPPRWeek(season, week, pickPlayerKey.split('|'), controller.signal).then((data) => {
      if (!controller.signal.aborted) { setProjections(data.projections); setActuals(data.actuals); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setProjectionError(`ESPN weekly PPR projections are unavailable. ${message(cause)}`);
    });
    return () => controller.abort();
  }, [season, week, pickPlayerKey, refresh, publicRevision]);

  function edit(next: MatchupPick[]) {
    setDraft({ picks: next, revision: draft?.revision ?? published.revision });
    setNotice(''); setActionError('');
  }

  async function publish() {
    if (!supabase || !draft || !season || !week || busy) return;
    setBusy(true); setActionError(''); setNotice('');
    try {
      const result = await supabase.rpc('publish_fantasy_board', {
        board_season: season, board_week: week, board_picks: draft.picks, expected_revision: draft.revision, board_kind: boardType,
      });
      if (result.error) throw result.error;
      boardRevision.current = result.data;
      setPublished({ picks: draft.picks, revision: result.data });
      setDraft(null);
      setNotice(`Published ${title} for ${season}, Week ${week}.`);
      setRefresh((value) => value + 1);
    } catch (cause) { setActionError(message(cause)); }
    finally { setBusy(false); }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const matches = candidates.filter((pick) => {
    const game = weeklyGames.find((item) => item.id === pick.gameId);
    const team = game && [game.away, game.home].find((item) => item.id === pick.teamId);
    return `${pick.name} ${pick.position} ${team?.name ?? ''} ${team?.abbr ?? ''}`.toLowerCase().includes(normalizedQuery);
  });

  return <section className="favorable-matchups" aria-label={title}>
    <h2>{title}</h2>
    <p className="angle-disclaimer">{boardType === 'hate' ? 'Admin opinions: players we think may underperform this week. Not guaranteed outcomes or betting recommendations.' : 'Admin opinions: players we think may perform well this week. Not guaranteed outcomes or betting recommendations.'}</p>
    <header className="favorable-matchups-heading">
      <div className="matchup-title-row"><span className="favorable-matchups-count">{season && week ? `WEEK ${week} · ` : ''}{picks.length} PLAYERS{draft && admin ? ' · DRAFT' : ''}</span>
        {admin && loaded && <label className="search-field matchup-admin-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search players to publish" placeholder="Search players or teams..." value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} /></label>}
      </div>
    </header>
    {(loadError || accessError) && <p className="feed-warning" role="alert">{loadError || accessError} <button onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
    {!loaded && !loadError && <p role="status">Loading this week's published matchups...</p>}
    {admin && loaded && <div className="matchup-editor">
      <p>Up to four players per position. Private until published.</p>
      {rosterLoading && <p role="status">Loading player search...</p>}
      {rosterError && <p className="feed-warning" role="alert">{rosterError} <button onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
      {normalizedQuery && <div className="matchup-search-results" aria-label="Player search results">
        {matches.slice(0, 30).map((pick) => {
          const selected = picks.some((item) => item.id === pick.id);
          const full = picks.filter((item) => item.position === pick.position).length >= 4;
          const game = weeklyGames.find((item) => item.id === pick.gameId);
          return <button key={pick.id} disabled={busy || selected || full} onClick={() => { edit([...picks, pick]); setQuery(''); }}>
            <span><b>{pick.name}</b><small>{pick.position} · {game ? `${game.away.abbr} @ ${game.home.abbr}` : 'Matchup unavailable'}</small></span>
            <span>{selected ? 'Selected' : full ? `${pick.position} full` : 'Add player'}</span>
          </button>;
        })}
        {!matches.length && !rosterLoading && <p>No players match this search.</p>}
        {matches.length > 30 && <p>Showing 30 results. Refine your search to see more.</p>}
      </div>}
      <div className="matchup-publish-actions"><button disabled={busy || !draft || !!loadError} onClick={() => void publish()}>{busy ? 'Publishing...' : `Publish ${title}`}</button>
        {draft && <button disabled={busy} onClick={() => { setDraft(null); setActionError(''); setNotice('Draft discarded.'); setRefresh((value) => value + 1); }}>Discard changes / reload</button>}
      </div>
    </div>}
    {actionError && <p className="feed-warning" role="alert">{actionError}</p>}
    {notice && <p role="status" className="livewire-notice">{notice}</p>}
    {readObserver.error && <p className="feed-warning" role="status">{readObserver.error}</p>}
    {statsError && <p className="feed-warning" role="alert">{statsError}</p>}
    {projectionError && <p className="feed-warning" role="alert">{projectionError}</p>}
    {averageError && <p className="feed-warning" role="alert">{averageError}</p>}
    <div ref={readObserver.root}>
    {publishedVisible && !picks.length && <p className="nfl-empty-note" data-post-id={readKey('empty')}>No {title} players are published on this version of the weekly board.</p>}
    {loaded && <div className="favorable-matchup-groups">{matchupPositions.map((position) => {
      const group = picks.filter((pick) => pick.position === position);
      const stat = matchupStats[position];
      return <section className="favorable-matchup-group" key={position}>
        <header><h3>{stat.title}</h3><span>{group.length} / 4</span></header>
        {!group.length && <p className="nfl-empty-note">No {position} matchups published for this week.</p>}
        <div className="favorable-matchup-list">{group.map((pick, index) => {
          const game = weeklyGames.find((item) => item.id === pick.gameId);
          const team = game && [game.away, game.home].find((item) => item.id === pick.teamId);
          const opponent = game && (game.home.id === pick.teamId ? game.away : game.home);
          const gameDetails = details.get(pick.gameId);
          const average = averages.get(pick.id) ?? { average: null, games: 0 };
          const rank = gameDetails?.teamForms.find((form) => form.teamId === opponent?.id)?.defenseRanks[stat.defense];
          const projection = projections.get(pick.id);
          const actual = game?.status === 'UPCOMING' ? undefined : actuals.get(pick.id);
          const final = game?.status === 'FINAL';
          const actualTone = !final || actual === undefined || projection === undefined || actual === projection ? '' : actual > projection ? ' is-over' : ' is-under';
          return <article className="favorable-matchup-item" data-post-id={readKey(pick.id)} key={`${published.revision}:${pick.id}`}>
            <div className="favorable-matchup-player"><span className="favorable-matchup-rank">{index + 1}</span><span className="nfl-player-avatar">{pick.headshot ? <OfflineImage src={pick.headshot} alt="" /> : pick.name.slice(0, 1)}</span><span className="favorable-matchup-player-copy"><b>{pick.name}</b><small>{team?.abbr ?? 'Team unavailable'} · {position}</small><small>{opponent ? `${game?.home.id === pick.teamId ? 'vs' : '@'} ${opponent.abbr}` : 'Matchup unavailable'}{game && ` · ${new Date(game.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}</small></span></div>
            <div className="favorable-matchup-metrics"><div><b>{average.average?.toFixed(1) ?? '—'}</b><span>{stat.label} / game</span><small>{average.average === null ? averageLoading ? 'Loading...' : averageError ? 'Retrying game log' : 'No recorded games' : `last ${average.games} games`}</small></div>
              <div><b>{rank === null || rank === undefined ? '—' : `#${rank}`}</b><span>{position === 'QB' ? 'Pass' : position === 'RB' ? 'Rush' : 'Receiving'} defense rank</span><small>{opponent?.abbr ?? 'Unavailable'} · yards</small></div>
              <div><b>{projection?.toFixed(1) ?? '—'}</b><span>Projected PPR</span><small>{projection === undefined ? 'Unavailable' : `ESPN · Week ${week}`}</small></div>
              <div><b className={`favorable-matchup-actual${actualTone}`}>{actual?.toFixed(1) ?? '—'}</b><span>Actual PPR</span><small>{game?.status === 'UPCOMING' ? 'Not started' : actual === undefined ? 'Unavailable' : final ? 'Final' : 'Live'}</small></div></div>
            {admin && <div className="matchup-rank-actions">
              <button aria-label={`Move ${pick.name} up`} disabled={busy || index === 0} onClick={() => edit(moveMatchupPick(picks, pick.id, -1))}><ChevronUp size={16} /></button>
              <button aria-label={`Move ${pick.name} down`} disabled={busy || index === group.length - 1} onClick={() => edit(moveMatchupPick(picks, pick.id, 1))}><ChevronDown size={16} /></button>
              <button aria-label={`Remove ${pick.name}`} disabled={busy} onClick={() => edit(picks.filter((item) => item.id !== pick.id))}><X size={16} /></button>
            </div>}
          </article>;
        })}</div>
      </section>;
    })}</div>}
    </div>
    <p className="nfl-data-note">Averages use each player's regular-season game log before the selected matchup, with up to five recent games and the reported sample count shown. Preseason games are excluded; missing statistics are not treated as zero. Defense ranks are season-to-date yards ranks, not fantasy points allowed by position. ESPN projections and actual points use PPR scoring for the exact season and week; actual points are colored green above or red below the projection once the game is final. Unavailable projections are not estimated. Selections are editorial, not confirmed starters.</p>
  </section>;
}
