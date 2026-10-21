import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { isOfflineImageSource, nativeApp, nativeImageSource } from './services/nativeOffline';
import { webOfflineStore } from './services/webOffline';

// An active service worker already serves and saves these images, so the browser can load them directly (and lazily).
const workerServesImages = () => !nativeApp && typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;

export default function OfflineImage({ src, loading, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [direct] = useState(workerServesImages);
  const image = useRef<HTMLImageElement>(null);
  const [requested, setRequested] = useState(loading !== 'lazy');
  const [saved, setSaved] = useState<{ original: string; local: string } | null>(null);
  useEffect(() => {
    if (direct || requested) return;
    if (loading !== 'lazy' || typeof IntersectionObserver === 'undefined') { setRequested(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setRequested(true); observer.disconnect(); }
    }, { rootMargin: '400px' });
    if (image.current) observer.observe(image.current);
    return () => observer.disconnect();
  }, [direct, requested, loading]);
  useEffect(() => {
    if (!src || direct || !requested) return;
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
  }, [src, direct, requested]);
  if (direct) return <img {...props} loading={loading} src={src} />;
  return <img {...props} ref={image} loading={loading} src={saved && saved.original === src ? saved.local : src && isOfflineImageSource(src) ? undefined : src} />;
}
