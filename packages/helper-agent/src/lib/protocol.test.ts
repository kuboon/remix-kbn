import * as assert from '@remix-run/assert'
import { describe, it } from '@std/testing/bdd'

import { decodeEvents, encodeEvent } from './protocol.ts'
import type { AgentEvent } from './protocol.ts'

/** A body that hands out exactly the chunks given, to put frame boundaries where they hurt. */
function bodyOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  let encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (let chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(chunks: readonly string[]): Promise<AgentEvent[]> {
  let events: AgentEvent[] = []
  for await (let event of decodeEvents(bodyOf(chunks))) events.push(event)
  return events
}

describe('the event stream', () => {
  let events: AgentEvent[] = [
    { type: 'text', text: 'Hello ' },
    { type: 'tool-call', call: { id: 'a', name: 'where_am_i', input: {} } },
    { type: 'tool-result', result: { id: 'a', content: '/settings' } },
    { type: 'state', state: '[]' },
    { type: 'done', reason: 'end' },
  ]

  it('round trips every event', async () => {
    assert.deepEqual(await collect(events.map(encodeEvent)), events)
  })

  it('reassembles frames split across chunks', async () => {
    let wire = events.map(encodeEvent).join('')
    let chunks = []
    for (let at = 0; at < wire.length; at += 7) chunks.push(wire.slice(at, at + 7))

    assert.deepEqual(await collect(chunks), events)
  })

  it('drops a trailing partial frame rather than half-parsing it', async () => {
    let wire = encodeEvent(events[0]) + 'data: {"type":"te'

    assert.deepEqual(await collect([wire]), [events[0]])
  })

  it('ignores comment and field lines a proxy may add', async () => {
    let wire = `: keep-alive\n\n${encodeEvent(events[0])}event: message\n${
      encodeEvent(events[4]).trimEnd()
    }\n\n`

    assert.deepEqual(await collect([wire]), [events[0], events[4]])
  })
})
