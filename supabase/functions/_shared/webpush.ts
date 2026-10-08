import {
  ApplicationServer,
  importVapidKeys,
  PushMessageError,
  type PushSubscription,
} from 'jsr:@negrel/webpush@0.5.0';

export async function createWebPushServer() {
  const exportedKeys = Deno.env.get('VAPID_KEYS_JSON');
  const contactInformation = Deno.env.get('VAPID_CONTACT');
  if (!exportedKeys || !contactInformation) {
    throw new Error('VAPID_KEYS_JSON and VAPID_CONTACT must be configured.');
  }
  const vapidKeys = await importVapidKeys(JSON.parse(exportedKeys));
  return ApplicationServer.new({ contactInformation, vapidKeys });
}

export async function sendWebPush(
  server: ApplicationServer,
  subscription: unknown,
  payload: Record<string, unknown>,
) {
  await server.subscribe(subscription as PushSubscription)
    .pushTextMessage(JSON.stringify(payload), { ttl: 300, urgency: 'high' });
}

export function isExpiredPushSubscription(error: unknown) {
  return error instanceof PushMessageError && error.isGone();
}