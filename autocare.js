/* ============================================================
   AutoCare — Service Worker
   Fail ini WAJIB berada di root folder (sama dengan index.html)
   ============================================================ */

const CACHE_VERSION = 'autocare-v1.0.1';
const STATIC_CACHE  = CACHE_VERSION + '-static';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

/* Fail Firebase gstatic — perlu mode CORS */
const PRECACHE_CORS = [
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js'
];

/* Google Fonts — no-cors (respons opaque OK untuk CSS) */
const PRECACHE_NOCORS = [
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap'
];

/* ============================================================
   INSTALL — precache semua aset penting
   ============================================================ */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      var jobs = [];

      // Halaman utama (same-origin)
      jobs.push(
        cache.add(new Request('./', { credentials: 'same-origin' }))
             .catch(function () { /* offline first run — abaikan */ })
      );

      // Firebase SDK (CORS)
      PRECACHE_CORS.forEach(function (url) {
        jobs.push(
          cache.add(new Request(url, { mode: 'cors', credentials: 'omit' }))
               .catch(function () {})
        );
      });

      // Google Fonts (no-cors)
      PRECACHE_NOCORS.forEach(function (url) {
        jobs.push(
          cache.add(new Request(url, { mode: 'no-cors', credentials: 'omit' }))
               .catch(function () {})
        );
      });

      return Promise.allSettled(jobs);
    }).then(function () { return self.skipWaiting(); })
  );
});

/* ============================================================
   ACTIVATE — buang cache lama, ambil kawalan serta-merta
   ============================================================ */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) {
            return k !== STATIC_CACHE && k !== RUNTIME_CACHE;
          }).map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
      .then(function () {
        return self.clients.matchAll({ type: 'window' }).then(function (clients) {
          clients.forEach(function (client) {
            client.postMessage({ type: 'SW_ACTIVATED', version: '1.0.1' });
          });
        });
      })
  );
});

/* ============================================================
   FETCH — strategi cache
   - HTML: network-first (elak stale)
   - Aset: cache-first + refresh di belakang
   - Firebase RTDB/Auth: JANGAN cache (live data)
   ============================================================ */
self.addEventListener('fetch', function (event) {
  var req = event.request;

  // Hanya GET
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Skip protokol bukan HTTP
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Skip endpoint realtime Firebase (kekalkan live)
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firebasedatabase.app') ||
      url.hostname.includes('identitytoolkit') ||
      url.hostname.includes('securetoken')) {
    return;
  }

  var isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  /* ---------- HTML: Network-first ---------- */
  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var clone = res.clone();
          caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, clone); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) {
            return cached || caches.match('./');
          });
        })
    );
    return;
  }

  /* ---------- Aset: Cache-first + background refresh ---------- */
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) {
        // Refresh cache di belakang (stale-while-revalidate)
        fetch(req)
          .then(function (res) {
            if (res && res.status === 200) {
              caches.open(RUNTIME_CACHE).then(function (c) {
                c.put(req, res.clone());
              });
            }
          })
          .catch(function () {});
        return cached;
      }

      // Tiada dalam cache → fetch dari network
      return fetch(req)
        .then(function (res) {
          if (res && res.status === 200 &&
              (res.type === 'basic' || res.type === 'cors')) {
            var clone = res.clone();
            caches.open(RUNTIME_CACHE).then(function (c) {
              c.put(req, clone);
            });
          }
          return res;
        })
        .catch(function () {
          // Offline fallback untuk aset tak kritikal
          return new Response('Offline — resource unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/plain' })
          });
        });
    })
  );
});

/* ============================================================
   MESSAGE — handle arahan dari app
   ============================================================ */
self.addEventListener('message', function (event) {
  var data = event.data || {};

  // Aktifkan SW baru tanpa tunggu tab lama tutup
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // Kosongkan semua cache
  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys()
        .then(function (keys) {
          return Promise.all(keys.map(function (k) { return caches.delete(k); }));
        })
        .then(function () {
          return self.clients.matchAll().then(function (clients) {
            clients.forEach(function (client) {
              client.postMessage({ type: 'CACHE_CLEARED' });
            });
          });
        })
    );
  }
});