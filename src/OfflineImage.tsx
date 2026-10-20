import { useEffect, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { isOfflineImageSource, nativeApp, nativeImageSource } from './services/nativeOffline';
import { webOfflineStore } from './services/webOffline';

// An active service worker already serves and saves these images, so the browser can load them directly (and lazily).
const workerServesImages = () => !nativeApp && typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;

export default function OfflineImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [direct] = useState(workerServesImages);
  const [saved, setSaved] = useState<{ original: string; local: string } | null>(null);
  useEffect(() => {
    if (!src || direct) return;
    let current = true;
    let objectUrl: string | undefined;
    const resolve = async () => {
      if (nativeApp) return nativeImageSource(src);
      const blob = await webOfflineStore().image(src);
      if (!blob || !current) return src;
      objectUrl = URL.createObjectURL(blob);
      return objectUrl;
    };
    void resolve().then((local) => {
      if (current) setSaved({ original: src, local });
    }).catch((error: unknown) => {
      console.error('Could not save or load offline image', src, error);
      window.dispatchEvent(new Event(nativeApp ? 'gamewire-native-save-error' : 'gamewire-offline-save-error'));
      if (current) setSaved({ original: src, local: src });
    });
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src, direct]);
  if (direct) return <img {...props} src={src} />;
  return <img {...props} src={saved && saved.original === src ? saved.local : src && isOfflineImageSource(src) ? undefined : src} />;
}
