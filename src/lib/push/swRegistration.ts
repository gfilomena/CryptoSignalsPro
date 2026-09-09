import { registerSW } from 'virtual:pwa-register'

let applyUpdateFn: (() => Promise<void>) | null = null

/** Registers the service worker and wires the "new version available" prompt. */
export function initServiceWorker(onNeedRefresh: () => void): void {
  if (!('serviceWorker' in navigator)) {
    console.warn('[sw-debug] navigator.serviceWorker unsupported in this browser')
    return
  }
  applyUpdateFn = registerSW({
    immediate: true,
    onNeedRefresh,
    onOfflineReady() {
      /* app shell cached for fast/offline-capable startup — nothing for the UI to do */
    },
    onRegisterError(error) {
      console.error('[sw-debug] service worker registration FAILED:', error)
    },
    onRegisteredSW(url, registration) {
      console.log('[sw-debug] service worker registered:', url, registration)
      navigator.serviceWorker.getRegistrations().then((regs) => {
        console.log('[sw-debug] getRegistrations() right after onRegisteredSW ->', regs.length)
      })
    },
  })
}

/** Activates the waiting service worker and reloads the page onto the new version. */
export function applyServiceWorkerUpdate(): void {
  void applyUpdateFn?.()
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}
