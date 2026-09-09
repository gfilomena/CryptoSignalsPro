import { registerSW } from 'virtual:pwa-register'

let applyUpdateFn: (() => Promise<void>) | null = null

/** Registers the service worker and wires the "new version available" prompt. */
export function initServiceWorker(onNeedRefresh: () => void): void {
  if (!('serviceWorker' in navigator)) return
  applyUpdateFn = registerSW({
    immediate: true,
    onNeedRefresh,
    onOfflineReady() {
      /* app shell cached for fast/offline-capable startup — nothing for the UI to do */
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
