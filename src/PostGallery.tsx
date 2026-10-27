import { useState } from 'react';
import OfflineImage from './OfflineImage';
import PostPhotoViewer from './PostPhotoViewer';
import PostVideo from './PostVideo';
import { isPostVideo } from './services/postMedia';
import { supabase } from './services/supabaseClient';
import { feedImageUrl } from './services/postImages';

export function postPhotoUrl(path: string) {
  return supabase?.storage.from('livewire-photos').getPublicUrl(path).data.publicUrl ?? '';
}

function FeedPhoto({ original, alt }: { original: string; alt: string }) {
  const [useOriginal, setUseOriginal] = useState(false);
  const thumbnail = feedImageUrl(original);
  return <OfflineImage src={useOriginal ? original : thumbnail} alt={alt} loading="lazy" decoding="async" onError={(event) => {
    if (!useOriginal && thumbnail !== original) {
      console.error('Feed thumbnail could not load; retrying the original image');
      setUseOriginal(true);
    } else event.currentTarget.alt = 'Photo unavailable';
  }} />;
}

export default function PostGallery({ paths, title }: { paths: string[]; title: string }) {
  const [expanded, setExpanded] = useState<{ src: string; alt: string } | null>(null);
  return <>
    {!!paths.length && <div className={`livewire-gallery livewire-gallery-${paths.length}`}>{paths.map((path, index) => isPostVideo(path)
      ? <PostVideo key={path} src={postPhotoUrl(path)} label={`${title} - video ${index + 1}`} />
      : <button type="button" key={path} onClick={() => setExpanded({ src: postPhotoUrl(path), alt: `${title} - photo ${index + 1}` })} aria-label={`Enlarge photo ${index + 1} for ${title}`}><FeedPhoto original={postPhotoUrl(path)} alt={`${title} - photo ${index + 1}`} /></button>)}</div>}
    {expanded && <PostPhotoViewer {...expanded} onClose={() => setExpanded(null)} />}
  </>;
}
