import { useEffect, useState } from 'react';
import { publicDataUpdateEvent } from './services/publicDataUpdates';

export function usePublicDataRevision(kind: 'sports' | 'scoreboard' | 'news' | 'posts' | 'matchups') {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = (event: Event) => {
      const urls = (event as CustomEvent<string[]>).detail;
      const matches = urls.some((address) => {
        const url = new URL(address);
        if (kind === 'posts') return url.pathname === '/rest/v1/livewire_posts';
        if (kind === 'matchups') return url.pathname === '/rest/v1/matchup_boards' || url.hostname.endsWith('.espn.com');
        if (kind === 'scoreboard') return url.pathname.endsWith('/scoreboard');
        if (kind === 'news') return url.pathname.endsWith('/news');
        return url.hostname.endsWith('.espn.com') && !url.pathname.endsWith('/scoreboard') && !url.pathname.endsWith('/news');
      });
      if (matches) setRevision((previous) => previous + 1);
    };
    window.addEventListener(publicDataUpdateEvent, update);
    const resume = () => setRevision((previous) => previous + 1);
    if (kind === 'sports') window.addEventListener('gamewire-native-snapshot-ready', resume);
    return () => {
      window.removeEventListener(publicDataUpdateEvent, update);
      if (kind === 'sports') window.removeEventListener('gamewire-native-snapshot-ready', resume);
    };
  }, [kind]);
  return revision;
}
