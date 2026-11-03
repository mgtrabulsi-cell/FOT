import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { isRosterSport, loadParlayPlayers, loadParlayTeams } from './services/parlayRoster';
import type { ParlayPlayer, ParlayTeam } from './services/parlayRoster';
import type { RosterSport } from './services/parlayRoster';
import type { BestBetSubject } from './services/bestBetGraphic';
import { readGraphicPhoto } from './services/graphicPhoto';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Player / team names could not load. Retry.';
export default function BestBetSubjectPicker({ sport, value, onChoose, children }: {
  sport: string; value?: BestBetSubject; onChoose: (sport: RosterSport, value?: BestBetSubject) => void; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false), [league, setLeague] = useState<RosterSport>(isRosterSport(sport) ? sport : 'NFL');
  const [teams, setTeams] = useState<ParlayTeam[]>([]), [season, setSeason] = useState(0), [teamId, setTeamId] = useState('');
  const [type, setType] = useState<'player' | 'team'>(sport === 'UCL' ? 'team' : 'player'), [players, setPlayers] = useState<ParlayPlayer[]>([]);
  const [query, setQuery] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState(''), [warning, setWarning] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setTeams([]); setPlayers([]); setTeamId(''); setSeason(0); setError(''); setWarning(''); setLoading(true);
    void loadParlayTeams(league, controller.signal).then(({ data, warning }) => {
      if (!controller.signal.aborted) { setTeams(data.teams); setSeason(data.season); setWarning(warning); }
    }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, league, retry]);
  useEffect(() => {
    setPlayers([]); setQuery('');
    if (!open || !teamId || !season || type !== 'player' || league === 'UCL') return;
    const controller = new AbortController(); setError(''); setLoading(true);
    void loadParlayPlayers(league, teamId, season, controller.signal).then(({ data, warning }) => {
      if (!controller.signal.aborted) { setPlayers(data.players); setWarning(warning); }
    }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, league, teamId, season, type, retry]);
  const team = teams.find(row => row.id === teamId);
  const choose = (player?: ParlayPlayer) => {
    if (!team) return;
    // Names, colors and matchup context only — photos are attached manually below.
    onChoose(league, { type: player ? 'player' : 'team', subject: {
      id: player?.id ?? team.id, name: player?.name ?? team.name, image: '',
      teamId: team.id, teamName: team.name, teamLogo: '', color: team.color,
    } });
    setOpen(false);
  };
  return <div className="best-bet-participant">
    {value && <div className="best-bet-subject">
      {value.subject.image && <img src={value.subject.image} alt="" />}
      <strong>{value.subject.name}</strong>
      {!value.subject.image && <small>No photo attached. Use Add photo to insert your own artwork; nothing is auto-filled.</small>}
      <label className="best-bet-photo">{value.subject.image ? 'Replace photo' : 'Add photo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        void readGraphicPhoto(file).then(photo => onChoose(league, { ...value, subject: { ...value.subject, image: photo } }))
          .catch(cause => window.alert(cause instanceof Error ? cause.message : 'The photo could not be added. Choose another image.'));
      }} /></label>
      {value.subject.image && <button type="button" onClick={() => onChoose(league, { ...value, subject: { ...value.subject, image: '' } })}>Remove photo</button>}
      <button type="button" onClick={() => onChoose(league, undefined)}>Remove player / team</button>
    </div>}
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{value ? 'Change' : 'Add'} player / team name</summary>
      <p>Choose NBA, NFL or NHL players / teams, or UEFA Champions League teams. This fills the name and card colors only; attach your own photo with Add photo. Your bet text stays editable below.</p>
      <div className="parlay-fields">
        <label>League<select value={league} onChange={event => {
          if (isRosterSport(event.target.value)) {
            setTeamId(''); setPlayers([]); setLeague(event.target.value);
            if (event.target.value === 'UCL') setType('team');
          }
        }}><option>NFL</option><option>NBA</option><option>NHL</option><option value="UCL">UEFA Champions League</option></select></label>
        <label>Subject type<select value={type} onChange={event => {
          if (event.target.value === 'player' || event.target.value === 'team') { setLoading(false); setType(event.target.value); }
        }} disabled={league === 'UCL'}>{league !== 'UCL' && <option value="player">Player</option>}<option value="team">Team</option></select></label>
        <label className="parlay-wide">Team<select value={teamId} disabled={loading && !teams.length} onChange={event => setTeamId(event.target.value)}>
          <option value="">Choose a team</option>{teams.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
      </div>
      {loading && <p role="status">Loading {league} teams / players...</p>}
      {warning && <p className="parlay-warning">{warning}</p>}
      {error && <p role="alert" className="feed-warning">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry name search</button></p>}
      {type === 'team' && team && <button type="button" onClick={() => choose()}>Use {team.name}</button>}
      {type === 'player' && team && <><label>Search roster player<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Player name" /></label>
        <div className="parlay-player-list">{players.filter(row => row.name.toLowerCase().includes(query.trim().toLowerCase())).map(row =>
          <button type="button" key={row.id} onClick={() => choose(row)}>{row.name}<small>{row.position}</small></button>)}</div>
        {!loading && !error && players.length > 0 && !players.some(row => row.name.toLowerCase().includes(query.trim().toLowerCase())) && <p>No matching players.</p>}
      </>}
    </details>
    <div className="best-bet-selection-fields">{children}</div>
  </div>;
}
