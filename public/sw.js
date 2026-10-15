self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() ?? '' };
  }

  event.waitUntil(self.registration.showNotification(payload.title ?? 'Gamewire', {
    body: payload.body ?? 'There is an update for a game you follow.',
    icon: new URL('gamewire-pwa.svg', self.registration.scope).href,
    badge: new URL('gamewire-pwa.svg', self.registration.scope).href,
    tag: payload.tag ?? 'gamewire-update',
    data: { url: payload.url ?? self.registration.scope + '#wire' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(self.registration.scope);
    const postId = /^gamewire-livewire-([0-9a-f-]{36})$/i.exec(event.notification.tag ?? '')?.[1];
    const gameId = /^gamewire-(?:play-)?(\d+)(?:-|$)/.exec(event.notification.tag ?? '')?.[1];
    try {
      const requested = new URL(event.notification.data?.url ?? '#wire', self.registration.scope);
      target.hash = postId ? `livewire/post/${postId}` : gameId ? `wire/game/${gameId}` : requested.hash || '#wire';
    } catch (error) {
      console.error('Invalid notification destination', error);
      target.hash = postId ? `livewire/post/${postId}` : gameId ? `wire/game/${gameId}` : '#wire';
    }
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((client) => {
      const url = new URL(client.url);
      return url.origin === target.origin && url.pathname.startsWith(target.pathname);
    });
    if (existing) {
      existing.postMessage({ type: 'GAMEWIRE_NOTIFICATION_OPEN', url: target.href });
      await existing.focus();
    } else {
      await self.clients.openWindow(target.href);
    }
  })());
});