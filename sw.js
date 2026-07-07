// GroupYetu360 Service Worker v5.22 — groupyetu.org
const CACHE_NAME = 'gy360-v5.22';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/style.css',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];
// JS files are NOT pre-cached — they use query-string cache busting instead
// so the browser always fetches fresh JS on version bumps

self.addEventListener('install', event => {
  console.log('[GY360 SW] Installing v5.22');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_ASSETS).catch(err =>
        console.log('[GY360 SW] Cache install error (ok):', err)
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('[GY360 SW] Activating v5.22 — clearing old caches');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[GY360 SW] Deleting old cache:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept: API calls, fonts, external services
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('africastalking.com') ||
    url.hostname.includes('safaricom.co.ke') ||
    url.hostname.includes('paystack.co') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('jsdelivr.net')
  ) return;

  // JS files: always network first, no caching (query strings handle versioning)
  if (url.pathname.endsWith('.js') || url.search.includes('v=')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else: network first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('/index.html');
        })
      )
  );
});

self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'GroupYetu360', {
    body: data.body || 'You have a new notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    data: data.url || '/',
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data || '/'));
});
