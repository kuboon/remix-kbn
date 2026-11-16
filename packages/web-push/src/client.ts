/**
 * The browser half: ask for permission, register the service worker, and subscribe.
 *
 * ```ts
 * import { subscribePush } from '@remix-kbn/web-push/client'
 *
 * const subscription = await subscribePush({ applicationServerKey, serviceWorkerUrl: '/sw.js' })
 * await fetch('/api/push/subscription', { method: 'PUT', body: JSON.stringify(subscription) })
 * ```
 *
 * Sending the subscription to the server, and what the server keys it by, is the app's. Whether a
 * device can receive pushes at all — iOS delivers them only to a Home Screen web app, in-app
 * browsers not at all — is better asked of a library that knows those cases, such as
 * `@kuboon/browser-how-to`; {@link isPushSupported} only checks the APIs exist.
 *
 * @module
 */

import type { PushSubscriptionData } from './mod.ts'

export type { PushSubscriptionData } from './mod.ts'

export interface SubscribeOptions {
  /** The server's VAPID public key, base64url (`PushSender.applicationServerKey`). */
  applicationServerKey: string
  /** Where the service worker is served. Defaults to `/sw.js`. */
  serviceWorkerUrl?: string
  /** The registration scope. Defaults to the worker URL's directory. */
  scope?: string
}

/** Whether this browser has the Push, Service Worker and Notifications APIs. */
export function isPushSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
    typeof globalThis.PushManager !== 'undefined' &&
    typeof globalThis.Notification !== 'undefined'
}

/** The registration for `serviceWorkerUrl`, registering it if needed, once it is active. */
export async function pushRegistration(
  serviceWorkerUrl = '/sw.js',
  scope?: string,
): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(scope ?? serviceWorkerUrl)
  if (!existing) await navigator.serviceWorker.register(serviceWorkerUrl, scope ? { scope } : {})
  return navigator.serviceWorker.ready
}

/** This browser's current subscription, or `null`. */
export async function currentPushSubscription(
  serviceWorkerUrl = '/sw.js',
  scope?: string,
): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration(scope ?? serviceWorkerUrl)
  return (await registration?.pushManager.getSubscription()) ?? null
}

const decode = (base64url: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.fromBase64(base64url, { alphabet: 'base64url' }) as Uint8Array<ArrayBuffer>

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array): boolean => {
  if (!a || a.byteLength !== b.byteLength) return false
  const view = new Uint8Array(a)
  return view.every((byte, i) => byte === b[i])
}

/**
 * Asks for notification permission (if not yet decided), registers the service worker and
 * subscribes. Reuses an existing subscription made with the same key; replaces one made with a
 * different key, which the push service would refuse (`VapidPkHashMismatch`).
 *
 * Call it from a user gesture: browsers refuse a permission prompt that is not.
 *
 * @throws When the browser cannot push, or permission is not granted.
 */
export async function subscribePush(options: SubscribeOptions): Promise<PushSubscriptionData> {
  if (!isPushSupported()) throw new Error('This browser does not support Web Push.')
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission
  if (permission !== 'granted') throw new Error(`Notification permission is ${permission}.`)

  const registration = await pushRegistration(options.serviceWorkerUrl, options.scope)
  const key = decode(options.applicationServerKey)
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  })
  return subscription.toJSON() as PushSubscriptionData
}

/** Unsubscribes this browser, if subscribed. Resolves to whether there was a subscription. */
export async function unsubscribePush(
  serviceWorkerUrl = '/sw.js',
  scope?: string,
): Promise<boolean> {
  const subscription = await currentPushSubscription(serviceWorkerUrl, scope)
  return subscription ? await subscription.unsubscribe() : false
}

/** What kind of device this is, for naming a subscription in a list of devices. */
export type DeviceKind =
  | 'iphone'
  | 'ipad'
  | 'android-phone'
  | 'android-tablet'
  | 'windows'
  | 'mac'
  | 'linux'
  | 'other'

/** Guesses the {@link DeviceKind} from the user agent. */
export function detectDeviceKind(userAgent: string = navigator.userAgent): DeviceKind {
  const ua = userAgent.toLowerCase()
  if (ua.includes('iphone')) return 'iphone'
  if (ua.includes('ipad')) return 'ipad'
  if (ua.includes('android')) return ua.includes('mobile') ? 'android-phone' : 'android-tablet'
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('mac os')) return 'mac'
  if (ua.includes('linux')) return 'linux'
  return 'other'
}
