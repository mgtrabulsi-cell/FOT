import { parlayGraphicError, parlayLegLabel } from './parlayGraphic';
import type { ParlayGraphic } from './parlayGraphic';
import { publicSupabaseConfig } from './supabaseClient';
import { renderBetGraphic } from './betGraphicStyle';

const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function parlayPortraitCrop(pixels: Uint8ClampedArray, width: number, height: number) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] < 24) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error('A player portrait is empty. Choose another player or turn off portraits.');
  // Trim transparent padding, then frame the head and upper shoulders.
  const size = Math.min(right - left + 1, bottom - top + 1) * 0.86;
  return { x: left + (right - left + 1 - size) / 2, y: top, size };
}
function portrait(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, size: number) {
  const source = document.createElement('canvas');
  source.width = img.naturalWidth; source.height = img.naturalHeight;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error('Your browser could not prepare the player portrait.');
  sourceCtx.drawImage(img, 0, 0);
  const crop = parlayPortraitCrop(sourceCtx.getImageData(0, 0, source.width, source.height).data, source.width, source.height);
  ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, x, y, size, size);
}
function decodeImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => { img.src = ''; reject(new Error('A graphic portrait timed out. Retry, or turn off portraits/logos to render offline.')); }, 12_000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('A graphic portrait could not load. Retry, or turn off portraits/logos to use a name-only graphic.')); };
    img.src = url;
  });
}
async function retrieveImage(url: string) {
  try { return await decodeImage(url); }
  catch (cause) {
    if (!publicSupabaseConfig || !/^https:\/\/a\.espncdn\.com\/i\/(?:headshots\/(?:nfl|nba|nhl)\/players\/full\/\d+|teamlogos\/(?:nfl|nba|nhl|soccer)\/500\/[a-z0-9_-]+)\.png$/.test(url)) throw cause;
    console.warn('Direct graphic image failed; retrying through the image service.', url, cause);
    const relay = new URL(`${publicSupabaseConfig.url}/functions/v1/parlay-roster`);
    relay.searchParams.set('image', url);
    const response = await fetch(relay, { signal: AbortSignal.timeout(15_000), credentials: 'omit' });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'image/png')
      throw new Error('The selected player photo or team logo could not load, including the image-service retry. Reconnect and retry, or choose another image.');
    const blob = await response.blob();
    if (!blob.size || blob.size > 5 * 1024 * 1024) throw new Error('The selected player photo or team logo has an invalid image size.');
    const local = URL.createObjectURL(blob);
    try { return await decodeImage(local); }
    finally { URL.revokeObjectURL(local); }
  }
}
function image(url: string) {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const request = retrieveImage(url);
  imageCache.set(url, request);
  void request.catch(() => imageCache.delete(url));
  return request;
}
export { image as loadGraphicImage, portrait as drawGraphicPortrait };
export async function renderParlayGraphic(graphic: ParlayGraphic): Promise<Blob> {
  const error = parlayGraphicError(graphic);
  if (error) throw new Error(error);
  const rows = await Promise.all(graphic.legs.map(async (leg) => ({
    label: leg.sport, name: leg.subject.name, selection: parlayLegLabel(leg),
    photo: graphic.images && leg.subject.image ? await image(leg.subject.image) : null,
  })));
  return renderBetGraphic({
    title: graphic.title, subtitle: graphic.subtitle.trim(), rows, typography: 'brand',
    summary: graphic.odds.trim() ? `COMBINED ODDS  ${Number(graphic.odds) > 0 ? '+' : ''}${Number(graphic.odds)}` : `${graphic.legs.length} LEGS / ONE PARLAY`,
    note: 'Manually entered selections / Verify the actual sportsbook price',
  });
}
