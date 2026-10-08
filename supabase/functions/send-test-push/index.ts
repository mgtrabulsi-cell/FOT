import { createClient } from 'npm:@supabase/supabase-js@2';
import { createWebPushServer, isExpiredPushSubscription, sendWebPush } from '../_shared/webpush.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return jsonResponse({ error: 'Notification service is not configured.' }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return jsonResponse({ error: 'Sign in to send a test notification.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: subscriptions, error: subscriptionError } = await admin.from('user_push_subscriptions')
    .select('endpoint, subscription')
    .eq('user_id', user.id);
  if (subscriptionError) return jsonResponse({ error: 'Could not load this account’s push subscriptions.' }, 500);
  if (!subscriptions?.length) return jsonResponse({ error: 'Enable notifications on this device first.' }, 404);

  try {
    const server = await createWebPushServer();
    const results = await Promise.allSettled(subscriptions.map(async (entry) => {
      try {
        await sendWebPush(server, entry.subscription, {
          title: 'GameWire notifications are on',
          body: 'You will receive score updates for games you follow.',
          url: '/#scores',
          tag: 'gamewire-test',
        });
      } catch (error) {
        if (isExpiredPushSubscription(error)) {
          await admin.from('user_push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', entry.endpoint);
        }
        throw error;
      }
    }));
    const sent = results.filter((result) => result.status === 'fulfilled').length;
    if (!sent) return jsonResponse({ error: 'The push service could not deliver to this device.' }, 502);
    return jsonResponse({ sent });
  } catch {
    return jsonResponse({ error: 'Could not create a push notification. Check the VAPID Edge Function secrets.' }, 500);
  }
});