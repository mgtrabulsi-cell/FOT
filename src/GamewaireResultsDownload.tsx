import { useEffect, useRef, useState } from 'react';
import type { StoredPick } from './services/gamewaire';
import { renderResultsGraphic } from './services/gamewaireResultsGraphic';

export default function GamewaireResultsDownload({ picks, disabled }: { picks: StoredPick[]; disabled: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState('');
  const url = useRef('');
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);
  const download = async () => {
    setBusy(true); setError('');
    try {
      const blob = await renderResultsGraphic(picks);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(blob); setPreview(url.current);
      const link = document.createElement('a');
      link.href = url.current; link.download = 'GameWire-GamewAIre-Results.png'; link.click();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The results graphic could not be exported. Retry.');
    } finally { setBusy(false); }
  };
  return <div className="gai-results-download">
    <button type="button" disabled={disabled || busy} onClick={() => void download()}>{busy ? 'Creating graphic...' : 'Download results graphic'}</button>
    <small>Instagram portrait PNG (1080 x 1350). All-time NBA + NFL records and hit rates only, with no past picks. List filters do not change the export.</small>
    {error && <p role="alert" className="feed-warning">{error}</p>}
    {preview && <details><summary>View downloaded graphic</summary>
      <img src={preview} alt="GamewAIre results graphic with Top Picks, Game Leans and All Picks records and hit rates" />
      <a href={preview} download="GameWire-GamewAIre-Results.png">Save PNG again</a>
      <p className="gai-note">Snapshot from your last download. Download again after grading or changing results.</p>
    </details>}
  </div>;
}
