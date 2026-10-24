import { useState } from 'react';
import OfflineImage from './OfflineImage';
import PostPhotoViewer from './PostPhotoViewer';
import PostVideo from './PostVideo';
import { isPostVideo } from './services/postMedia';
import { supabase } from './services/supabaseClient';

export function postPhotoUrl(path: string) {
  return supabase?.storage.from('livewire-photos').getPublicUrl(path).data.publicUrl ?? '';
}

export default function PostGallery({ paths, title }: { paths: string[]; title: string }) {
  const [expanded, setExpanded] = useState<{ src: string; alt: string } | null>(null);
  return <>
    {!!paths.length && <div className={`livewire-gallery livewire-gallery-${paths.length}`}>{paths.map((path, index) => isPostVideo(path)
      ? <PostVideo key={path} src={postPhotoUrl(path)} label={`${title} - video ${index + 1}`} />
      : <button type="button" key={path} onClick={() => setExpanded({ src: postPhotoUrl(path), alt: `${title} - photo ${index + 1}` })} aria-label={`Enlarge photo ${index + 1} for ${title}`}><OfflineImage src={postPhotoUrl(path)} alt={`${title} - photo ${index + 1}`} loading="lazy" onError={(event) => { event.currentTarget.alt = 'Photo unavailable'; }} /></button>)}</div>}
    {expanded && <PostPhotoViewer {...expanded} onClose={() => setExpanded(null)} />}
  </>;
}
