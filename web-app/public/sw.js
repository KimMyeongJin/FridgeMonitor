const CACHE_VERSION = 'v3.1.0';
const CACHE_NAME = `fridge-monitor-${CACHE_VERSION}`;
const ASSETS = [
  '/',
  '/index.html',
  '/docs.html',
  '/favicon.svg',
  '/manifest.json',
  '/css/theme.css',
  '/css/app.css',
  '/css/docs.css',
  '/js/app.js',
  '/js/firebase-init.js',
  '/js/theme.js',
  '/js/settings.js',
  '/js/devices.js',
  '/js/chart.js',
  '/js/cleanup.js',
  '/js/chat.js',
  '/js/i18n.js',
  '/js/shared-ui.js',
  '/locales/ko.json',
  '/locales/en.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// 캐시 우선 대상 (정적 자산)
const CACHE_FIRST_PATHS = ['/css/', '/js/', '/locales/', '/icons/', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Firebase/Firestore API 요청은 캐시하지 않음
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    return;
  }

  // 정적 자산: 캐시 우선, 없으면 네트워크
  if (CACHE_FIRST_PATHS.some(p => url.pathname.startsWith(p))) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        });
      })
    );
    return;
  }

  // HTML 페이지: 네트워크 우선, 실패 시 캐시, 캐시도 없으면 오프라인 폴백
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      })
      .catch(() => {
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          // 문서 요청인 경우 메인 페이지로 폴백
          if (e.request.destination === 'document') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});
