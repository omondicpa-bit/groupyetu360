// GroupYetu360 Service Worker v3.0 — groupyetu.org
const CACHE_NAME = 'gy360-v5';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/js/auth.js',
  '/js/utils.js',
  '/js/dashboard.js',
  '/js/members.js',
  '/js/finance.js',
  '/js/settings.js',
  '/js/portal.js',
  '/js/modules.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', event => {
  console.log('[GY360 SW] Installing v3...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_ASSETS).catch(err =>
        console.log('[GY360 SW] Cache install error (ok for first run):', err)
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Only cache same-origin requests
  if (url.origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});
