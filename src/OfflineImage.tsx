import { useEffect, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { nativeApp, nativeImageSource } from './services/nativeOffline';

export default function OfflineImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [saved, setSaved] = useState<{ original: string; local: string } | null>(null);
  useEffect(() => {
    if (!nativeApp || !src) return;
    let current = true;
    void nativeImageSource(src).then((local) => {
      if (current) setSaved({ original: src, local });
    }).catch((error: unknown) => {
      console.error('Could not save or load native offline image', src, error);
      window.dispatchEvent(new CustomEvent('gamewire-native-save-error'));
    });
    return () => { current = false; };
  }, [src]);
  return <img {...props} src={saved && saved.original === src ? saved.local : src} />;
}
