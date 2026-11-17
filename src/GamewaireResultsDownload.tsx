import { useEffect, useRef, useState } from 'react';
import type { StoredPick } from './services/gamewaire';
import { renderResultsGraphic } from './services/gamewaireResultsGraphic';

export function ResultsGraphicDownload({ generate, disabled, filename, description, alt, label = 'Download results graphic',
  snapshotNote = 'Snapshot from your last download. Download again after grading or changing results.' }: {
  generate: () => Promise<Blob | Blob[]>; disabled: boolean; filename: string; description: string; alt: string; label?: string; snapshotNote?: string;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [previews, setPreviews] = useState<string[]>([]);
  const urls = useRef<string[]>([]);
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const slideFilename = (index: number, count: number) => count === 1 ? filename
    : filename.replace(/\.png$/i, '') + `-${index + 1}-of-${count}.png`;
  const download = async () => {
    setBusy(true); setError('');
    try {
      const result = await generate(), blobs = Array.isArray(result) ? result : [result];
      if (!blobs.length) throw new Error('No graphic slides were created. Retry.');
      urls.current.forEach(url => URL.revokeObjectURL(url));
      urls.current = []; setPreviews([]);
      for (const blob of blobs) urls.current.push(URL.createObjectURL(blob));
      setPreviews([...urls.current]);
      urls.current.forEach((url, index) => {
        const link = document.createElement('a');
        link.href = url; link.download = slideFilename(index, blobs.length); link.click();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The results graphic could not be exported. Retry.');
    } finally { setBusy(false); }
  };
  return <div className="gai-results-download">
    <button type="button" disabled={disabled || busy} onClick={() => void download()}>{busy ? 'Creating graphic...' : label}</button>
    <small>{description}</small>
    {error && <p role="alert" className="feed-warning">{error}</p>}
    {!!previews.length && <details open={previews.length > 1}><summary>{previews.length > 1 ? `View and save all ${previews.length} slides` : 'View downloaded graphic'}</summary>
      {previews.map((preview, index) => <div key={preview}>
        <img src={preview} alt={`${alt}${previews.length > 1 ? `, slide ${index + 1} of ${previews.length}` : ''}`} />
        <a href={preview} download={slideFilename(index, previews.length)}>{previews.length > 1 ? `Save slide ${index + 1} of ${previews.length}` : 'Save PNG again'}</a>
      </div>)}
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
