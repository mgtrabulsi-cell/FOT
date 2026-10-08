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

  event.waitUntil(self.registration.showNotification(payload.title ?? 'GameWire', {
    body: payload.body ?? 'There is an update for a game you follow.',
    icon: new URL('gamewire-pwa.svg', self.registration.scope).href,
    badge: new URL('gamewire-pwa.svg', self.registration.scope).href,
    tag: payload.tag ?? 'gamewire-update',
    data: { url: payload.url ?? self.registration.scope + '#scores' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? self.registration.scope + '#scores', self.location.origin);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    return existing ? existing.navigate(target.href).then(() => existing.focus()) : self.clients.openWindow(target.href);
  }));
});