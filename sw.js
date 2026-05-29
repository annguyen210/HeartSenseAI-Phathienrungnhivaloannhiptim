// HEARTSENSE Service Worker v4.1 – network-first API, cache-first static (BUG#5)
const CACHE_NAME = "heartsense-v4";
const STATIC_ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest"];
const OFFLINE_FALLBACK = "./index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first, no caching
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: "Không có mạng. Vui lòng kết nối internet." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // Static assets: cache-first, fallback to network, then offline page
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.method === "GET") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(OFFLINE_FALLBACK));
    })
  );
});

// Background sync for offline measurements (#35)
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-measurements") {
    // Client-side IndexedDB sync is handled by app.js when online
    event.waitUntil(
      self.clients.matchAll().then((clients) =>
        clients.forEach((client) => client.postMessage({ type: "SYNC_OFFLINE" }))
      )
    );
  }
});
