const CACHE_NAME = 'cloudfleet-shell-v1';
const SHELL = ['/', '/driver', '/manifest.webmanifest', '/pwa-icon.svg', '/favicon.svg', '/runtime-config.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
    await cache.addAll(SHELL);
    const index = await cache.match('/');
    const html = index ? await index.text() : '';
    const assets = [...html.matchAll(/(?:src|href)="(\/[^\"]+)"/g)].map((match) => match[1]).filter(Boolean);
    await Promise.allSettled(assets.map((asset) => cache.add(asset)));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match('/'))));
    return;
  }
  if (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.svg'))) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: 'CloudFleet', body: 'Your delivery route was updated.', url: '/driver', tag: 'cloudfleet-update' };
  try { if (event.data) payload = { ...payload, ...event.data.json() }; } catch { /* keep safe defaults */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/pwa-icon.svg',
    badge: '/pwa-icon.svg',
    tag: payload.tag,
    data: { url: payload.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/driver', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url.startsWith(self.location.origin));
    if (existing) { existing.navigate(target); return existing.focus(); }
    return self.clients.openWindow(target);
  }));
});
