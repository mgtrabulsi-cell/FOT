import { zipSync } from 'fflate';
import type { Zippable } from 'fflate';

export function graphicSlideFilename(filename: string, index: number, count: number) {
  return count === 1 ? filename : `${filename.replace(/\.png$/i, '')}-${index + 1}-of-${count}.png`;
}
export async function graphicSlidesArchive(blobs: Blob[], filename: string): Promise<Blob> {
  if (!blobs.length) throw new Error('No graphic slides are available to save.');
  const files: Zippable = {};
  for (const [index, blob] of blobs.entries()) {
    files[graphicSlideFilename(filename, index, blobs.length)] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([new Uint8Array(zipSync(files))], { type: 'application/zip' });
}
export async function shareGraphicSlides(blobs: Blob[], filename: string) {
  const files = blobs.map((blob, index) => new File([blob], graphicSlideFilename(filename, index, blobs.length), { type: 'image/png' }));
  if (!navigator.canShare?.({ files }) || !navigator.share)
    throw new Error('Sharing images is unavailable in this browser. Use Download all slides (ZIP), or save each slide below.');
  await navigator.share({ files });
}
