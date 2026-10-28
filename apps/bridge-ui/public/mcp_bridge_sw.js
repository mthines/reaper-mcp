// Service worker for the installable bridge status page (scope: /mcp_bridge*).
// Network-first for the app shell so updates land immediately; the cached copy lets the
// installed app open while REAPER is closed and show its "Can't reach REAPER" state.
// REAPER's /_/ command API is outside the scope and never touched.
const CACHE = 'mcp-bridge-v2';
const SHELL = ['/mcp_bridge.html', '/mcp_bridge.webmanifest', '/mcp_bridge_icon_192.png', '/mcp_bridge_icon_512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/mcp_bridge')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
        }
        return res;
      })
      .catch(() => caches.match(url.pathname).then((hit) => hit ?? Response.error())),
  );
});
