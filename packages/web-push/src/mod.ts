/**
 * What the server sends and the service worker shows — the part of Web Push both sides agree on.
 *
 * The server builds a {@link PushMessage} from a {@link PushNotification} with
 * {@link toPushMessage} and sends it as the encrypted JSON body (`./server`). The service worker
 * (`./sw`) reads the same shape back and shows it. Keeping the shape here means the two cannot drift
 * apart the way two hand-written copies do.
 *
 * Also here: {@link parsePushSubscription}, which checks a subscription a browser sent before a
 * server stores it.
 *
 * @module
 */

/** A notification, as an application describes it. */
export interface PushNotification {
  title: string
  body?: string
  /** Opened (or focused, if already open) when the notification is clicked. */
  url?: string
  icon?: string
  /** The small monochrome image shown in the status bar (Notifications API `badge`). */
  badge?: string
  /** The app icon's badge number (Badging API). `0` clears it; absent leaves it as it is. */
  badgeCount?: number
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string
  requireInteraction?: boolean
  /** Extra data for the service worker. `url` is added to it. */
  data?: Record<string, unknown>
}

/** The JSON body of a push message: a {@link PushNotification} plus when it was sent. */
export interface PushMessage extends PushNotification {
  data: Record<string, unknown>
  /** ISO 8601. */
  timestamp: string
}

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionData {
  endpoint: string
  expirationTime?: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

/** The message a service worker using `./sw` knows how to show. */
export function toPushMessage(
  notification: PushNotification,
  now: Date = new Date(),
): PushMessage {
  return {
    ...notification,
    requireInteraction: notification.requireInteraction ?? false,
    data: { ...notification.data, url: notification.url },
    timestamp: now.toISOString(),
  }
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/**
 * Checks a subscription a browser sent, before storing it.
 *
 * Only `https:` endpoints are accepted: a push endpoint is where the server will later send
 * requests, so an `http:` or internal one would let any client point the server at an address of
 * its choosing.
 *
 * @returns The subscription with only the known fields, or a reason it is refused
 */
export function parsePushSubscription(value: unknown): PushSubscriptionData | string {
  if (!value || typeof value !== 'object') return 'subscription must be an object'
  const v = value as Record<string, unknown>
  if (!isNonEmptyString(v.endpoint)) return 'endpoint must be a non-empty string'
  let endpoint: URL
  try {
    endpoint = new URL(v.endpoint)
  } catch {
    return 'endpoint must be a URL'
  }
  if (endpoint.protocol !== 'https:') return 'endpoint must be https'
  const keys = v.keys as Record<string, unknown> | undefined
  if (!keys || typeof keys !== 'object') return 'keys must be an object'
  if (!isNonEmptyString(keys.p256dh) || !isNonEmptyString(keys.auth)) {
    return 'keys.p256dh and keys.auth must be non-empty strings'
  }
  const expirationTime = v.expirationTime
  if (
    expirationTime !== undefined && expirationTime !== null && typeof expirationTime !== 'number'
  ) {
    return 'expirationTime must be a number or null'
  }
  return {
    endpoint: v.endpoint,
    ...(expirationTime !== undefined ? { expirationTime } : {}),
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  }
}
