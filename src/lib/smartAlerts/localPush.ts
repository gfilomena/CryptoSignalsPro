// Best-effort local notification for the client-side evaluation fallback (used when Supabase/
// VAPID push isn't configured, or as an immediate confirmation while the tab is open). This is
// NOT the same delivery path as real Web Push (see src/lib/push/pushClient.ts + sw.ts's `push`
// listener) — it only works while this tab/service worker is alive, but it uses the same
// ServiceWorkerRegistration.showNotification() call so it looks identical to the user.
import type { PushPayload } from './notificationCopy'

export async function showLocalNotification(payload: PushPayload): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (!('serviceWorker' in navigator)) return
  try {
    const registration = await navigator.serviceWorker.ready
    await registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: `csp-smart-alert-${payload.symbol}`,
      data: { url: '/' },
    })
  } catch {
    /* best-effort only */
  }
}
