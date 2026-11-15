import { assert, assertEquals } from '@std/assert'

import { pushServiceWorkerScript } from './sw.ts'
import { toPushMessage } from './mod.ts'

/** Just enough of a service worker global scope to drive the handlers. */
function fakeScope(openWindows: { url: string; focused?: boolean }[] = []) {
  const listeners = new Map<string, (event: unknown) => void>()
  const shown: { title: string; options: Record<string, unknown> }[] = []
  const badges: (number | 'cleared')[] = []
  const opened: string[] = []
  const scope = {
    location: { href: 'https://app.example/sw.js' },
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => Promise.resolve(),
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options })
        return Promise.resolve()
      },
    },
    navigator: {
      setAppBadge: (n: number) => (badges.push(n), Promise.resolve()),
      clearAppBadge: () => (badges.push('cleared'), Promise.resolve()),
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () =>
        Promise.resolve(openWindows.map((w) => ({
          url: w.url,
          focus: () => {
            w.focused = true
            return Promise.resolve()
          },
        }))),
      openWindow: (url: string) => (opened.push(url), Promise.resolve()),
    },
  }
  /** Fires an event and waits for what the handler passed to `waitUntil`. */
  const fire = async (type: string, event: Record<string, unknown> = {}) => {
    let pending: Promise<unknown> = Promise.resolve()
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) })
    await pending
  }
  return { scope, listeners, shown, badges, opened, fire }
}

/** Runs the generated script the way a browser would, with `self` bound to the fake scope. */
function install(scope: unknown, defaultTitle = 'App') {
  new Function('self', pushServiceWorkerScript({ defaultTitle }))(scope)
}

const pushEvent = (payload: unknown) => ({
  data: {
    json: () => {
      if (typeof payload === 'string') throw new SyntaxError('not JSON')
      return payload
    },
    text: () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  },
})

Deno.test('the generated script registers the four handlers', () => {
  const { scope, listeners } = fakeScope()
  install(scope)
  assertEquals([...listeners.keys()].sort(), ['activate', 'install', 'notificationclick', 'push'])
})

Deno.test('a push shows the message the server built, and sets the badge', async () => {
  const { scope, shown, badges, fire } = fakeScope()
  install(scope)
  const message = toPushMessage({
    title: 'New request',
    body: 'GET api.github.com',
    url: '/kagi?tx=1',
    tag: 'kagi-1',
    badgeCount: 3,
    requireInteraction: true,
    data: { txId: '1' },
  })
  await fire('push', pushEvent(message))
  assertEquals(shown, [{
    title: 'New request',
    options: {
      body: 'GET api.github.com',
      icon: undefined,
      badge: undefined,
      tag: 'kagi-1',
      requireInteraction: true,
      data: { txId: '1', url: '/kagi?tx=1' },
    },
  }])
  assertEquals(badges, [3])
})

Deno.test('a plain-text or empty push still shows, under the default title', async () => {
  const { scope, shown, badges, fire } = fakeScope()
  install(scope, 'kagi')
  await fire('push', pushEvent('just text'))
  await fire('push', {})
  assertEquals(shown.map((s) => [s.title, s.options.body]), [['kagi', 'just text'], [
    'kagi',
    undefined,
  ]])
  assertEquals(badges, [])
})

Deno.test('badgeCount 0 clears the badge', async () => {
  const { scope, badges, fire } = fakeScope()
  install(scope)
  await fire('push', pushEvent({ title: 't', badgeCount: 0 }))
  assertEquals(badges, ['cleared'])
})

Deno.test('a click focuses a window already at the URL, resolving relative URLs', async () => {
  const windows: { url: string; focused?: boolean }[] = [
    { url: 'https://app.example/other' },
    { url: 'https://app.example/kagi?tx=1' },
  ]
  const { scope, opened, fire } = fakeScope(windows)
  install(scope)
  let closed = false
  await fire('notificationclick', {
    notification: { data: { url: '/kagi?tx=1' }, close: () => (closed = true) },
  })
  assert(closed)
  assertEquals(windows.map((w) => Boolean(w.focused)), [false, true])
  assertEquals(opened, [])
})

Deno.test('a click opens a window when none is at the URL, and does nothing without a URL', async () => {
  const { scope, opened, fire } = fakeScope()
  install(scope)
  await fire('notificationclick', { notification: { data: { url: '/x' }, close() {} } })
  await fire('notificationclick', { notification: { data: {}, close() {} } })
  assertEquals(opened, ['https://app.example/x'])
})
