import * as assert from '@remix-run/assert'
import { createRouter } from '@remix-run/fetch-router'
import type { Router } from '@remix-run/fetch-router'
import { describe, it } from '@std/testing/bdd'

import { helperAgentController } from './controller.ts'
import type { HelperAgentControllerOptions } from './controller.ts'
import { dummyAgent, scriptedTurns } from './dummy-agent.ts'
import { decodeEvents } from './protocol.ts'
import type { AgentEvent, ChatRequest } from './protocol.ts'

const ENDPOINT = 'http://localhost/helper-agent'

function routerWith(options: HelperAgentControllerOptions = {}): Router {
  let agent = dummyAgent({
    wordDelay: 0,
    script: scriptedTurns([
      { match: 'page', turn: { toolCalls: [{ name: 'where_am_i' }] } },
    ], () => ({ text: 'Nothing to say.' })),
  })

  let router = createRouter()
  router.post('/helper-agent', helperAgentController(agent, options))
  return router
}

function post(router: Router, body: unknown): Promise<Response> {
  return router.fetch(
    new Request(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

async function eventsOf(response: Response): Promise<AgentEvent[]> {
  let events: AgentEvent[] = []
  for await (let event of decodeEvents(response.body!)) events.push(event)
  return events
}

let hello: ChatRequest = { messages: [{ role: 'user', content: 'hello' }] }

describe('helperAgentController', () => {
  it('streams the turn as server-sent events', async () => {
    let response = await post(routerWith(), hello)

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/)
    assert.equal(response.headers.get('cache-control'), 'no-store')

    let events = await eventsOf(response)
    assert.deepEqual(events.at(-1), { type: 'done', reason: 'end' })
    assert.equal(
      events.filter((event) => event.type === 'text').map((event) => event.text).join(''),
      'Nothing to say.',
    )
  })

  it('passes the browser tools through and reports the call it cannot run', async () => {
    let response = await post(routerWith(), {
      messages: [{ role: 'user', content: 'what page am I on?' }],
      tools: [{ name: 'where_am_i', description: 'The current page', inputSchema: {} }],
    })

    let events = await eventsOf(response)
    assert.equal(events.some((event) => event.type === 'tool-call'), true)
    assert.deepEqual(events.at(-1), { type: 'done', reason: 'tools' })
  })

  it('answers anything but POST with a 405', async () => {
    let response = await routerWith().fetch(new Request(ENDPOINT))

    assert.equal(response.status, 405)
  })

  it('rejects a body that is not a chat request', async () => {
    assert.equal((await post(routerWith(), 'not json')).status, 400)
    assert.equal((await post(routerWith(), { messages: 'no' })).status, 400)
    assert.equal((await post(routerWith(), { messages: [] })).status, 400)
    assert.equal((await post(routerWith(), { messages: [{ role: 'nobody' }] })).status, 400)
  })

  it('caps the conversation and the body', async () => {
    let long = { messages: Array.from({ length: 4 }, () => ({ role: 'user', content: 'hi' })) }
    assert.equal((await post(routerWith({ maxMessages: 3 }), long)).status, 413)
    assert.equal((await post(routerWith({ maxBytes: 8 }), hello)).status, 413)
  })

  it('lets beforeTurn answer instead of the agent', async () => {
    let router = routerWith({
      beforeTurn: () => new Response('Sign in first', { status: 401 }),
    })

    assert.equal((await post(router, hello)).status, 401)
  })

  it('lets beforeTurn rewrite the conversation', async () => {
    let router = routerWith({
      beforeTurn: (request) => ({
        ...request,
        messages: [{ role: 'user', content: 'what page am I on?' }],
      }),
    })

    let events = await eventsOf(await post(router, hello))
    assert.equal(events.some((event) => event.type === 'tool-call'), true)
  })

  it('turns an agent that throws into an error event, not a dead stream', async () => {
    let router = createRouter()
    router.post(
      '/helper-agent',
      helperAgentController({
        // deno-lint-ignore require-yield
        async *respond() {
          throw new Error('the model is down')
        },
      }),
    )

    let events = await eventsOf(await post(router, hello))
    assert.deepEqual(events, [{ type: 'error', message: 'the model is down' }])
  })

  it('ends a turn an agent left open', async () => {
    let router = createRouter()
    router.post(
      '/helper-agent',
      helperAgentController({
        async *respond() {
          yield { type: 'text', text: 'half an answer' }
        },
      }),
    )

    let events = await eventsOf(await post(router, hello))
    assert.deepEqual(events.at(-1), { type: 'done', reason: 'end' })
  })
})
