import { useEffect, useRef, useState } from 'react';
import { newParlayGraphic, parlayGraphicError, parlayLegLabel, parlayMarkets } from './services/parlayGraphic';
import type { ParlayGraphic, ParlayLeg, ParlaySport } from './services/parlayGraphic';
import { loadParlayPlayers, loadParlayTeams } from './services/parlayRoster';
import type { ParlayPlayer, ParlayTeam } from './services/parlayRoster';
import { renderParlayGraphic } from './services/parlayGraphicImage';
import './parlayGraphic.css';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The parlay builder could not complete this request. Retry.';
export default function ParlayGraphicBuilder({ value, onChange }: { value: ParlayGraphic | null; onChange: (value: ParlayGraphic | null) => void }) {
  const [sport, setSport] = useState<ParlaySport>('NBA'), [type, setType] = useState<ParlayLeg['type']>('player');
  const [teams, setTeams] = useState<ParlayTeam[]>([]), [season, setSeason] = useState(0), [teamId, setTeamId] = useState('');
  const [players, setPlayers] = useState<ParlayPlayer[]>([]), [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [warning, setWarning] = useState('');
  const [retry, setRetry] = useState(0), [preview, setPreview] = useState(''), [rendering, setRendering] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const imageUrl = useRef('');
  const latest = useRef(value);
  latest.current = value;
  const enabled = !!value;
  useEffect(() => () => { if (imageUrl.current) URL.revokeObjectURL(imageUrl.current); }, []);
  useEffect(() => {
    setPreview(''); setPreviewError('');
    if (imageUrl.current) { URL.revokeObjectURL(imageUrl.current); imageUrl.current = ''; }
  }, [value]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setWarning(''); setTeams([]); setTeamId(''); setPlayers([]);
    void loadParlayTeams(sport, controller.signal).then(({ data, warning }) => {
      if (!controller.signal.aborted) { setTeams(data.teams); setSeason(data.season); setWarning(warning); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled, sport, retry]);
  useEffect(() => {
    setPlayers([]); setQuery('');
    if (!enabled || !teamId || !season || type !== 'player') return;
    const controller = new AbortController(); setLoading(true); setError('');
    void loadParlayPlayers(sport, teamId, season, controller.signal).then(({ data, warning }) => {
      if (!controller.signal.aborted) { setPlayers(data.players); setWarning(warning); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled, sport, teamId, season, type]);
  if (!value) return <div className="parlay-add-on"><button type="button" onClick={() => onChange(newParlayGraphic())}>Add parlay graphic</button>
    <p>Build a branded NBA/NFL parlay with player props, team spreads, moneylines, or any combination.</p></div>;
  const update = (patch: Partial<ParlayGraphic>) => onChange({ ...value, ...patch });
  const editLeg = (id: string, patch: Partial<ParlayLeg>) => update({ legs: value.legs.map((leg) => leg.id === id ? { ...leg, ...patch } : leg) });
  const team = teams.find((item) => item.id === teamId);
  const addLeg = (player?: ParlayPlayer) => {
    if (!team || value.legs.length >= 8) return;
    update({ legs: [...value.legs, { id: crypto.randomUUID(), sport, type,
      subject: { id: player?.id ?? team.id, name: player?.name ?? team.name, image: player?.image ?? team.logo,
        teamId: team.id, teamName: team.name, teamLogo: team.logo, color: team.color },
      market: type === 'player' ? parlayMarkets[sport][0] : '', side: 'At least', line: '' }] });
  };
  const buildPreview = async () => {
    setRendering(true); setPreviewError('');
    try {
      const blob = await renderParlayGraphic(value);
      if (latest.current !== value) return;
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
      imageUrl.current = URL.createObjectURL(blob); setPreview(imageUrl.current);
    } catch (cause) { setPreviewError(message(cause)); }
    finally { setRendering(false); }
  };
  return <section className="parlay-builder" aria-label="Parlay graphic builder">
    <header><span className="eyebrow">THE ANGLE / GRAPHIC STUDIO</span><h3>Build your parlay</h3>
      <p>Mix NBA + NFL, players + teams, and multiple games. Two to eight legs; one tracked parlay. Lines and odds are your own editorial inputs, not live quotes. Verify player availability.</p>
      {new Set(value.legs.map((leg) => leg.sport)).size > 1 && <p className="parlay-warning">For mixed-sport result tracking, choose Combo in the Angle's Matchup selector above.</p>}</header>
    <fieldset disabled={rendering}><legend>Graphic details</legend><div className="parlay-fields">
      <label>Graphic title<select value={value.title} onChange={(e) => update({ title: e.target.value as ParlayGraphic['title'] })}>
        <option>PARLAY</option><option>SAME GAME PARLAY</option><option>CROSS GAME PARLAY</option></select></label>
      <label>Combined odds (optional)<input maxLength={12} inputMode="text" placeholder="+1360" value={value.odds} onChange={(e) => update({ odds: e.target.value })} /></label>
      <label className="parlay-wide">Matchup / slate label (optional)<input maxLength={100} placeholder="76ers @ Pacers / 7:10 PM ET" value={value.subtitle} onChange={(e) => update({ subtitle: e.target.value })} /></label>
    </div><label className="parlay-checkbox"><input type="checkbox" checked={value.images} onChange={(e) => update({ images: e.target.checked })} />Include portraits and team logos</label>
    <small>Combined odds are never calculated from individual legs. Verify the actual sportsbook price. Turn off images for a name-only graphic that renders offline.</small></fieldset>
    <fieldset disabled={rendering || value.legs.length >= 8}><legend>Add a leg · {value.legs.length}/8</legend>
      <div className="parlay-fields">
        <label>League<select value={sport} onChange={(e) => { setSport(e.target.value as ParlaySport); setTeamId(''); }}><option>NBA</option><option>NFL</option></select></label>
        <label>Leg type<select value={type} onChange={(e) => setType(e.target.value as ParlayLeg['type'])}><option value="player">Player prop</option><option value="spread">Team spread</option><option value="moneyline">Team moneyline</option></select></label>
        <label className="parlay-wide">Team<select value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">Select a team</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      </div>
      {loading && <p role="status">Loading {sport} teams / players...</p>}
      {warning && <p role="status" className="parlay-warning">{warning}</p>}
      {error && <p role="alert" className="feed-warning">{error} <button type="button" onClick={() => setRetry((v) => v + 1)}>Retry player picker</button></p>}
      {type === 'player' && teamId && <><label>Find a player on {team?.name}<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or position" /></label>
        <div className="parlay-player-list" aria-label="Available players">{players.filter((p) => `${p.name} ${p.position}`.toLowerCase().includes(query.toLowerCase())).map((player) => <button key={player.id} type="button" onClick={() => addLeg(player)}>
          <strong>{player.name}</strong><small>{player.position} / {team?.abbr} · Add +</small></button>)}</div>
        {!loading && !error && !players.filter((p) => `${p.name} ${p.position}`.toLowerCase().includes(query.toLowerCase())).length && <p>No players match this search.</p>}</>}
      {type !== 'player' && <button type="button" disabled={!team} onClick={() => addLeg()}>Add {team?.name ?? 'team'} {type === 'spread' ? 'spread' : 'moneyline'}</button>}
    </fieldset>
    <ol className="parlay-leg-list">{value.legs.map((leg, index) => <li key={leg.id}>
      <div className="parlay-leg-heading"><span className="parlay-leg-number">{index + 1}</span><div><strong>{leg.subject.name}</strong><small>{leg.sport} / {leg.subject.teamName} / {leg.type === 'player' ? 'Player prop' : leg.type === 'spread' ? 'Spread' : 'Moneyline'}</small></div></div>
      <div className="parlay-fields">
        {leg.type === 'player' && <><label>Stat<select value={parlayMarkets[leg.sport].includes(leg.market) ? leg.market : 'custom'} onChange={(e) => editLeg(leg.id, { market: e.target.value === 'custom' ? '' : e.target.value })}>
          {parlayMarkets[leg.sport].map((market) => <option key={market}>{market}</option>)}<option value="custom">Other stat / combination</option></select></label>
          {!parlayMarkets[leg.sport].includes(leg.market) && <label>Custom stat label<input maxLength={50} placeholder="e.g. Passing + rushing yards" value={leg.market} onChange={(e) => editLeg(leg.id, { market: e.target.value })} /></label>}
          {!['Anytime touchdown', 'First touchdown', 'Double-double', 'Triple-double'].includes(leg.market) && <label>Direction<select value={leg.side} onChange={(e) => editLeg(leg.id, { side: e.target.value as ParlayLeg['side'] })}><option>At least</option><option>Over</option><option>Under</option></select></label>}</>}
        {(leg.type === 'spread' || leg.type === 'player' && !['Anytime touchdown', 'First touchdown', 'Double-double', 'Triple-double'].includes(leg.market)) && <label>{leg.type === 'spread' ? 'Spread (+ / -)' : 'Stat line'}<input inputMode="text" maxLength={12} placeholder={leg.type === 'spread' ? '-4.5 or +4.5' : '20 or 19.5'} value={leg.line} onChange={(e) => editLeg(leg.id, { line: e.target.value })} /></label>}
      </div>
      <p className="parlay-leg-summary">{parlayLegLabel(leg)}</p>
      <div className="parlay-leg-actions"><button type="button" disabled={index === 0 || rendering} aria-label={`Move leg ${index + 1} up`} onClick={() => { const legs = [...value.legs]; [legs[index - 1], legs[index]] = [legs[index], legs[index - 1]]; update({ legs }); }}>Move up</button>
        <button type="button" disabled={index === value.legs.length - 1 || rendering} aria-label={`Move leg ${index + 1} down`} onClick={() => { const legs = [...value.legs]; [legs[index + 1], legs[index]] = [legs[index], legs[index + 1]]; update({ legs }); }}>Move down</button>
        <button type="button" disabled={rendering} onClick={() => update({ legs: value.legs.filter((item) => item.id !== leg.id) })}>Remove leg {index + 1}</button></div>
    </li>)}</ol>
    {parlayGraphicError(value) && <p className="parlay-warning">{parlayGraphicError(value)}</p>}
    <div className="parlay-leg-actions"><button type="button" disabled={rendering || !!parlayGraphicError(value)} onClick={() => void buildPreview()}>{rendering ? 'Rendering...' : 'Preview parlay graphic'}</button>
      <button type="button" disabled={rendering} onClick={() => { if (window.confirm('Remove this parlay add-on from the draft? Other picks and attachments stay.')) onChange(null); }}>Remove parlay add-on</button></div>
    {previewError && <p role="alert" className="feed-warning">{previewError}</p>}
    {preview && <div className="parlay-preview"><img src={preview} alt={`Parlay graphic preview: ${value.legs.map((leg) => `${leg.subject.name} ${parlayLegLabel(leg)}`).join('; ')}`} /><a href={preview} download="GameWire-Parlay.png">Download PNG</a></div>}
    <p className="parlay-save-note">Your working template saves with this Angle on this device. Saving or publishing the Angle generates the current graphic as one photo and adds one parlay to its picks. Incomplete templates can stay in your local draft; complete them before saving to the server.</p>
  </section>;
}
