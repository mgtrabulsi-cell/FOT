import { useEffect, useRef, useState } from 'react';
import type { StoredPick } from './services/gamewaire';
import { renderResultsGraphic } from './services/gamewaireResultsGraphic';
import { graphicSlideFilename, graphicSlidesArchive, shareGraphicSlides } from './services/graphicSlides';

export function ResultsGraphicDownload({ generate, disabled, filename, description, alt, label = 'Download results graphic',
  snapshotNote = 'Snapshot from your last download. Download again after grading or changing results.' }: {
  generate: () => Promise<Blob | Blob[]>; disabled: boolean; filename: string; description: string; alt: string; label?: string; snapshotNote?: string;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [previews, setPreviews] = useState<string[]>([]);
  const [archive, setArchive] = useState('');
  const urls = useRef<string[]>([]);
  const archiveUrl = useRef(''), slides = useRef<Blob[]>([]);
  useEffect(() => () => {
    urls.current.forEach(url => URL.revokeObjectURL(url));
    if (archiveUrl.current) URL.revokeObjectURL(archiveUrl.current);
  }, []);
  const share = async () => {
    setError('');
    try { await shareGraphicSlides(slides.current, filename); }
    catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'The slides could not be shared. Use the ZIP or individual save links.');
    }
  };
  const download = async () => {
    setBusy(true); setError('');
    try {
      const result = await generate(), blobs = Array.isArray(result) ? result : [result];
      if (!blobs.length) throw new Error('No graphic slides were created. Retry.');
      const zip = blobs.length > 1 ? await graphicSlidesArchive(blobs, filename) : null;
      urls.current.forEach(url => URL.revokeObjectURL(url));
      if (archiveUrl.current) URL.revokeObjectURL(archiveUrl.current);
      urls.current = []; setPreviews([]);
      slides.current = blobs;
      for (const blob of blobs) urls.current.push(URL.createObjectURL(blob));
      archiveUrl.current = zip ? URL.createObjectURL(zip) : '';
      setArchive(archiveUrl.current);
      setPreviews([...urls.current]);
      const link = document.createElement('a');
      link.href = archiveUrl.current || urls.current[0];
      link.download = zip ? filename.replace(/\.png$/i, '') + '.zip' : filename;
      link.click();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The results graphic could not be exported. Retry.');
    } finally { setBusy(false); }
  };
  return <div className="gai-results-download">
    <button type="button" disabled={disabled || busy} onClick={() => void download()}>{busy ? 'Creating graphic...' : label}</button>
    <small>{description}</small>
    {error && <p role="alert" className="feed-warning">{error}</p>}
    {archive && <div className="gai-slide-actions">
      <a href={archive} download={filename.replace(/\.png$/i, '') + '.zip'}>Download all slides (ZIP)</a>
      <button type="button" onClick={() => void share()}>Share all slides</button>
      <p className="gai-note">On mobile, share the images to save them, or download the ZIP and open it in Files. Each slide can also be saved below.</p>
    </div>}
    {!!previews.length && <details open={previews.length > 1}><summary>{previews.length > 1 ? `View and save all ${previews.length} slides` : 'View downloaded graphic'}</summary>
      {previews.map((preview, index) => <div key={preview}>
        <img src={preview} alt={`${alt}${previews.length > 1 ? `, slide ${index + 1} of ${previews.length}` : ''}`} />
        <a href={preview} download={graphicSlideFilename(filename, index, previews.length)}>{previews.length > 1 ? `Save slide ${index + 1} of ${previews.length}` : 'Save PNG again'}</a>
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
