import { edgeFetch, hasSupabaseConfig } from '../../config/supabaseClient'
import { VAPID_PUBLIC_KEY, hasPushConfig } from '../../config/env'
import type { AlertType } from '../../types/scalpSignal'

export const ALL_ALERT_TYPES: AlertType[] = [
  'SETUP_DETECTED',
  'ENTRY_CONFIRMED',
  'STOP_HIT',
  'TP1_HIT',
  'TP2_HIT',
  'SETUP_INVALIDATED',
]

export interface PushStatus {
  /** Push API + Service Worker available in this browser at all. */
  supported: boolean
  /** iOS requires the PWA to be installed to the Home Screen before Notification permission can even be requested. */
  isIos: boolean
  isStandalone: boolean
  iosNeedsInstall: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  /** Supabase + VAPID public key both configured — required for push to work end to end. */
  backendConfigured: boolean
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const array = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let i = 0; i < rawData.length; i++) array[i] = rawData.charCodeAt(i)
  return array
}

export async function getPushStatus(): Promise<PushStatus> {
  const supported = isPushSupported()
  const ios = isIos()
  const standalone = isStandalone()
  let subscribed = false
  if (supported) {
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      subscribed = !!sub
    } catch {
      subscribed = false
    }
  }
  return {
    supported,
    isIos: ios,
    isStandalone: standalone,
    iosNeedsInstall: ios && !standalone,
    permission: supported ? Notification.permission : 'unsupported',
    subscribed,
    backendConfigured: hasPushConfig,
  }
}

/** Requests permission, subscribes to Web Push and registers the subscription server-side. */
export async function enableNotifications(alertTypes: AlertType[] = ALL_ALERT_TYPES): Promise<void> {
  if (!isPushSupported()) throw new Error('push_unsupported')
  if (!hasSupabaseConfig || !VAPID_PUBLIC_KEY) throw new Error('push_backend_not_configured')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission_denied')

  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }))

  const res = await edgeFetch('/push-subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'subscribe', subscription: subscription.toJSON(), alertTypes }),
  })
  if (!res.ok) throw new Error('subscribe_failed')
}

export async function disableNotifications(): Promise<void> {
  if (!isPushSupported()) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  if (hasSupabaseConfig) {
    try {
      await edgeFetch('/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unsubscribe', endpoint }),
      })
    } catch {
      /* subscription already removed locally; server row can be cleaned up lazily */
    }
  }
}

export async function updateAlertPreferences(alertTypes: AlertType[]): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription || !hasSupabaseConfig) return
  await edgeFetch('/push-subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_preferences', endpoint: subscription.endpoint, alertTypes }),
  })
}

export async function sendTestNotification(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) throw new Error('not_subscribed')
  const res = await edgeFetch('/push-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  })
  if (!res.ok) throw new Error('test_failed')
}
