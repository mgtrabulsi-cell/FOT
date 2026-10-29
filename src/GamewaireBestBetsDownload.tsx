import { useEffect, useRef, useState } from 'react';
import type { Sport } from './services/gamewaire';
import { instagramBestBets } from './services/gamewaireOrder';
import type { PickOrder, publishedSelections } from './services/gamewaireOrder';

type Slide = { url: string; name: string };
export default function GamewaireBestBetsDownload({ picks, orders, date, disabled }: {
  picks: ReturnType<typeof publishedSelections>; orders: PickOrder[]; date: string; disabled: boolean;
}) {
  const [busy, setBusy] = useState<Sport | null>(null), [error, setError] = useState('');
  const [preview, setPreview] = useState<{ sport: Sport; date: string; slides: Slide[] } | null>(null);
  const urls = useRef<string[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; urls.current.forEach((url) => URL.revokeObjectURL(url)); };
  }, []);
  const download = async (sport: Sport) => {
    setBusy(sport); setError('');
    const nextUrls: string[] = [];
    try {
      const { renderGamewairePickGraphics } = await import('./services/gamewairePickGraphic');
      const files = await renderGamewairePickGraphics(instagramBestBets(picks, orders, sport, date), { sport, date });
      if (!mounted.current) return;
      const slides = files.map((file) => {
        const url = URL.createObjectURL(file); nextUrls.push(url);
        return { url, name: file.name };
      });
      urls.current.forEach((url) => URL.revokeObjectURL(url)); urls.current = nextUrls;
      setPreview({ sport, date, slides });
    } catch (cause) {
      nextUrls.forEach((url) => URL.revokeObjectURL(url));
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'The Best Bets carousel could not be created. Retry.');
    } finally { if (mounted.current) setBusy(null); }
  };
  return <section className="gai-results-download gai-best-bets-download" aria-label="Download Instagram Best Bets">
    <h4>GamewAIre's Best Bets · Instagram</h4>
    <small>Top 3 published Top Picks + top 3 Game Leans per sport for {date || 'the selected Eastern game date'}, in saved order. Shared selections appear once. Uses all games for the date, regardless of league/game filters. Full reasoning on 1080 x 1350 carousel slides, with continuation slides when needed. No posting or analysis credits.</small>
    <div className="gai-best-bets-actions">{(['NBA', 'NFL'] as const).map((sport) => {
      const selected = instagramBestBets(picks, orders, sport, date);
      return <button key={sport} type="button" disabled={disabled || !!busy || !selected.length} onClick={() => void download(sport)}>
        {busy === sport ? `Creating ${sport} carousel...` : `Download ${sport} Best Bets (${selected.length} selections)`}
      </button>;
    })}</div>
    {error && <p role="alert" className="feed-warning">{error}</p>}
    {preview && <details open><summary>{preview.sport} Best Bets · {preview.date} · {preview.slides.length} slides</summary>
      <p className="gai-note">Save each PNG below, then upload them to Instagram in numbered order. This preview is the last generated snapshot; regenerate after changing the date, picks or saved ranking.</p>
      <div className="gai-best-bets-slides">{preview.slides.map((slide, index) => <figure key={slide.url}>
        <img src={slide.url} alt={`${preview.sport} GamewAIre Best Bets for ${preview.date}, slide ${index + 1}`} />
        <figcaption><a href={slide.url} download={slide.name}>Download slide {index + 1} PNG</a></figcaption>
      </figure>)}</div>
    </details>}
  </section>;
}
