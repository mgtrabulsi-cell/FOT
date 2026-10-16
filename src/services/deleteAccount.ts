import { supabase } from './supabaseClient';
import { nativeApp, NativeOffline } from './nativeOffline';
import { stopWebOffline } from './webOffline';

export async function deleteAccount(password: string, confirmation: string): Promise<string[]> {
  if (!supabase) throw new Error('Account services are not configured.');
  if (!navigator.onLine) throw new Error('Reconnect to delete your account.');
  const { data, error } = await supabase.functions.invoke('delete-account', { body: { password, confirmation } });
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      const result: unknown = await error.context.json();
      if (result && typeof result === 'object' && 'error' in result && typeof result.error === 'string') throw new Error(result.error);
    }
    throw new Error(error.message);
  }
  if (data?.deleted !== true) throw new Error('The server did not confirm account deletion. Please retry.');
  const tasks: Array<{ name: string; run: () => Promise<void> }> = [
    { name: 'saved browsing', run: async () => {
      if (nativeApp) await NativeOffline.clear();
      else stopWebOffline();
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith('gamewire-offline:') && !name.includes(':shell:')).map((name) => caches.delete(name)));
      }
    } },
    { name: 'local account preferences', run: async () => {
      for (const storage of [localStorage, sessionStorage]) {
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
        keys.forEach((key) => {
          if (key && (key.startsWith('gamewire') || key.startsWith('fieldhouse:'))) storage.removeItem(key);
        });
      }
    } },
    { name: 'this device’s push subscription', run: async () => {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription && !await subscription.unsubscribe()) throw new Error('The browser did not unsubscribe.');
      }
    } },
    { name: 'local sign-in session', run: async () => {
      const result = await supabase!.auth.signOut({ scope: 'local' });
      if (result.error) throw result.error;
    } },
  ];
  const warnings: string[] = [];
  for (const task of tasks) {
    try { await task.run(); }
    catch (cause) {
      console.error(`Deleted account: could not clear ${task.name}`, cause);
      warnings.push(task.name);
    }
  }
  return warnings;
}
