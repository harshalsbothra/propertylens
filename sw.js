const CACHE='propertylens-v3';
const ASSETS=[
  '/','/index.html','/analyze.html','/property-search.html',
  '/brokers.html','/broker-whatsapp.html','/pricing.html','/about.html','/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Let browser navigation handle redirects normally.
  // Safari rejects redirects returned from a service worker response.
  if (request.mode === 'navigate') return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // Never cache redirects or non-success responses.
        if (response.ok && response.type === 'basic' && !response.redirected) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    })
  );
});
