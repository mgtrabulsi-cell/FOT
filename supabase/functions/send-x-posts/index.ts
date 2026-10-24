import { createClient } from 'npm:@supabase/supabase-js@2';
import { xAuthorization, xImagePostText, xSource } from '../_shared/xPosting.ts';
import { analysisImages } from './analysisImages.ts';
import { uploadAnalysisImage } from './xMedia.ts';

Deno.serve(async (request: Request) => {
  const secret = Deno.env.get('GAMEWIRE_CRON_SECRET');
  if (!secret || request.headers.get('x-gamewire-cron-secret') !== secret) return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let reportFailure: ((message: string) => Promise<void>) | undefined;
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Supabase server configuration is missing');
    const admin = createClient(url, key);
    reportFailure = async (message) => {
      const { error } = await admin.from('x_publications').update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq('status', 'pending');
      if (error) console.error('Could not record X connection failure', error);
    };
    const { data: settings, error: settingsError } = await admin.from('x_publishing_settings').select('enabled').eq('id', true).single();
    if (settingsError) throw settingsError;
    if (!settings.enabled) return Response.json({ enabled: false, sent: 0 });
    const { error: expireError } = await admin.from('x_publications').update({
      status: 'unknown', updated_at: new Date().toISOString(),
      last_error: 'Dispatch interrupted. Check the X account before attempting to repost.',
    }).eq('status', 'sending').lt('updated_at', new Date(Date.now() - 5 * 60_000).toISOString());
    if (expireError) throw expireError;
    const { data: pending, error: pendingError } = await admin.from('x_publications').select('id').eq('status', 'pending').limit(1);
    if (pendingError) throw pendingError;
    if (!pending?.length) return Response.json({ sent: 0, failed: 0 });
    const apiKey = Deno.env.get('X_API_KEY');
    const apiSecret = Deno.env.get('X_API_SECRET');
    const accessToken = Deno.env.get('X_ACCESS_TOKEN');
    const accessSecret = Deno.env.get('X_ACCESS_TOKEN_SECRET');
    const expectedUser = Deno.env.get('X_ACCOUNT_ID');
    if (!apiKey || !apiSecret || !accessToken || !accessSecret || !expectedUser) throw new Error('X credentials and account ID must be configured before enabling');
    const credentials = { apiKey, apiSecret, accessToken, accessSecret };
    const meUrl = 'https://api.x.com/2/users/me';
    const meResponse = await fetch(meUrl, {
      headers: { Authorization: await xAuthorization(credentials, 'GET', meUrl) }, signal: AbortSignal.timeout(15_000),
    });
    if (!meResponse.ok) throw new Error(`X account verification failed (HTTP ${meResponse.status}); check permissions and API credits`);
    const me = await meResponse.json();
    if (me.data?.id !== expectedUser) throw new Error('X account does not match the configured GameWire account');
    const { data: deliveries, error } = await admin.rpc('claim_x_publications');
    if (error) throw error;
    let sent = 0;
    let failed = 0;
    for (const delivery of deliveries ?? []) {
      let attempted = false;
      let acceptedId: string | undefined;
      try {
        const angle = delivery.source_type === 'angle';
        const loadSource = async () => {
          if (angle) {
            const { data, error } = await admin.from('angles').select('title,subject,narrative,evidence,counterpoint,pick,picks,review_picks,game_id,status').eq('id', delivery.source_id).maybeSingle();
            if (error) throw error;
            return data && data.status === 'published' ? xSource(data, true, delivery.source_id) : null;
          }
          const { data, error } = await admin.from('livewire_posts').select('title,body,angle_id,fantasy_graphic_id,image_paths').eq('id', delivery.source_id).maybeSingle();
          if (error) throw error;
          return data && data.angle_id === null ? xSource(data, false, delivery.source_id) : null;
        };
        const source = await loadSource();
        if (!source) {
          const { error: cancelError } = await admin.from('x_publications').update({
            status: 'cancelled', updated_at: new Date().toISOString(), last_error: 'Source was removed or unpublished before dispatch',
          }).eq('id', delivery.id);
          if (cancelError) throw cancelError;
          continue;
        }
        const link = `https://gamewire.us/${angle ? '#analyst-desk/story/' : '#livewire/post/'}${delivery.source_id}`;
        const text = xImagePostText(source, link);
        const graphicImage = source.graphicImage;
        const images = graphicImage ? await (async () => {
          const { data, error } = await admin.storage.from('livewire-photos').download(graphicImage);
          if (error) throw error;
          if (!data || data.type !== 'image/png' || data.size > 5 * 1024 * 1024) throw new Error('The published Start/Sit PNG is missing or invalid. No tweet was sent.');
          const png = new Uint8Array(await data.arrayBuffer());
          if (![137,80,78,71,13,10,26,10].every((byte, index) => png[index] === byte)) throw new Error('The published Start/Sit attachment is not a PNG. No tweet was sent.');
          return [{ png, alt: source.title }];
        })() : await analysisImages(source);
        const mediaIds: string[] = [];
        for (const image of images) mediaIds.push(await uploadAnalysisImage(credentials, image));
        const latest = await loadSource();
        if (!latest) {
          const { error } = await admin.from('x_publications').update({
            status: 'cancelled', updated_at: new Date().toISOString(), last_error: 'Source removed or unpublished during image preparation',
          }).eq('id', delivery.id);
          if (error) throw error;
          continue;
        }
        if (JSON.stringify(latest) !== JSON.stringify(source)) throw new Error('Source changed during image preparation. No tweet was sent; review the updated post before sharing manually.');
        const endpoint = 'https://api.x.com/2/tweets';
        const authorization = await xAuthorization(credentials, 'POST', endpoint);
        attempted = true;
        const response = await fetch(endpoint, {
          method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, media: { media_ids: mediaIds } }), signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          // 5xx and network errors are ambiguous; even a received error must not trigger a duplicate.
          if (response.status < 500) attempted = false;
          throw new Error(`X returned HTTP ${response.status}. Check X permissions, credits, and rate limits. No automatic repost will be attempted.`);
        }
        const result = await response.json();
        if (typeof result.data?.id !== 'string' || !/^\d+$/.test(result.data.id)) throw new Error('X returned no valid post ID. Check the account before reposting.');
        acceptedId = result.data.id;
        const { error: saveError } = await admin.from('x_publications').update({
          status: 'sent', tweet_id: acceptedId, last_error: null, updated_at: new Date().toISOString(),
        }).eq('id', delivery.id);
        if (saveError) throw saveError;
        sent++;
      } catch (cause) {
        failed++;
        const message = cause instanceof Error ? cause.message : 'X publishing failed';
        console.error('X publication failed', { deliveryId: delivery.id, tweetId: acceptedId, message });
        const { error: recordError } = await admin.from('x_publications').update({
          status: attempted ? 'unknown' : 'failed', tweet_id: acceptedId ?? null,
          last_error: message.slice(0, 1000), updated_at: new Date().toISOString(),
        }).eq('id', delivery.id);
        if (recordError) throw recordError;
      }
    }
    return Response.json({ sent, failed }, { status: failed ? 503 : 200 });
  } catch (cause) {
    console.error('X dispatcher failed', cause);
    if (reportFailure) await reportFailure(cause instanceof Error ? cause.message : 'X connection failed; check function logs');
    return Response.json({ error: 'X dispatcher failed. Check server configuration and function logs; pending posts were not marked sent.' }, { status: 503 });
  }
});
