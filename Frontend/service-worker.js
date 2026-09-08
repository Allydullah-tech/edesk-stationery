/**
 * EDESK STATIONERY - Service Worker
 * Caches the app shell so it can install and open offline.
 * Strategy: NETWORK-FIRST for everything except the Backend API.
 * This means the app always tries to load the latest version first;
 * the cache is only used as a fallback when there is no connection.
 * Data (API calls) always goes straight to the network, never cached.
 */
const CACHE_NAME = 'edesk-stationery-v12';
const SHELL_FILES = [
  './index.html',
  './login.html',
  './forgot-password.html',
  './dashboard.html',
  './products.html',
  './services.html',
  './debts.html',
  './purchases.html',
  './sales.html',
  './expenses.html',
  './damages.html',
  './reports.html',
  './users.html',
  './profile.html',
  './css/style.css',
  './js/api.js',
  './js/manifest-init.js',
  './js/ui.js',
  './js/guard.js',
  './js/dashboard.js',
  './js/products.js',
  './js/debts.js',
  './js/purchases.js',
  './js/sales.js',
  './js/expenses.js',
  './js/damages.js',
  './js/reports.js',
  './js/users.js',
  './js/profile.js',
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-512-maskable.png',
  './assets/icons.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API/backend calls - always go live to the network.
  if (url.pathname.includes('/Backend/')) {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  // Leave cross-origin requests (e.g. the CDN Excel-import library) to the
  // browser's normal handling - we only manage this app's own files.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Network-first: always try to fetch the newest version.
  // Fall back to the cached copy only if the network request fails
  // (e.g. no internet connection), so the app still opens offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
