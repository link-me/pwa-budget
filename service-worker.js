const CACHE_NAME = 'pwa-budget-v2';
const ASSETS = [
  './index.html',
  './styles.css',
  './manifest.json',
  './src/main.js',
  './src/app.js',
  './src/ui.js',
  './src/db.js',
  './src/charts.js',
  './src/extra.js',
  './src/sync.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return resp;
      }).catch(() => cached)
    )
  );
});