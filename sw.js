/* ============================================================
   Urban Landscape Supplies — Service Worker
   Cache strategy:
   - Static assets (CSS/JS/fonts): cache-first (versioned filenames)
   - Images: cache-first with network fallback
   - HTML navigation: stale-while-revalidate (fresh content + fast load)
   - API routes: network-only
   ============================================================ */

const CACHE_NAME = 'uls-v5';

const PRECACHE = [
  '/',
  '/products',
  '/delivery-areas',
  '/css/tokens.css',
  '/css/base.css',
  '/css/components.css',
  '/css/layout.css',
  '/js/ui.js',
  '/js/products.js',
  '/js/cart.js',
  '/js/delivery.js',
  '/images/brand/mark-dark.png',
  '/images/brand/og-image.jpg',
  '/manifest.webmanifest',
];

// ── Install: pre-cache key assets ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete stale caches ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API and admin routes: always network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  // Static assets (CSS, JS): cache-first
  if (/\.(css|js)(\?.*)?$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Images: cache-first
  if (/\.(jpg|jpeg|png|webp|avif|svg|ico|gif)(\?.*)?$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Fonts: cache-first
  if (/\.(woff2?|ttf|eot)(\?.*)?$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML navigation: stale-while-revalidate
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || fetchPromise;
}
