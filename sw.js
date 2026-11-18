/*
 * sw.js — the service worker. It lets the app install and work offline.
 *
 * Network first: when you're online, every file comes fresh from the site,
 * so each merged change shows up. A copy of each file is kept in the cache,
 * and the cache is used only when the network can't be reached.
 *
 * All paths are relative, because the site lives at
 * https://<username>.github.io/<repository>/, not at the root of a domain.
 */
var CACHE = 'age-capstruct-v1';

var FILES = [
  './',
  'index.html',
  'styles.css',
  'capstruct.js',
  'app.js',
  'manifest.webmanifest',
  'data/cdss.csv',
  'data/assumptions.csv',
  'data/banker_schedule.csv',
  'data/example_firms.csv',
  'data/ebit_scenarios.csv',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

// On install, save a copy of every file the app needs to run offline.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

// On activate, delete caches from older versions of this file.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Network first, cache as the offline fallback. Only this site's own files.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('index.html');
          return Response.error();
        });
      })
  );
});
