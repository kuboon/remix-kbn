import { assertEquals } from '@std/assert'

import { parsePushSubscription, toPushMessage } from './mod.ts'

Deno.test('toPushMessage copies url into data and stamps the time', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  assertEquals(toPushMessage({ title: 't', url: '/a', data: { id: 1 } }, now), {
    title: 't',
    url: '/a',
    requireInteraction: false,
    data: { id: 1, url: '/a' },
    timestamp: '2026-01-01T00:00:00.000Z',
  })
})

const valid = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  expirationTime: null,
  keys: { p256dh: 'BPk', auth: 'aGk' },
}

Deno.test('parsePushSubscription keeps only the known fields of a valid subscription', () => {
  assertEquals(parsePushSubscription({ ...valid, extra: 1, keys: { ...valid.keys, x: 2 } }), valid)
  const { expirationTime: _, ...noExpiry } = valid
  assertEquals(parsePushSubscription(noExpiry), noExpiry)
})

Deno.test('parsePushSubscription refuses what a server should not store', () => {
  const cases: [unknown, string][] = [
    [null, 'object'],
    [{ ...valid, endpoint: '' }, 'endpoint'],
    [{ ...valid, endpoint: 'not a url' }, 'URL'],
    [{ ...valid, endpoint: 'http://169.254.169.254/latest' }, 'https'],
    [{ ...valid, keys: undefined }, 'keys'],
    [{ ...valid, keys: { p256dh: 'x' } }, 'auth'],
    [{ ...valid, expirationTime: 'soon' }, 'expirationTime'],
  ]
  for (const [value, fragment] of cases) {
    const result = parsePushSubscription(value)
    assertEquals(typeof result, 'string', JSON.stringify(value))
    assertEquals((result as string).includes(fragment), true, `${result} / ${fragment}`)
  }
})
