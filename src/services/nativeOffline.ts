import { Capacitor, registerPlugin } from '@capacitor/core';
import { createNativePublicFetch, isNativePublicImage } from './nativePolicy.ts';

export const nativeApp = Capacitor.isNativePlatform();
const publicOrigin = import.meta.env?.VITE_SUPABASE_URL ? new URL(import.meta.env.VITE_SUPABASE_URL).origin : null;
export type NativeRefreshStatus = { lastAttempt?: string; lastSuccess?: string; refreshed?: number; remaining?: number; error?: string; enabled: boolean; failures: number };
type NativeOfflinePlugin = {
  configure(options: { publicOrigin: string }): Promise<void>;
  read(options: { url: string; accept: string; filter: string; apiKey: string }): Promise<{ body: string; savedAt?: string }>;
  image(options: { url: string }): Promise<{ path: string }>;
  status(): Promise<NativeRefreshStatus>;
  clear(): Promise<void>;
};
export const NativeOffline = registerPlugin<NativeOfflinePlugin>('GameWireOffline');

export async function initializeNativeOffline() {
  if (!nativeApp) return;
  await NativeOffline.configure({ publicOrigin: publicOrigin ?? '' });
  const originalFetch = window.fetch.bind(window);
  window.fetch = createNativePublicFetch(originalFetch, (request) => NativeOffline.read(request), (savedAt) => {
    window.dispatchEvent(new CustomEvent('gamewire-native-cached', { detail: savedAt }));
    window.dispatchEvent(new Event('gamewire-native-offline'));
  }, publicOrigin, window.location.href);
}

export async function nativeImageSource(src: string): Promise<string> {
  if (!nativeApp || !isNativePublicImage(new URL(src, window.location.href), publicOrigin)) return src;
  const { path } = await NativeOffline.image({ url: src });
  return Capacitor.convertFileSrc(path);
}

export async function warmNativeImages(urls: string[], signal: AbortSignal) {
  for (let start = 0; start < urls.length; start += 4) {
    signal.throwIfAborted();
    await Promise.all(urls.slice(start, start + 4).map(nativeImageSource));
  }
  signal.throwIfAborted();
}
