const CACHE_PREFIX = `ai-360-vr-viewer-${encodeURIComponent(self.registration.scope)}-`;
const CACHE_NAME = `${CACHE_PREFIX}v10`;
const APP_SHELL = [
  "./", "./index.html", "./styles.css", "./placeholder.css", "./gyro.css",
  "./app.js", "./viewer-app.js", "./app-bootstrap.js", "./placeholder-state.js",
  "./storage.js", "./images.js", "./renderer.js", "./controls.js", "./math.js",
  "./manifest.webmanifest", "./icon.svg",
];
const APP_URLS = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL.map(path => new Request(new URL(path, self.registration.scope), { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME &&
      (key.startsWith(CACHE_PREFIX) || /^ai-360-vr-viewer-v\d+$/.test(key)))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (!url.href.startsWith(self.registration.scope)) return;
  const key = new URL(url);
  key.search = "";
  if (!APP_URLS.has(key.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // One versioned app shell: offline imports work, and installations cannot
    // mix modules from two deployments. Never cache panoramas or unrelated apps.
    return await cache.match(key.href) || fetch(event.request);
  })());
});
