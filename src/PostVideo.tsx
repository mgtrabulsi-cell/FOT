import { useState } from 'react';

export default function PostVideo({ src, label }: { src: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="post-video">
    <video src={src} controls playsInline preload="none" aria-label={label} onError={() => setFailed(true)} />
    {failed && <p role="alert">This video could not play. Check your connection or try opening the original file. Your browser may not support its video format.</p>}
    <a href={src} target="_blank" rel="noopener noreferrer">Open original video</a>
  </div>;
}
