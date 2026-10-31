/* ParLink V1.5.1: the app shell works offline; updates are applied between rounds. */
const CACHE_NAME = 'parlink-shell-1.5.1';
const SHELL_PATHS = ['/', '/index.html', '/index-15.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // A failed download rejects installation, leaving any working old version in place.
    await cache.addAll(SHELL_PATHS.map(path => new Request(path, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('parlink-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && ['/', '/index.html', '/index-15.html'].includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match('/')) || fetch(request);
    })());
  } else if (SHELL_PATHS.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(url.pathname)) || fetch(request);
    })());
  }
});

