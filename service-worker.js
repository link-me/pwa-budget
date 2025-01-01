const CACHE_NAME = 'pwa-budget-v51';
const PRECACHE = [
  './styles.css?v=51',
  './manifest.json',
  './favicon.svg',
  './index.html',
  './src/main.js?v=51',
  './src/extra.js?v=51',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve()))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(request) {
  return fetch(request).then((resp) => {
    const copy = resp.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
    return resp;
  }).catch(() => caches.match(request));
}

function cacheFirst(request) {
  return caches.match(request).then((cached) =>
    cached || fetch(request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
      return resp;
    }).catch(() => cached)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Никогда не кешируем API-запросы, всегда идём в сеть
  if (url.pathname.startsWith('/api/') || url.href.includes('/api/') || url.pathname.startsWith('/money/api/')) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }
  const dest = request.destination;
  const accept = request.headers.get('accept') || '';
  const isHTML = dest === 'document' || accept.includes('text/html');
  const isJS = dest === 'script' || url.pathname.endsWith('.js');
  const isCSS = dest === 'style' || url.pathname.endsWith('.css');
  if (isHTML || isJS || isCSS) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});