// Eithr service worker: opens the app without a connection, shows push
// notifications and opens the app on tap.
//
// Caching, kept safe from stale apps:
//   * pages: network first; the last copy (or /offline) only when offline
//   * /_next/static: cache first (file names change with every build)
//   * icons and the manifest: from cache, refreshed in the background
//   * everything else (API routes, Supabase, other sites): never cached

const CACHE = "docchi-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // One missing file mustn't stop the worker installing.
      await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// Each deploy brings new file names, so old ones are dropped once there are plenty.
const MAX_ENTRIES = 300;

const keep = async (request, response) => {
  if (response && response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
      if (!PRECACHE.includes(new URL(old.url).pathname)) await cache.delete(old);
    }
  }
  return response;
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/admin")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await keep(request, await fetch(request));
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(request, { ignoreSearch: true })) ||
            (await cache.match(OFFLINE_URL)) ||
            new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
          );
        }
      })(),
    );
    return;
  }

  // Page data for in-app navigation: always fresh; the app falls back to a full load when it fails.
  if (request.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => (await caches.match(request)) || keep(request, await fetch(request)))(),
    );
    return;
  }

  if (url.pathname.startsWith("/icons/") || /\.(png|svg|ico|webmanifest)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const fresh = fetch(request)
          .then((r) => keep(request, r))
          .catch(() => cached);
        return cached || fresh;
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Eithr", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Eithr";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        // navigate() only works on a window this worker controls (an app opened before it took
        // over can't be moved): then open the address in a new window, or the tap goes nowhere
        // and isn't counted.
        try {
          await open.focus();
          const moved = await open.navigate(url);
          if (moved) return moved;
        } catch {
          // fall through
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
