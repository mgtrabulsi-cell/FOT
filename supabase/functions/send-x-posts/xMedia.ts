import { xAuthorization, type XCredentials } from '../_shared/xPosting.ts';

export type XImage = { bytes: Uint8Array; type: string; alt: string };
export async function attachmentImage(data: Blob, alt: string): Promise<XImage> {
  if (!data.size || data.size > 5 * 1024 * 1024) throw new Error('The attached X image is empty or exceeds 5 MB. No tweet was sent.');
  const bytes = new Uint8Array(await data.arrayBuffer());
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const type = starts([137,80,78,71,13,10,26,10]) ? 'image/png'
    : starts([255,216,255]) ? 'image/jpeg'
    : starts([71,73,70,56]) && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97 ? 'image/gif'
    : starts([82,73,70,70]) && [87,69,66,80].every((byte, index) => bytes[index + 8] === byte) ? 'image/webp' : '';
  if (!type || data.type.split(';')[0] !== type) throw new Error('The attached X image has an invalid or mismatched format. No tweet was sent.');
  return { bytes, type, alt };
}

export async function uploadAnalysisImage(credentials: XCredentials, image: { png: Uint8Array; alt: string }): Promise<string> {
  return uploadImage(credentials, { bytes: image.png, type: 'image/png', alt: image.alt });
}

export async function uploadImage(credentials: XCredentials, image: XImage): Promise<string> {
  const endpoint = 'https://api.x.com/2/media/upload';
  const form = new FormData();
  const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.slice('image/'.length);
  form.set('media', new Blob([image.bytes.slice().buffer], { type: image.type }), `gamewire-image.${extension}`);
  form.set('media_category', 'tweet_image');
  form.set('media_type', image.type);
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Authorization: await xAuthorization(credentials, 'POST', endpoint) },
    body: form, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`X image upload failed (HTTP ${response.status}). Check media access/credits. No tweet was sent.`);
  const result = await response.json();
  const id = result.data?.id;
  if (typeof id !== 'string' || !/^\d+$/.test(id) || (result.data?.processing_info && result.data.processing_info.state !== 'succeeded')) {
    throw new Error('X did not return a ready analysis image ID. No tweet was sent.');
  }
  const metadata = 'https://api.x.com/2/media/metadata';
  const altResponse = await fetch(metadata, {
    method: 'POST', headers: { Authorization: await xAuthorization(credentials, 'POST', metadata), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, metadata: { alt_text: { text: image.alt } } }), signal: AbortSignal.timeout(15_000),
  });
  if (!altResponse.ok) throw new Error(`X image accessibility metadata failed (HTTP ${altResponse.status}). No tweet was sent.`);
  return id;
}
