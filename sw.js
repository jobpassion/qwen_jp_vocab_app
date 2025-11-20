const CACHE_NAME = "qwen-jp-vocab-v1";
const STATIC_PATHS = new Set([
  "/",
  "/index.html",
  "/css/styles.css",
  "/js/app.js",
  "/js/api.js",
  "/js/extract.js",
  "/js/storage.js",
  "/js/quiz.js",
  "/js/util.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
]);

const THIRD_PARTY_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.10.111/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.10.111/pdf.worker.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll([...STATIC_PATHS]);
      await Promise.all(
        THIRD_PARTY_ASSETS.map(async (asset) => {
          try {
            const response = await fetch(asset, { mode: "cors" });
            if (isCacheableResponse(response)) {
              await cache.put(asset, response.clone());
            }
          } catch (err) {
            console.warn("Skipping third-party asset during install", asset, err);
          }
        })
      );
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

function isCacheableResponse(response) {
  if (!response) return false;
  if (response.type === "opaque") return true;
  return response.status === 200;
}

function matchStaticAsset(request) {
  const url = new URL(request.url);
  if (url.origin === location.origin) {
    return STATIC_PATHS.has(url.pathname);
  }
  return THIRD_PARTY_ASSETS.includes(url.href);
}

async function cacheFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (fallbackPath) {
      const fallback = await cache.match(fallbackPath, { ignoreSearch: true });
      if (fallback) return fallback;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isNavigation = request.mode === "navigate";
  const isStatic = matchStaticAsset(request);

  if (!isNavigation && !isStatic) {
    // Let non-static requests (e.g., API) go to the network.
    return;
  }

  event.respondWith(cacheFirst(request, isNavigation ? "/index.html" : undefined));
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});
