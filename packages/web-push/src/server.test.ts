import { assert, assertEquals, assertMatch } from '@std/assert'

import {
  applicationServerKey,
  type CounterStore,
  createPushSender,
  exportVapidKeys,
  generateVapidKeys,
  importVapidKeys,
  mapWithConcurrency,
  PushRateLimiter,
} from './server.ts'
import type { PushSubscriptionData } from './mod.ts'

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  new Uint8Array(bytes).toBase64({ alphabet: 'base64url', omitPadding: true })

/** What a browser would hand the server: a fresh ECDH key and auth secret. */
async function browserSubscription(endpoint: string): Promise<PushSubscriptionData> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  return {
    endpoint,
    keys: {
      p256dh: b64url(await crypto.subtle.exportKey('raw', keys.publicKey)),
      auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
    },
  }
}

interface Seen {
  headers: Headers
  body: Uint8Array
}

/**
 * A push service on localhost that answers each request with the next response in `answers`, and
 * records what it was sent.
 */
async function withPushService(
  answers: (() => Response)[],
  test: (endpoint: string, seen: Seen[]) => Promise<void>,
) {
  const seen: Seen[] = []
  const server = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen() {} }, async (req) => {
    seen.push({ headers: req.headers, body: new Uint8Array(await req.arrayBuffer()) })
    return (answers.shift() ?? (() => new Response(null, { status: 201 })))()
  })
  try {
    await test(`http://127.0.0.1:${server.addr.port}/push/abc`, seen)
  } finally {
    await server.shutdown()
  }
}

const sender = async () =>
  createPushSender({ vapidKeys: await generateVapidKeys(), contact: 'mailto:ops@example.com' })

Deno.test('send delivers an encrypted, VAPID-signed message with the given options', async () => {
  const push = await sender()
  await withPushService([], async (endpoint, seen) => {
    const result = await push.send(await browserSubscription(endpoint), {
      title: 'hello',
      url: '/inbox',
    }, { urgency: 'high', ttl: 60, topic: 'inbox' })
    assertEquals(result, { ok: true, topicDropped: false })

    const { headers, body } = seen[0]
    assertEquals(headers.get('content-encoding'), 'aes128gcm')
    assertEquals(headers.get('ttl'), '60')
    assertEquals(headers.get('urgency'), 'high')
    assertEquals(headers.get('topic'), 'inbox')
    assertMatch(headers.get('authorization') ?? '', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/)
    assert(headers.get('authorization')!.endsWith(`k=${push.applicationServerKey}`))
    // Encrypted: the title is not in the body in the clear.
    assert(!new TextDecoder().decode(body).includes('hello'))
  })
})

Deno.test('404 and 410 mean the subscription is gone', async () => {
  const push = await sender()
  for (const status of [404, 410]) {
    await withPushService([() => new Response('gone', { status })], async (endpoint) => {
      const result = await push.send(await browserSubscription(endpoint), { title: 't' })
      assert(!result.ok)
      assertEquals(result.gone, 'expired')
      assertEquals(result.error.status, status)
    })
  }
})

Deno.test('a VAPID key mismatch means the browser must subscribe again', async () => {
  const push = await sender()
  await withPushService([
    () => Response.json({ reason: 'VapidPkHashMismatch', message: 'key changed' }, { status: 400 }),
  ], async (endpoint) => {
    const result = await push.send(await browserSubscription(endpoint), { title: 't' })
    assert(!result.ok)
    assertEquals(result.gone, 'vapid-key-mismatch')
    assertEquals(result.error.reason, 'VapidPkHashMismatch')
    assertEquals(result.error.detail, 'key changed')
  })
})

Deno.test('a rejected Topic header is dropped and the send retried', async () => {
  const push = await sender()
  await withPushService([
    () => Response.json({ reason: 'BadWebPushTopic' }, { status: 400 }),
  ], async (endpoint, seen) => {
    const result = await push.send(await browserSubscription(endpoint), { title: 't' }, {
      topic: 'bad topic!',
    })
    assertEquals(result, { ok: true, topicDropped: true })
    assertEquals(seen.map((s) => s.headers.get('topic')), ['bad topic!', null])
  })
})

Deno.test('other refusals are reported, not thrown, and keep the subscription', async () => {
  const push = await sender()
  await withPushService([() => new Response('slow down', { status: 429 })], async (endpoint) => {
    const result = await push.send(await browserSubscription(endpoint), 'raw text')
    assert(!result.ok)
    assertEquals(result.gone, undefined)
    assertEquals(result.error.status, 429)
    assertMatch(result.error.message, /429.*slow down/)
  })
})

Deno.test('VAPID keys survive export and import, and give the same application server key', async () => {
  const keys = await generateVapidKeys()
  const restored = await importVapidKeys(JSON.parse(JSON.stringify(await exportVapidKeys(keys))))
  const key = await applicationServerKey(keys)
  assertEquals(await applicationServerKey(restored), key)
  // An uncompressed P-256 point: 65 bytes.
  assertEquals(Uint8Array.fromBase64(key, { alphabet: 'base64url' }).length, 65)
})

/** A {@link CounterStore} in memory, with optional forced write conflicts. */
function memoryCounters(conflicts = 0): CounterStore & { values: Map<string, number> } {
  const values = new Map<string, number>()
  return {
    values,
    entry: (key) => ({
      update(fn) {
        const next = fn(values.get(key))
        if (conflicts > 0) {
          conflicts--
          return Promise.resolve({ ok: false })
        }
        values.set(key, next)
        return Promise.resolve({ ok: true })
      },
    }),
  }
}

Deno.test('the rate limiter allows `limit` sends per window, per subscription', async () => {
  let now = 0
  const limiter = new PushRateLimiter(memoryCounters(), 2, 1000, () => now)
  assertEquals(
    [
      await limiter.tryAcquire('a'),
      await limiter.tryAcquire('a'),
      await limiter.tryAcquire('a'),
      await limiter.tryAcquire('b'),
    ],
    [true, true, false, true],
  )
  now = 1000
  assertEquals(await limiter.tryAcquire('a'), true)
})

Deno.test('the rate limiter retries on write conflicts and fails open after three', async () => {
  assertEquals(await new PushRateLimiter(memoryCounters(2)).tryAcquire('a'), true)
  const store = memoryCounters(3)
  assertEquals(await new PushRateLimiter(store).tryAcquire('a'), true)
  assertEquals(store.values.size, 0)
  assertEquals(await new PushRateLimiter(memoryCounters(), 0).tryAcquire('a'), true)
})

Deno.test('mapWithConcurrency keeps order, settles failures, and bounds concurrency', async () => {
  let running = 0
  let peak = 0
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
    running++
    peak = Math.max(peak, running)
    await new Promise((r) => setTimeout(r, 5))
    running--
    if (n === 3) throw new Error('three')
    return n * 10
  })
  assertEquals(peak, 2)
  assertEquals(results.map((r) => r.status === 'fulfilled' ? r.value : String(r.reason)), [
    10,
    20,
    'Error: three',
    40,
    50,
  ])
  assertEquals(await mapWithConcurrency([], 3, () => Promise.resolve(1)), [])
})
