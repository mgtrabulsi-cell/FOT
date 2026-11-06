import { useEffect, useRef, useState } from 'react';
import type { StoredPick } from './services/gamewaire';
import { renderResultsGraphic } from './services/gamewaireResultsGraphic';

export function ResultsGraphicDownload({ generate, disabled, filename, description, alt, label = 'Download results graphic',
  snapshotNote = 'Snapshot from your last download. Download again after grading or changing results.' }: {
  generate: () => Promise<Blob>; disabled: boolean; filename: string; description: string; alt: string; label?: string; snapshotNote?: string;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState('');
  const url = useRef('');
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);
  const download = async () => {
    setBusy(true); setError('');
    try {
      const blob = await generate();
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(blob); setPreview(url.current);
      const link = document.createElement('a');
      link.href = url.current; link.download = filename; link.click();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The results graphic could not be exported. Retry.');
    } finally { setBusy(false); }
  };
  return <div className="gai-results-download">
    <button type="button" disabled={disabled || busy} onClick={() => void download()}>{busy ? 'Creating graphic...' : label}</button>
    <small>{description}</small>
    {error && <p role="alert" className="feed-warning">{error}</p>}
    {preview && <details><summary>View downloaded graphic</summary>
      <img src={preview} alt={alt} />
      <a href={preview} download={filename}>Save PNG again</a>
      <p className="gai-note">{snapshotNote}</p>
    </details>}
  </div>;
}
export default function GamewaireResultsDownload({ picks, disabled }: { picks: StoredPick[]; disabled: boolean }) {
  return <ResultsGraphicDownload generate={() => renderResultsGraphic(picks)} disabled={disabled}
    filename="GameWire-GamewAIre-Results.png"
    description="Instagram portrait PNG (1080 x 1350). All-time NBA + NFL records and hit rates only, with no past picks. List filters do not change the export."
    alt="GamewAIre results graphic with Top Picks, Game Leans and All Picks records and hit rates" />;
}
