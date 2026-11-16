# web-push

Web Push for an app that sends its own notifications: send from the server, show from the service
worker, subscribe from the browser — three entry points that agree on one message format.

Encryption (RFC 8291) and VAPID (RFC 8292) are [`@negrel/webpush`](https://jsr.io/@negrel/webpush)'s.
This package is the layer every app writes on top of it: reading the push service's answer, knowing
when a subscription is dead, dropping a `Topic` header a service rejects, rate limiting, fan-out,
and a service worker that shows the result. Where subscriptions are stored stays yours.

Not Remix-specific: no framework, no storage, Web APIs only. Runs on Deno, Node, Bun and Cloudflare
Workers.

## Installation

```sh
deno add jsr:@remix-kbn/web-push
```

## Entry points

| Import                       | Runs in        | What                                                                       |
| ---------------------------- | -------------- | -------------------------------------------------------------------------- |
| `@remix-kbn/web-push`        | anywhere       | The message format (`toPushMessage`) and `parsePushSubscription`           |
| `@remix-kbn/web-push/server` | server         | `createPushSender`, VAPID keys, `PushRateLimiter`, `mapWithConcurrency`    |
| `@remix-kbn/web-push/sw`     | service worker | `installPushHandlers`, or `pushServiceWorkerScript` to serve with no build |
| `@remix-kbn/web-push/client` | browser        | `subscribePush`, `unsubscribePush`, `currentPushSubscription`              |

## Usage

### Keys

Generate a VAPID key pair once and keep it as a secret. Changing it invalidates every existing
subscription (`vapid-key-mismatch` below), so do not generate one per process.

```ts
import { exportVapidKeys, generateVapidKeys } from '@remix-kbn/web-push/server'

console.log(JSON.stringify(await exportVapidKeys(await generateVapidKeys())))
```

### Server

```ts
import {
  createPushSender,
  importVapidKeys,
  parsePushSubscription,
} from '@remix-kbn/web-push/server'

const push = await createPushSender({
  vapidKeys: await importVapidKeys(JSON.parse(env.VAPID_KEYS)),
  contact: 'mailto:ops@example.com',
})

// Give the browser the key to subscribe with.
push.applicationServerKey

// Store what the browser sends back.
const subscription = parsePushSubscription(await request.json())
if (typeof subscription === 'string') return new Response(subscription, { status: 400 })

// Send.
const result = await push.send(
  subscription,
  { title: 'New request', url: '/inbox', badgeCount: 1 },
  {
    urgency: 'high',
  },
)
if (!result.ok && result.gone) await deleteSubscription(subscription) // expired or VAPID key changed
```

`send` never throws for a push service's answer. It resolves with:

| Result                                             | Meaning                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `{ ok: true, topicDropped }`                       | Delivered to the push service. `topicDropped` if the `Topic` header was rejected and left out |
| `{ ok: false, gone: 'expired', error }`            | 404 / 410: the browser unsubscribed or the subscription expired. Delete it                    |
| `{ ok: false, gone: 'vapid-key-mismatch', error }` | Made with another VAPID key. Delete it; the browser must subscribe again                      |
| `{ ok: false, error }`                             | Anything else (rate limited, server error). Keep the subscription                             |

`error` has the push service's `status`, its `reason` and `detail` where it gives them, and a
one-line `message`.

`PushRateLimiter` caps notifications per subscription per window, counting in any store with an
atomic `entry(key).update(fn, { expireIn })` (such as `@kuboon/kv`'s `KvRepo`).
`mapWithConcurrency` sends to many subscriptions through a small pool.

### Service worker

Serve the ready-made worker, no bundler needed:

```ts
import { pushServiceWorkerScript } from '@remix-kbn/web-push/sw'

router.get('/sw.js', () =>
  new Response(pushServiceWorkerScript({ defaultTitle: 'My app' }), {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'service-worker-allowed': '/' },
  }))
```

or call `installPushHandlers(self, { defaultTitle })` from a worker you bundle yourself. Either
shows the notification, sets or clears the app badge from `badgeCount`, and on click focuses a
window already at `url` or opens one.

### Browser

```ts
import { subscribePush } from '@remix-kbn/web-push/client'

button.addEventListener('click', async () => {
  const subscription = await subscribePush({ applicationServerKey, serviceWorkerUrl: '/sw.js' })
  await fetch('/api/push', { method: 'PUT', body: JSON.stringify(subscription) })
})
```

`subscribePush` asks for permission if it has not been decided (call it from a click), registers
the worker, and reuses or replaces the existing subscription depending on whether it was made with
the same key. `isPushSupported` only checks that the APIs exist; iOS delivers pushes only to a Home
Screen web app, which a library such as `@kuboon/browser-how-to` can tell you.

## License

MIT
