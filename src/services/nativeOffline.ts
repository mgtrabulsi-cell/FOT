import { Capacitor, registerPlugin } from '@capacitor/core';
import { createNativePublicFetch, isNativePublicImage } from './nativePolicy.ts';
import { publicDataChanged } from './publicDataUpdates.ts';

export const nativeApp = Capacitor.isNativePlatform();
const publicOrigin = import.meta.env?.VITE_SUPABASE_URL ? new URL(import.meta.env.VITE_SUPABASE_URL).origin : null;
export type NativeRefreshStatus = { lastAttempt?: string; lastSuccess?: string; refreshed?: number; remaining?: number; error?: string; enabled: boolean; failures: number };
type NativeOfflinePlugin = {
  configure(options: { publicOrigin: string }): Promise<void>;
  read(options: { url: string; accept: string; filter: string; apiKey: string }): Promise<{ body: string; savedAt?: string }>;
  peek(options: { url: string; accept: string; filter: string }): Promise<{ body?: string; savedAt?: string }>;
  image(options: { url: string }): Promise<{ path: string }>;
  status(): Promise<NativeRefreshStatus>;
  clear(): Promise<void>;
};
export const NativeOffline = registerPlugin<NativeOfflinePlugin>('GameWireOffline');
const pendingReads = new Set<Promise<{ body: string; savedAt?: string }>>();

export async function settleNativeReads() {
  await Promise.allSettled([...pendingReads]);
}

export function isOfflineImageSource(src: string): boolean {
  return isNativePublicImage(new URL(src, window.location.href), publicOrigin);
}

export async function initializeNativeOffline() {
  if (!nativeApp) return;
  await NativeOffline.configure({ publicOrigin: publicOrigin ?? '' });
  const originalFetch = window.fetch.bind(window);
  window.fetch = createNativePublicFetch(originalFetch, (request) => {
    const pending = NativeOffline.read(request);
    pendingReads.add(pending);
    void pending.finally(() => pendingReads.delete(pending)).catch((error: unknown) => console.error('Native public refresh failed', error));
    return pending;
  }, (savedAt) => {
    window.dispatchEvent(new CustomEvent('gamewire-native-cached', { detail: savedAt }));
    window.dispatchEvent(new Event('gamewire-native-offline'));
  }, publicOrigin, window.location.href, {
    peek: (request) => NativeOffline.peek(request),
    online: () => navigator.onLine,
    updated: publicDataChanged,
    error: (error) => console.error('Could not refresh saved native public data', error),
  });
}

export async function nativeImageSource(src: string): Promise<string> {
  if (!nativeApp || !isOfflineImageSource(src)) return src;
  const { path } = await NativeOffline.image({ url: src });
  return Capacitor.convertFileSrc(path);
}

export async function warmNativeImages(urls: string[], signal: AbortSignal) {
  let failed = 0;
  for (let start = 0; start < urls.length; start += 4) {
    signal.throwIfAborted();
    const batch = urls.slice(start, start + 4);
    const results = await Promise.allSettled(batch.map(nativeImageSource));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failed++;
        console.error('Native offline image could not be saved', batch[index], result.reason);
      }
    });
  }
  signal.throwIfAborted();
  if (failed) throw new Error(`${failed} of ${urls.length} native offline images could not be saved.`);
}
