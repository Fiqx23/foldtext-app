/* FoldText Lite offline app shell.
 * CSS and main application JavaScript are embedded in index.html;
 * caching index.html also caches the visual interface.
 */
const CACHE_PREFIX = 'foldtext-app-shell-';
const CACHE_NAME = CACHE_PREFIX + '2026-10-23-v6';
const APP_BASE_URL = new URL('./', self.registration.scope);
const INDEX_URL = new URL('index.html', APP_BASE_URL).href;
const MANIFEST_URL = new URL('manifest.json', APP_BASE_URL).href;
const STATIC_URLS = [
  APP_BASE_URL.href,
  INDEX_URL,
  MANIFEST_URL,
  new URL('icon.svg', APP_BASE_URL).href,
  new URL('icon-192.png', APP_BASE_URL).href,
  new URL('icon-512.png', APP_BASE_URL).href
];
const SUPABASE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Install succeeds only after the complete first-party app shell is cached.
    await cache.addAll(STATIC_URLS);

    // Do not fetch the cloud SDK during worker installation. It is cached
    // by the runtime fetch handler only if/when the app actually requests it.

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(name => {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) {
        return caches.delete(name);
      }
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

function isWithinAppScope(url) {
  return url.origin === APP_BASE_URL.origin &&
    url.pathname.startsWith(APP_BASE_URL.pathname);
}

function isSupabaseSdkRequest(request) {
  return request.method === 'GET' &&
    request.url.startsWith(SUPABASE_SDK_URL);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Cache the optional cross-origin Supabase SDK. Auth and cloud sync still
  // require connectivity; this only prevents the script itself being a blocker.
  if (isSupabaseSdkRequest(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  const url = new URL(request.url);
  if (!isWithinAppScope(url)) return;

  // App-shell navigation is cache-first. A warm install should not download the
  // full HTML document on every launch. Deployments bump CACHE_NAME, install the
  // new shell, and remove older app caches during activation.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse =
        await cache.match(request) ||
        await cache.match(APP_BASE_URL.href) ||
        await cache.match(INDEX_URL);

      if (cachedResponse) return cachedResponse;

      // Network is a fallback only when no cached shell exists.
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          await cache.put(request, response.clone());

          const indexPath = new URL(INDEX_URL).pathname;
          if (url.pathname === APP_BASE_URL.pathname || url.pathname === indexPath) {
            await cache.put(APP_BASE_URL.href, response.clone());
            await cache.put(INDEX_URL, response.clone());
          }
        }
        return response;
      } catch (error) {
        return new Response(
          'FoldText Lite belum memiliki cache offline. Buka aplikasi saat online satu kali, lalu coba lagi.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Cache first for app-shell resources; API/data requests are deliberately not cached.
  const isStaticResource =
    url.href === INDEX_URL ||
    url.href === MANIFEST_URL ||
    url.pathname.endsWith('/icon.svg') ||
    url.pathname.endsWith('/icon-192.png') ||
    url.pathname.endsWith('/icon-512.png');

  if (!isStaticResource) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      return new Response('', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
