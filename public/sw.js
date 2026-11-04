// Service worker shared by the public, staff and admin apps.
//
// Security rule: this worker only ever handles SAME-ORIGIN GET requests for the app shell and static files.
// Everything user-specific (Supabase auth, database, storage) is cross-origin, so it never passes through
// a cache here. Nothing a signed-in user sees is stored, so a second person on the same device cannot read it.
const VERSION = 'v1'
const SHELL = `yolo-shell-${VERSION}`
const STATIC = `yolo-static-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add('/index.html')).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const cacheable = (res) => res.ok && res.type === 'basic' && !/no-store/i.test(res.headers.get('Cache-Control') || '')

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // Page loads: network first so a new deploy shows up at once; offline falls back to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (cacheable(res)) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/index.html', copy)) }
          return res
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  // Hashed build files never change: cache first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (cacheable(res)) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)) }
        return res
      })),
    )
    return
  }

  // Photos, icons and manifests: show the cached copy, refresh it in the background.
  if (/^\/(images|icons)\//.test(url.pathname) || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(
      caches.open(STATIC).then((c) => c.match(req).then((hit) => {
        const refresh = fetch(req).then((res) => { if (cacheable(res)) c.put(req, res.clone()); return res }).catch(() => hit)
        return hit || refresh
      })),
    )
  }
  // anything else: not handled, goes straight to the network
})
