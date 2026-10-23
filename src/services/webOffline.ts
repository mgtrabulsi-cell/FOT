import { isNativePublicImage, isNativePublicRead, samePublicData } from './nativePolicy.ts';
import { publicDataChanged } from './publicDataUpdates.ts';

type StoreOptions = {
  fetch: typeof fetch;
  caches: CacheStorage;
  scope: string;
  publicOrigin: string | null;
  online: () => boolean;
  onSavedResponse: (savedAt: string | null) => void;
  onSaveError: (error: unknown) => void;
  onUpdated?: (url: string) => void;
};

export function createWebOfflineStore(options: StoreOptions) {
  const prefix = `gamewire-offline:${options.scope}:`;
  let failures = 0;
  let stopped = false;
  const images = new Map<string, Promise<Blob>>();
  const refreshing = new Map<string, Promise<Response>>();
  const checked = new Map<string, number>();
  const revalidated = new Set<string>();
  const report = (error: unknown) => { failures++; options.onSaveError(error); };
  const open = (kind: 'public' | 'images') => options.caches.open(`${prefix}${kind}:v1`);
  const save = async (cache: Cache, key: string, response: Response, limit: number) => {
    if (stopped) throw new Error('Offline saving was stopped while clearing account data.');
    await cache.put(key, response);
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((entry) => cache.delete(entry)));
  };
  const publicFetch: typeof fetch = async (input, init) => {
    if (stopped) return options.fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input), options.scope);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!isNativePublicRead(url, method, options.publicOrigin)) return options.fetch(input, init);
    const request = new Request(input instanceof Request ? input.clone() : url, init);
    request.signal.throwIfAborted();
    const key = new URL(url);
    const accept = request.headers.get('accept') || '*/*';
    request.headers.set('accept', accept);
    key.searchParams.set('__gamewire_accept', accept);
    const filter = request.headers.get('x-fantasy-filter');
    if (filter) key.searchParams.set('__gamewire_filter', filter);
    let cache: Cache | undefined;
    let cached: Response | undefined;
    try {
      cache = await open('public');
      cached = await cache.match(key.href);
    } catch (error) { report(error); }
    const saved = (response: Response) => {
      request.signal.throwIfAborted();
      options.onSavedResponse(response.headers.get('x-gamewire-saved-at'));
      const copy = response.clone();
      if (options.online() && revalidated.has(key.href)) {
        const headers = new Headers(copy.headers);
        headers.set('x-gamewire-revalidated', 'true');
        return new Response(copy.body, { status: copy.status, headers });
      }
      return copy;
    };
    const refresh = () => {
      const pending = refreshing.get(key.href);
      if (pending) return pending;
      checked.set(key.href, Date.now());
      const load = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await options.fetch(request, { signal: controller.signal });
          if (!response.ok) throw new Error(`Public refresh returned HTTP ${response.status}`);
          if (response.headers.has('x-gamewire-saved-at')) {
            options.onSavedResponse(response.headers.get('x-gamewire-saved-at'));
            return response;
          }
          if (cache) {
            try {
              const body = await response.clone().blob();
              if (body.size > 5 * 1024 * 1024) throw new Error('Public response exceeds offline storage limit');
              const text = await body.text();
              JSON.parse(text);
              const headers = new Headers(response.headers);
              headers.set('x-gamewire-saved-at', new Date().toISOString());
              headers.delete('vary');
              headers.delete('content-encoding');
              headers.delete('content-length');
              await save(cache, key.href, new Response(body, { status: response.status, headers }), 1500);
              revalidated.add(key.href);
              if (!stopped && cached && !samePublicData(await cached.clone().text(), text)) options.onUpdated?.(url.href);
            } catch (error) { report(error); }
          }
          return response;
        } finally {
          clearTimeout(timer);
        }
      })().finally(() => refreshing.delete(key.href));
      refreshing.set(key.href, load);
      return load;
    };
    if (cached && request.cache !== 'reload' && request.cache !== 'no-store') {
      if (options.online() && Date.now() - (checked.get(key.href) ?? 0) >= 15000) {
        void refresh().catch((error: unknown) => {
          if (!stopped) report(error);
        });
      }
      return saved(cached);
    }
    try {
      const response = await refresh();
      request.signal.throwIfAborted();
      return response.clone();
    } catch (error) {
      request.signal.throwIfAborted();
      if (cached) return saved(cached);
      throw error;
    }
  };
  const image = (src: string): Promise<Blob | null> => {
    if (stopped) return Promise.reject(new Error('Offline storage was cleared after account deletion.'));
    const url = new URL(src, options.scope);
    if (!isNativePublicImage(url, options.publicOrigin)) return Promise.resolve(null);
    const pending = images.get(url.href);
    if (pending) return pending;
    const load = (async () => {
      const cache = await open('images');
      const cached = await cache.match(url.href);
      if (cached && cached.type !== 'opaque') {
        const blob = await cached.blob();
        if (blob.size) return blob;
      }
      const response = await options.fetch(url.href, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Offline image returned HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.size || !blob.type.startsWith('image/') || blob.size > 5 * 1024 * 1024) throw new Error('Invalid or oversized offline image');
      await save(cache, url.href, new Response(blob, { headers: { 'content-type': blob.type } }), 2500);
      return blob;
    })().catch((error: unknown) => { report(error); throw error; }).finally(() => images.delete(url.href));
    images.set(url.href, load);
    return load;
  };
  const warmImages = async (urls: string[], signal: AbortSignal) => {
    let failed = 0;
    for (let start = 0; start < urls.length; start += 4) {
      signal.throwIfAborted();
      const results = await Promise.allSettled(urls.slice(start, start + 4).map(image));
      failed += results.filter((result) => result.status === 'rejected').length;
    }
    signal.throwIfAborted();
    if (failed) throw new Error(`${failed} of ${urls.length} offline images could not be saved.`);
  };
  const settle = async () => { await Promise.allSettled([...refreshing.values()]); };
  return { fetch: publicFetch, image, warmImages, settle, failures: () => failures, stop: () => { stopped = true; } };
}

let store: ReturnType<typeof createWebOfflineStore> | undefined;

export function initializeWebOffline() {
  const publicOrigin = import.meta.env?.VITE_SUPABASE_URL ? new URL(import.meta.env.VITE_SUPABASE_URL).origin : null;
  store = createWebOfflineStore({
    fetch: window.fetch.bind(window), caches: window.caches,
    scope: new URL(import.meta.env.BASE_URL, window.location.href).href,
    publicOrigin, online: () => navigator.onLine,
    onSavedResponse: (savedAt) => window.dispatchEvent(new CustomEvent('gamewire-offline-cached', { detail: savedAt })),
    onSaveError: (error) => {
      console.error('Could not retain public offline content', error);
      window.dispatchEvent(new Event('gamewire-offline-save-error'));
    },
    onUpdated: publicDataChanged,
  });
  window.fetch = store.fetch;
  if (navigator.storage?.persist) {
    void navigator.storage.persist().catch((error: unknown) => console.error('Could not request persistent offline storage', error));
  }
}

export function webOfflineStore() {
  if (!store) throw new Error('Local offline storage is not initialized.');
  return store;
}

export function stopWebOffline() {
  store?.stop();
}

export async function warmWebImages(urls: string[], signal: AbortSignal) {
  await webOfflineStore().warmImages(urls, signal);
}
