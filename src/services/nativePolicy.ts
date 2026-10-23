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

export function samePublicData(previous: string, next: string): boolean {
  if (previous === next) return true;
  const normalize = (text: string) => JSON.stringify(JSON.parse(text), (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([first], [second]) => first.localeCompare(second)));
  });
  return normalize(previous) === normalize(next);
}

export function createNativePublicFetch(
  original: typeof fetch,
  read: (request: NativePublicRequest) => Promise<NativePublicResponse>,
  cached: (savedAt: string) => void,
  publicOrigin: string | null,
  baseUrl: string,
  savedFirst?: {
    peek: (request: NativePublicRequest) => Promise<Partial<NativePublicResponse>>;
    online: () => boolean;
    updated: (url: string) => void;
    error: (error: unknown) => void;
  },
): typeof fetch {
  const checked = new Map<string, number>();
  const refreshing = new Map<string, Promise<NativePublicResponse>>();
  const revalidated = new Set<string>();
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), baseUrl);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!isNativePublicRead(url, method, publicOrigin)) return original(input, init);
    const request = new Request(input instanceof Request ? input.clone() : url, init);
    request.signal.throwIfAborted();
    const publicRequest = {
      url: url.href, accept: request.headers.get('accept') ?? '',
      filter: request.headers.get('x-fantasy-filter') ?? '',
      apiKey: url.origin === publicOrigin ? request.headers.get('apikey') ?? '' : '',
    };
    const key = JSON.stringify([url.href, publicRequest.accept, publicRequest.filter]);
    const previous = savedFirst ? await savedFirst.peek(publicRequest) : {};
    request.signal.throwIfAborted();
    const refresh = () => {
      const pending = refreshing.get(key);
      if (pending) return pending;
      checked.set(key, Date.now());
      const load = read(publicRequest).then((result) => {
        if (!result.savedAt) revalidated.add(key);
        if (previous.body !== undefined && !result.savedAt && !samePublicData(previous.body, result.body)) savedFirst?.updated(url.href);
        return result;
      }).finally(() => refreshing.delete(key));
      refreshing.set(key, load);
      return load;
    };
    let result: NativePublicResponse;
    if (previous.body !== undefined && request.cache !== 'reload' && request.cache !== 'no-store') {
      result = { body: previous.body, savedAt: previous.savedAt };
      if (savedFirst?.online() && Date.now() - (checked.get(key) ?? 0) >= 15000) {
        void refresh().catch(savedFirst.error);
      }
    } else result = await refresh();
    request.signal.throwIfAborted();
    const headers = new Headers({ 'content-type': 'application/json' });
    if (savedFirst?.online() && revalidated.has(key)) headers.set('x-gamewire-revalidated', 'true');
    if (result.savedAt) { headers.set('x-gamewire-saved-at', result.savedAt); cached(result.savedAt); }
    return new Response(result.body, { status: 200, headers });
  };
}
