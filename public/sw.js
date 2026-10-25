self.addEventListener('fetch', (event) => {
  if (!self.GAMEWIRE_OFFLINE || event.request.method !== 'GET') return;
  const kind = offlineRequestKind(event.request);
  if (kind) event.respondWith(offlineResponse(event, kind));
});

const cachePrefix = `gamewire-offline:${self.registration.scope}:`;
const shellCache = `${cachePrefix}shell:${self.GAMEWIRE_OFFLINE?.version ?? 'development'}`;
const dataCache = `${cachePrefix}public:v1`;
const imageCache = `${cachePrefix}images:v1`;
const savedHeader = 'x-gamewire-saved-at';
const offlineClients = new Set();
const pendingSaves = new Set();
const dataLimit = 1500;
const imageLimit = 2500;
let saveFailures = 0;

self.addEventListener('message', (event) => {
  if (event.data?.type === 'GAMEWIRE_CONNECTION_STATUS' && event.source) {
    event.source.postMessage({ type: 'GAMEWIRE_CONNECTION_STATUS', offline: offlineClients.has(event.source.id) });
  }
  if (event.data?.type === 'GAMEWIRE_SNAPSHOT_START' && event.ports?.[0]) {
    event.waitUntil((async () => {
      await Promise.allSettled([...pendingSaves]);
      event.ports[0].postMessage({ failures: saveFailures });
    })());
  }
  if (event.data?.type === 'GAMEWIRE_SAVE_IMAGES' && event.ports?.[0]) {
    event.waitUntil((async () => {
      try {
        if (!Array.isArray(event.data.urls) || event.data.urls.length > imageLimit) throw new Error('Invalid offline image list');
        const urls = [...new Set(event.data.urls)];
        const cache = await caches.open(imageCache);
        for (let start = 0; start < urls.length; start += 4) {
          await Promise.all(urls.slice(start, start + 4).map(async (url) => {
            if (typeof url !== 'string' || !isOfflineImage(new URL(url))) throw new Error('Unsupported offline image');
            if (await cache.match(url)) return;
            // CORS avoids opaque-response quota overhead where the image host supports it.
            let response;
            try { response = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(15000) }); }
            catch { response = await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(15000) }); }
            if (!response.ok && response.type !== 'opaque') throw new Error(`Image returned HTTP ${response.status}`);
            await remember(cache, url, response, imageLimit);
          }));
        }
        await Promise.all([...pendingSaves]);
        if (event.data.failures !== undefined && event.data.failures !== saveFailures) throw new Error('Some public responses could not be saved.');
        event.ports[0].postMessage({ saved: true });
      } catch (error) {
        console.error('Offline image snapshot failed', error);
        event.ports[0].postMessage({ saved: false });
      }
    })());
  }
});

function isOfflineImage(url) {
  return url.protocol === 'https:' && (url.hostname === 'a.espncdn.com'
    || (url.origin === self.GAMEWIRE_OFFLINE.publicApiOrigin && url.pathname.startsWith('/storage/v1/object/public/livewire-photos/')));
}

function offlineRequestKind(request) {
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    if (request.mode === 'navigate') return 'shell';
    if (self.GAMEWIRE_OFFLINE.assets.some((asset) => new URL(asset, scope).pathname === url.pathname)) return 'asset';
  }
  if (url.hostname === 'site.api.espn.com' || url.hostname === 'site.web.api.espn.com'
    || url.hostname === 'sports.core.api.espn.com' || url.hostname === 'lm-api-reads.fantasy.espn.com') return 'data';
  if (url.origin === self.GAMEWIRE_OFFLINE.publicApiOrigin
    && /^\/rest\/v1\/(livewire_posts|matchup_boards)$/.test(url.pathname)) return 'data';
  if (request.destination === 'image' && isOfflineImage(url)) return 'image';
  return null;
}

async function notifyOffline(message, clientId) {
  if (clientId) {
    const client = await self.clients.get(clientId);
    client?.postMessage(message);
    return;
  }
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(message));
}

async function remember(cache, key, response, limit) {
  await cache.put(key, response);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((entry) => cache.delete(entry)));
}

async function offlineResponse(event, kind) {
  const request = event.request;
  const cacheUrl = new URL(kind === 'shell' ? new URL('index.html', self.registration.scope).href : request.url);
  if (kind === 'data') {
    const filter = request.headers.get('x-fantasy-filter');
    if (filter) cacheUrl.searchParams.set('__gamewire_filter', filter);
    const accept = request.headers.get('accept');
    if (accept) cacheUrl.searchParams.set('__gamewire_accept', accept);
  }
  const key = cacheUrl.href;
  let cache;
  let cached;
  try {
    cache = await caches.open(kind === 'shell' || kind === 'asset' ? shellCache : kind === 'image' ? imageCache : dataCache);
    cached = await cache.match(key);
  } catch (error) {
    console.error('Offline storage is unavailable', error);
    await notifyOffline({ type: 'GAMEWIRE_OFFLINE_SAVE_ERROR' }, event.clientId);
    return fetch(request);
  }
  if (cached && (kind === 'asset' || kind === 'image')) return cached;
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const liveRead = kind === 'data' && (request.cache === 'no-store' || request.cache === 'reload');
  const timeout = setTimeout(abort, cached && !liveRead ? 4000 : 15000);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (!response.ok && response.type !== 'opaque') throw new Error(`HTTP ${response.status}`);
    if (kind === 'shell') offlineClients.delete(event.resultingClientId);
    if (kind !== 'shell') {
      const copy = response.clone();
      const save = (async () => {
        if (kind === 'data') {
          const body = await copy.blob();
          if (body.size > 5 * 1024 * 1024) throw new Error('Public response exceeds offline storage limit');
          const headers = new Headers(copy.headers);
          headers.set(savedHeader, new Date().toISOString());
          headers.delete('vary');
          headers.delete('content-encoding');
          headers.delete('content-length');
          await remember(cache, key, new Response(body, { status: copy.status, headers }), dataLimit);
        } else {
          await remember(cache, key, copy, kind === 'image' ? imageLimit : 100);
        }
      })();
      pendingSaves.add(save);
      event.waitUntil(save.catch(async (error) => {
        saveFailures++;
        console.error('Offline saving failed', error);
        await notifyOffline({ type: 'GAMEWIRE_OFFLINE_SAVE_ERROR' }, event.clientId);
      }).finally(() => pendingSaves.delete(save)));
    }
    return response;
  } catch (error) {
    if (request.signal.aborted) throw error;
    if (cached) {
      if (kind === 'data') saveFailures++;
      if (kind === 'shell' && event.resultingClientId) offlineClients.add(event.resultingClientId);
      if (kind !== 'shell') event.waitUntil(notifyOffline({ type: 'GAMEWIRE_CACHED_RESPONSE', savedAt: cached.headers.get(savedHeader), url: request.url }, event.clientId));
      return cached;
    }
    console.warn('No offline copy is available', request.url, error);
    if (kind === 'data') return new Response(JSON.stringify({ message: 'This data has not been saved on this device. Reconnect to load it.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    if (kind === 'shell') return new Response('GameWire is not saved on this device yet. Reconnect and open the app once to enable offline access.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    return Response.error();
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (self.GAMEWIRE_OFFLINE) {
      const cache = await caches.open(shellCache);
      try {
        await cache.addAll(self.GAMEWIRE_OFFLINE.assets.map((asset) => new URL(asset, self.registration.scope).href));
      } catch (error) {
        await caches.delete(shellCache);
        console.error('GameWire offline installation failed', error);
        throw error;
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.GAMEWIRE_OFFLINE) {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(`${cachePrefix}shell:`) && name !== shellCache).map((name) => caches.delete(name)));
    }
    await self.clients.claim();
  })());
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
    const storyId = /^gamewire-storyline-([0-9a-f-]{36})$/i.exec(event.notification.tag ?? '')?.[1];
    const gameId = /^gamewire-(?:play-)?(\d+)(?:-|$)/.exec(event.notification.tag ?? '')?.[1];
    try {
      const requested = new URL(event.notification.data?.url ?? '#wire', self.registration.scope);
      target.hash = storyId ? `analyst-desk/story/${storyId}` : postId ? `livewire/post/${postId}` : gameId ? `wire/game/${gameId}` : requested.hash || '#wire';
    } catch (error) {
      console.error('Invalid notification destination', error);
      target.hash = storyId ? `analyst-desk/story/${storyId}` : postId ? `livewire/post/${postId}` : gameId ? `wire/game/${gameId}` : '#wire';
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