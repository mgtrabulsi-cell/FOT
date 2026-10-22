import { xAuthorization, type XCredentials } from '../_shared/xPosting.ts';

export async function uploadAnalysisImage(credentials: XCredentials, image: { png: Uint8Array; alt: string }): Promise<string> {
  const endpoint = 'https://api.x.com/2/media/upload';
  const form = new FormData();
  form.set('media', new Blob([image.png.slice().buffer], { type: 'image/png' }), 'gamewire-analysis.png');
  form.set('media_category', 'tweet_image');
  form.set('media_type', 'image/png');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Authorization: await xAuthorization(credentials, 'POST', endpoint) },
    body: form, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`X analysis image upload failed (HTTP ${response.status}). Check media access/credits. No tweet was sent.`);
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
