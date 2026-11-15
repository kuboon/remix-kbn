/**
 * Sending Web Push messages from a server, and the bookkeeping every sender ends up writing.
 *
 * Encryption (RFC 8291) and VAPID (RFC 8292) are `@negrel/webpush`'s; this module wraps it with what
 * an application needs around a send:
 *
 * - {@link createPushSender} sends one message and reports what happened in a form an app can act
 *   on — whether the subscription is gone and should be deleted, why the push service refused, and
 *   whether the `Topic` header had to be dropped. It never throws for a push service's answer.
 * - {@link generateVapidKeys} / {@link importVapidKeys} / {@link exportVapidKeys} /
 *   {@link applicationServerKey} for the VAPID key pair and the public key browsers subscribe with.
 * - {@link PushRateLimiter} caps how often one subscription is notified.
 * - {@link mapWithConcurrency} fans a message out to many subscriptions without opening every
 *   connection at once.
 *
 * Storage is the app's: every function here takes a subscription and returns a result, and
 * deciding where subscriptions live, and deleting one when told it is gone, stays with the caller.
 *
 * Runs on Deno, Node, Bun and Cloudflare Workers (Web Crypto and `fetch` only).
 *
 * @module
 */

import {
  ApplicationServer,
  exportApplicationServerKey,
  exportVapidKeys as exportKeys,
  generateVapidKeys as generateKeys,
  importVapidKeys as importKeys,
  PushMessageError,
  Urgency,
} from '@negrel/webpush'

import { type PushNotification, type PushSubscriptionData, toPushMessage } from './mod.ts'

export type { PushMessage, PushNotification, PushSubscriptionData } from './mod.ts'

/** A VAPID key pair as JSON Web Keys, for storing as a secret. */
export interface VapidKeysJwk {
  publicKey: JsonWebKey
  privateKey: JsonWebKey
}

/** How urgently the push service should deliver (RFC 8030 §5.3). */
export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high'

export interface SendOptions {
  /** Defaults to `normal`. */
  urgency?: PushUrgency
  /** Seconds the push service keeps an undelivered message. Defaults to 4 weeks. */
  ttl?: number
  /**
   * Replaces an undelivered message with the same topic (RFC 8030 §5.4). Some push services reject
   * the header (`BadWebPushTopic`); the send is then retried without it and the result says so.
   */
  topic?: string
}

/** What a push service said when it refused a message. */
export interface PushServiceError {
  status: number
  statusText: string
  /** The service's machine-readable reason, e.g. `VapidPkHashMismatch`, when it gives one. */
  reason?: string
  /** Its human-readable explanation, when it gives one. */
  detail?: string
  /** One line combining the above. */
  message: string
}

/**
 * Why a subscription can no longer be used:
 *
 * - `expired`: the push service no longer knows it (404 / 410). The browser unsubscribed, or it
 *   expired.
 * - `vapid-key-mismatch`: it was created with a different VAPID key than the one sending now. The
 *   browser has to subscribe again with the current key.
 */
export type GoneReason = 'expired' | 'vapid-key-mismatch'

export type SendResult =
  | {
    ok: true
    /** The push service rejected the `Topic` header, so the message went without one. */
    topicDropped: boolean
  }
  | {
    ok: false
    /** Set when the subscription should be deleted: sending to it again cannot succeed. */
    gone?: GoneReason
    error: PushServiceError
    topicDropped: boolean
  }

export interface PushSender {
  /** The VAPID public key, base64url, for `pushManager.subscribe({ applicationServerKey })`. */
  readonly applicationServerKey: string
  /**
   * Sends one message. A {@link PushNotification} is sent as {@link toPushMessage} JSON (what
   * `./sw` shows); a string is sent as is.
   *
   * Resolves with the outcome for anything the push service answers, and rejects only when the
   * request could not be made at all (network failure, bad subscription keys).
   */
  send(
    subscription: PushSubscriptionData,
    message: PushNotification | string,
    options?: SendOptions,
  ): Promise<SendResult>
}

export interface PushSenderOptions {
  /** The VAPID key pair (ECDSA P-256). */
  vapidKeys: CryptoKeyPair
  /**
   * How a push service can reach the sender about its traffic: a `mailto:` or `https:` URL
   * (RFC 8292 §2.1).
   */
  contact: string
}

/** Generates a VAPID key pair (ECDSA P-256), extractable so it can be stored. */
export function generateVapidKeys(): Promise<CryptoKeyPair> {
  return generateKeys({ extractable: true })
}

/** Exports a VAPID key pair as JWKs, for storing as a secret. */
export function exportVapidKeys(keys: CryptoKeyPair): Promise<VapidKeysJwk> {
  return exportKeys(keys)
}

/** Imports a VAPID key pair stored with {@link exportVapidKeys}. */
export function importVapidKeys(keys: VapidKeysJwk): Promise<CryptoKeyPair> {
  return importKeys(keys)
}

/** The VAPID public key in the form browsers subscribe with (uncompressed point, base64url). */
export function applicationServerKey(keys: CryptoKeyPair): Promise<string> {
  return exportApplicationServerKey(keys)
}

const DEFAULT_TTL = 60 * 60 * 24 * 28

const URGENCY: Record<PushUrgency, Urgency> = {
  'very-low': Urgency.VeryLow,
  low: Urgency.Low,
  normal: Urgency.Normal,
  high: Urgency.High,
}

/** Reads a push service's refusal: Mozilla and Google answer JSON, Apple plain text. */
async function readPushServiceError(response: Response): Promise<PushServiceError> {
  const { status, statusText } = response
  let reason: string | undefined
  let detail: string | undefined

  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      const body = await response.clone().json()
      if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>
        if (typeof record.reason === 'string' && record.reason.trim()) {
          reason = record.reason.trim()
        }
        for (const key of ['message', 'detail', 'error', 'description']) {
          const value = record[key]
          if (typeof value === 'string' && value.trim()) {
            detail = value.trim()
            break
          }
        }
      }
    } catch {
      // Not JSON after all: read it as text below.
    }
  }
  if (!detail) {
    try {
      const text = (await response.clone().text()).trim()
      if (text && text !== reason) detail = text
    } catch {
      // No readable body.
    }
  }

  const head = `Push service responded with ${status} ${statusText}`.trim() +
    (reason ? ` (${reason})` : '')
  return { status, statusText, reason, detail, message: detail ? `${head}: ${detail}` : head }
}

/** Creates a sender for one VAPID key pair. */
export async function createPushSender(options: PushSenderOptions): Promise<PushSender> {
  const server = await ApplicationServer.new({
    contactInformation: options.contact,
    vapidKeys: options.vapidKeys,
  })
  const publicKey = await applicationServerKey(options.vapidKeys)

  return {
    applicationServerKey: publicKey,
    async send(subscription, message, sendOptions = {}) {
      const subscriber = server.subscribe({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      })
      const body = typeof message === 'string' ? message : JSON.stringify(toPushMessage(message))
      const urgency = URGENCY[sendOptions.urgency ?? 'normal']
      const ttl = sendOptions.ttl ?? DEFAULT_TTL

      let topic = sendOptions.topic
      let topicDropped = false
      while (true) {
        try {
          await subscriber.pushTextMessage(body, { urgency, ttl, topic })
          return { ok: true, topicDropped }
        } catch (error) {
          if (!(error instanceof PushMessageError)) throw error
          const info = await readPushServiceError(error.response)

          if (info.status === 404 || info.status === 410) {
            return { ok: false, gone: 'expired', error: info, topicDropped }
          }
          if (info.reason === 'VapidPkHashMismatch') {
            return { ok: false, gone: 'vapid-key-mismatch', error: info, topicDropped }
          }
          if (topic !== undefined && info.reason === 'BadWebPushTopic') {
            topic = undefined
            topicDropped = true
            continue
          }
          return { ok: false, error: info, topicDropped }
        }
      }
    },
  }
}

/**
 * The storage {@link PushRateLimiter} counts in: one atomic read-modify-write per key, with an
 * expiry. `@kuboon/kv`'s `KvRepo` has this shape.
 */
export interface CounterStore {
  entry(key: string): {
    update(
      fn: (current: number | null | undefined) => number,
      options?: { expireIn?: number },
    ): Promise<{ ok: boolean }>
  }
}

/**
 * At most `limit` notifications per subscription per `windowMs`, so a burst of sends cannot flood a
 * device. A fixed window, counted in a {@link CounterStore} under `${subscriptionId}:${window}`;
 * counters expire on their own.
 */
export class PushRateLimiter {
  constructor(
    private readonly store: CounterStore,
    private readonly limit: number = 1,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Counts a send against `subscriptionId`. `true` when it is allowed (and counted), `false` when
   * the window is full. A non-positive limit or window turns limiting off.
   */
  async tryAcquire(subscriptionId: string): Promise<boolean> {
    if (this.limit <= 0 || this.windowMs <= 0) return true

    const windowId = Math.floor(this.now() / this.windowMs)
    const entry = this.store.entry(`${subscriptionId}:${windowId}`)
    const expireIn = this.windowMs * 2

    // The update is a check-and-set; retry when a concurrent send wins the race.
    for (let attempt = 0; attempt < 3; attempt++) {
      let allowed = false
      const result = await entry.update((current) => {
        const count = current ?? 0
        if (count >= this.limit) return count
        allowed = true
        return count + 1
      }, { expireIn })
      if (result.ok) return allowed
    }
    // Persistent contention is rare: let the notification through rather than drop it silently.
    return true
  }
}

/**
 * Runs `fn` over `items` with at most `limit` in flight, keeping the results in input order.
 *
 * Push services rate-limit aggressive senders and runtimes cap concurrent connections, so a
 * fan-out should drain through a small pool rather than start every request at once.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}
