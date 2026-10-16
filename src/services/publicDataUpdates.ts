import { refreshNFLOfflineSources } from './sportsData.ts';

export const publicDataUpdateEvent = 'gamewire-public-data-updated';
const changed = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function publicDataChanged(url: string) {
  changed.add(url);
  if (timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    const urls = [...changed];
    changed.clear();
    refreshNFLOfflineSources();
    window.dispatchEvent(new CustomEvent(publicDataUpdateEvent, { detail: urls }));
  }, 300);
}
