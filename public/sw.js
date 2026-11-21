const CACHE_PREFIX = "closet-public-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const OFFLINE_PAGE = "/offline.html";
const PUBLIC_FILES = [
  OFFLINE_PAGE,
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon.svg",
  "/icon-maskable.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/closet-logo.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PUBLIC_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === "/" && !url.search) {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(OFFLINE_PAGE)) ?? Response.error();
    }));
    return;
  }
  if (PUBLIC_FILES.includes(url.pathname) && !url.search) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(request)) ?? fetch(request);
    })());
  }
});
