// Version static assets so a newly deployed worker replaces old cached files.
const CACHE_NAME = 'sikka-fleet-static-v1';
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await self.skipWaiting();
    })
  );
});

// Remove only older Sikka Fleet caches when this worker activates.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith('sikka-fleet-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })
  );
});

// Never intercept auth/API requests or personalized page navigations.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/_next/data/')
  ) {
    return;
  }

  const isAppShell = request.mode === 'navigate' && pathname === '/' && !url.search;
  const isStaticAsset =
    pathname === '/manifest.json' ||
    pathname.startsWith('/_next/static/') ||
    /\.(?:css|js|mjs|png|jpe?g|webp|svg|ico|woff2?|ttf)$/i.test(pathname);

  if (!isAppShell && !isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const responseCopy = response.clone();
          return caches.open(CACHE_NAME).then((cache) =>
            cache.put(request, responseCopy).then(() => response)
          ).catch(() => response);
        }
        return response;
      }).catch(() => {
        if (isAppShell) return caches.match('/');
        throw new Error('Static asset is unavailable while offline.');
      });
    })
  );
});
