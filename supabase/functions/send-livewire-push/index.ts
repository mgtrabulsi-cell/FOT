import { createClient } from 'npm:@supabase/supabase-js@2';
import { createWebPushServer, isExpiredPushSubscription, sendWebPush } from '../_shared/webpush.ts';

Deno.serve(async (request: Request) => {
  const secret = Deno.env.get('GAMEWIRE_CRON_SECRET');
  if (!secret || request.headers.get('x-gamewire-cron-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Supabase server configuration is missing.');
    const admin = createClient(url, key);
    const { data: deliveries, error } = await admin.rpc('claim_livewire_push');
    if (error) throw error;
    if (!deliveries?.length) return Response.json({ sent: 0, failed: 0 });
    const pushServer = await createWebPushServer();
    let sent = 0;
    let failed = 0;
    for (let start = 0; start < deliveries.length; start += 10) {
      await Promise.all(deliveries.slice(start, start + 10).map(async (delivery: {
        id: number; post_id: string | null; angle_id?: string | null; user_id: string; endpoint: string; subject: string; attempts: number; primary_theme?: 'news' | 'fantasy' | 'betting' | null;
      }) => {
        try {
          const { data: target, error: targetError } = await admin.from('user_push_subscriptions')
            .select('subscription').eq('user_id', delivery.user_id).eq('endpoint', delivery.endpoint).maybeSingle();
          if (targetError) throw targetError;
          if (!target) {
            const { error: cleanupError } = await admin.from('livewire_push_deliveries').delete().eq('id', delivery.id);
            if (cleanupError) throw cleanupError;
            return;
          }
          if (delivery.angle_id) {
            const { data: story, error: storyError } = await admin.from('angles').select('id')
              .eq('id', delivery.angle_id).eq('status', 'published').maybeSingle();
            if (storyError) throw storyError;
            if (!story) {
              const { error: cleanupError } = await admin.from('livewire_push_deliveries').delete().eq('id', delivery.id);
              if (cleanupError) throw cleanupError;
              return;
            }
          }
          const graphicSubject = !delivery.angle_id && delivery.primary_theme === 'fantasy'
            ? /^(Week \d+ Must (?:Start|Sit)) Fantasy (QB|RB|WR|TE)$/.exec(delivery.subject)
            : null;
          const title = graphicSubject
            ? `${graphicSubject[1]} ${graphicSubject[2]}s`
            : `${delivery.primary_theme ? delivery.primary_theme[0].toUpperCase() + delivery.primary_theme.slice(1) : delivery.angle_id ? 'News' : 'LIVEWIRE'}: ${delivery.subject}`;
          await sendWebPush(pushServer, target.subscription, {
            title,
            body: '',
            url: new URL(delivery.angle_id ? `#analyst-desk/story/${delivery.angle_id}` : `#livewire/post/${delivery.post_id}`, Deno.env.get('GAMEWIRE_SITE_URL') ?? 'https://mgtrabulsi-cell.github.io/FOT/').href,
            tag: delivery.angle_id ? `gamewire-storyline-${delivery.angle_id}` : `gamewire-livewire-${delivery.post_id}`,
          });
          const { error: saveError } = await admin.from('livewire_push_deliveries')
            .update({ delivered_at: new Date().toISOString(), last_error: null }).eq('id', delivery.id);
          if (saveError) throw saveError;
          sent++;
        } catch (cause) {
          if (isExpiredPushSubscription(cause)) {
            const { error: removeError } = await admin.from('user_push_subscriptions').delete()
              .eq('user_id', delivery.user_id).eq('endpoint', delivery.endpoint);
            if (removeError) throw removeError;
            return;
          }
          failed++;
          const message = cause instanceof Error ? cause.message : 'LIVEWIRE push delivery failed';
          console.error('LIVEWIRE delivery failed', { deliveryId: delivery.id, message });
          const retryAt = new Date(Date.now() + Math.min(3600, 60 * 2 ** Math.min(delivery.attempts, 6)) * 1000);
          const { error: retryError } = await admin.from('livewire_push_deliveries')
            .update({ last_error: message.slice(0, 1000), next_attempt_at: retryAt.toISOString() }).eq('id', delivery.id);
          if (retryError) throw retryError;
        }
      }));
    }
    return Response.json({ sent, failed }, { status: failed ? 503 : 200 });
  } catch (cause) {
    console.error('LIVEWIRE push dispatch failed', cause);
    return Response.json({ error: 'LIVEWIRE push dispatch failed. Pending deliveries will be retried.' }, { status: 500 });
  }
});
