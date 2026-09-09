/// <reference lib="webworker" />
// Custom service worker (vite-plugin-pwa injectManifest strategy): precaches the app shell for
// fast/offline-capable startup and handles Web Push delivery + notification clicks. Market data
// (Binance, Supabase) is intentionally never cached here — every such request stays network-only
// so the dashboard never shows stale prices.

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

const PRECACHE_NAME = 'csp-precache-v1'
const PRECACHE_URLS = self.__WB_MANIFEST.map((entry) => entry.url)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PRECACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // never intercept cross-origin (Binance/Supabase) calls
  event.respondWith(caches.match(req).then((cached) => cached ?? fetch(req)))
})

interface PushPayload {
  title?: string
  body?: string
  type?: string
  symbol?: string
}

self.addEventListener('push', (event) => {
  let data: PushPayload
  try {
    data = event.data ? (event.data.json() as PushPayload) : {}
  } catch {
    data = { body: event.data?.text() }
  }

  const title = data.title || 'CryptoSignals Pro'
  const options: NotificationOptions = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.symbol ? `csp-${data.symbol}` : 'csp-alert',
    data: { url: '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow('/')
    }),
  )
})
