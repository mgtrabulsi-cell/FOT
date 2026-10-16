const espnHosts = new Set(['site.api.espn.com', 'site.web.api.espn.com', 'sports.core.api.espn.com', 'lm-api-reads.fantasy.espn.com']);

export function isNativePublicRead(url: URL, method: string, publicOrigin: string | null): boolean {
  return method === 'GET' && url.protocol === 'https:' && !url.username && !url.password
    && (espnHosts.has(url.hostname) || (url.origin === publicOrigin && /^\/rest\/v1\/(livewire_posts|matchup_boards)$/.test(url.pathname)));
}

export function isNativePublicImage(url: URL, publicOrigin: string | null): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'a.espncdn.com'
    || (url.origin === publicOrigin && url.pathname.startsWith('/storage/v1/object/public/livewire-photos/')));
}

export type NativePublicRequest = { url: string; accept: string; filter: string; apiKey: string };
export type NativePublicResponse = { body: string; savedAt?: string };

export function createNativePublicFetch(
  original: typeof fetch,
  read: (request: NativePublicRequest) => Promise<NativePublicResponse>,
  cached: (savedAt: string) => void,
  publicOrigin: string | null,
  baseUrl: string,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), baseUrl);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!isNativePublicRead(url, method, publicOrigin)) return original(input, init);
    const request = new Request(input instanceof Request ? input.clone() : url, init);
    request.signal.throwIfAborted();
    const result = await read({
      url: url.href, accept: request.headers.get('accept') ?? '',
      filter: request.headers.get('x-fantasy-filter') ?? '',
      apiKey: url.origin === publicOrigin ? request.headers.get('apikey') ?? '' : '',
    });
    request.signal.throwIfAborted();
    const headers = new Headers({ 'content-type': 'application/json' });
    if (result.savedAt) { headers.set('x-gamewire-saved-at', result.savedAt); cached(result.savedAt); }
    return new Response(result.body, { status: 200, headers });
  };
}
