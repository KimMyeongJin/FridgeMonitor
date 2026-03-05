const CACHE_VERSION = 'v3.0.1'; // MEDIUM #14: increment on deploy
const CACHE_NAME = `fridge-monitor-v${CACHE_VERSION}`;
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
  // Firebase/Firestore API 요청은 캐시하지 않음
  if (e.request.url.includes('googleapis.com') || e.request.url.includes('gstatic.com')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
