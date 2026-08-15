// Service Worker de AuditorIA. Scope limitado a /auditoria/* para no
// interferir con el dashboard ni la landing existentes.
// Estrategia mínima: precache del app shell + network-first con fallback a cache.

const CACHE = 'auditoria-shell-v1'
const SHELL = ['/auditoria', '/auditoria-manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Solo intervenimos navegaciones dentro de /auditoria.
  if (request.mode !== 'navigate' || !url.pathname.startsWith('/auditoria')) return

  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(request, copy))
        return res
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('/auditoria'))),
  )
})
