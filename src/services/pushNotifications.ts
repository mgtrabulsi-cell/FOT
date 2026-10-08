import { supabase } from './supabaseClient';

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim() ?? '';

export function supportsPushNotifications() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export function hasPushConfiguration() {
  return Boolean(vapidPublicKey);
}

export async function getPushSettings(userId: string) {
  if (!supportsPushNotifications() || !supabase) {
    return { supported: supportsPushNotifications(), enabled: false, notifyScores: true };
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return { supported: true, enabled: false, notifyScores: true };

  const { data, error } = await supabase.from('user_push_subscriptions')
    .select('notify_scores')
    .eq('user_id', userId)
    .eq('endpoint', subscription.endpoint)
    .maybeSingle();
  if (error) throw error;
  return { supported: true, enabled: Boolean(data), notifyScores: data?.notify_scores ?? true };
}

export async function enablePushNotifications(userId: string, notifyScores: boolean) {
  if (!supabase) throw new Error('Sign in before enabling notifications.');
  if (!supportsPushNotifications()) throw new Error('Push notifications are not supported in this browser.');
  if (!vapidPublicKey) throw new Error('Push notifications are not configured for this site yet.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Allow notifications in your browser to continue.');

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  let createdSubscription = false;
  if (!subscription) {
    const applicationServerKey = decodeVapidKey(vapidPublicKey);
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    createdSubscription = true;
  }

  const { error } = await supabase.from('user_push_subscriptions').upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    subscription: subscription.toJSON(),
    notify_scores: notifyScores,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,endpoint' });
  if (error) {
    if (createdSubscription) await subscription.unsubscribe();
    throw error;
  }
}

export async function updatePushPreference(userId: string, notifyScores: boolean) {
  if (!supabase) throw new Error('The notifications database is unavailable.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) throw new Error('Enable notifications on this device first.');

  const { error } = await supabase.from('user_push_subscriptions')
    .update({ notify_scores: notifyScores, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('endpoint', subscription.endpoint);
  if (error) throw error;
}

export async function disablePushNotifications(userId: string) {
  if (!supabase) throw new Error('The notifications database is unavailable.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const { error } = await supabase.from('user_push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', subscription.endpoint);
  if (error) throw error;
  await subscription.unsubscribe();
}

export async function sendTestPushNotification() {
  if (!supabase) throw new Error('The notifications service is unavailable.');
  const { error } = await supabase.functions.invoke('send-test-push');
  if (error) throw error;
}

function decodeVapidKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}