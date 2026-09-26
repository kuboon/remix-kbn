/**
 * The whole chat, in one process.
 *
 * The session talks to a `@remix-run/fetch-router` router that has the controller mapped on it,
 * with `agent/dummy` behind that — no network, no key, no server. Which is not a test rig standing
 * in for the real thing: it is the same arrangement a static host runs, where the router lives in
 * the browser and the client's transport points at it.
 */

import * as assert from '@remix-run/assert'
import { createRouter } from '@remix-run/fetch-router'
import { describe, it } from '@std/testing/bdd'

import type { AgentTool } from './agent.ts'
import { helperAgentController } from './controller.ts'
import { dummyAgent } from './dummy-agent.ts'
import type { DummyScript } from './dummy-agent.ts'
import { HelperAgentSession, unansweredCalls } from './session.ts'
import type { ClientTool } from './session.ts'

const ENDPOINT = 'http://localhost/helper-agent'

/** A session wired to a router in this same process. */
function sessionOver(
  script: DummyScript,
  { tools = [], agentTools = [] }: {
    tools?: readonly ClientTool[]
    agentTools?: readonly AgentTool[]
  } = {},
): HelperAgentSession {
  let router = createRouter()
  router.post(
    '/helper-agent',
    helperAgentController(dummyAgent({ script, tools: agentTools, wordDelay: 0 })),
  )

  return new HelperAgentSession({
    tools,
    transport: { url: ENDPOINT, fetch: (request) => router.fetch(request) },
  })
}

let whereAmI: ClientTool = {
  name: 'where_am_i',
  description: 'The page the person is looking at',
  inputSchema: { type: 'object', properties: {} },
  run: () => '/settings',
}

describe('HelperAgentSession', () => {
  it('holds the conversation and fires change as it arrives', async () => {
    let session = sessionOver(() => ({ text: 'Two words.' }))
    let changes = 0
    session.addEventListener('change', () => changes++)

    await session.send('hello')

    assert.deepEqual(session.messages, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Two words.' },
    ])
    assert.equal(session.status, 'idle')
    assert.equal(session.error, null)
    // One per word at least, which is what makes the panel fill in rather than appear.
    assert.ok(changes > 2)
  })

  it('runs this page tools and answers the same turn with their results', async () => {
    let session = sessionOver(
      (input) =>
        input.messages.at(-1)?.role === 'tool'
          ? { text: 'You are on the settings screen.' }
          : { toolCalls: [{ name: 'where_am_i' }] },
      { tools: [whereAmI] },
    )

    await session.send('what page am I on?')

    assert.deepEqual(session.messages, [
      { role: 'user', content: 'what page am I on?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'dummy-0', name: 'where_am_i', input: {} }],
      },
      { role: 'tool', results: [{ id: 'dummy-0', content: '/settings' }] },
      { role: 'assistant', content: 'You are on the settings screen.' },
    ])
    assert.equal(session.status, 'idle')
  })

  it('keeps the controller side and this page side of one turn in order', async () => {
    let lookup: AgentTool = {
      name: 'lookup',
      description: 'Looks something up',
      inputSchema: { type: 'object' },
      run: () => 'the docs say yes',
    }

    let session = sessionOver(
      (input) => {
        let last = input.messages.at(-1)
        if (last?.role !== 'tool') return { toolCalls: [{ name: 'lookup' }] }
        // Answered the controller's own tool; now ask the browser for its half.
        let ran = last.results.some((result) => result.id === 'dummy-0')
        return ran ? { text: 'Checking.', toolCalls: [{ name: 'where_am_i' }] } : { text: 'Done.' }
      },
      { tools: [whereAmI], agentTools: [lookup] },
    )

    await session.send('help')

    assert.deepEqual(session.messages.map((message) => message.role), [
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ])
    assert.deepEqual(session.messages[3], {
      role: 'assistant',
      content: 'Checking.',
      toolCalls: [{ id: 'dummy-1', name: 'where_am_i', input: {} }],
    })
    assert.deepEqual(session.messages[4], {
      role: 'tool',
      results: [{ id: 'dummy-1', content: '/settings' }],
    })
  })

  it('reports a tool this page does not have rather than stalling', async () => {
    let session = sessionOver(
      (input) =>
        input.messages.at(-1)?.role === 'tool' ? { text: 'Oh.' } : {
          toolCalls: [{ name: 'fly' }],
        },
      { tools: [whereAmI] },
    )

    await session.send('fly me somewhere')

    let results = session.messages.find((message) => message.role === 'tool')
    assert.deepEqual(results, {
      role: 'tool',
      results: [{ id: 'dummy-0', content: 'This page has no fly tool', isError: true }],
    })
  })

  it('keeps the agent state alongside the message it belongs to', async () => {
    let router = createRouter()
    router.post(
      '/helper-agent',
      helperAgentController({
        async *respond() {
          yield { type: 'text', text: 'hi' }
          yield { type: 'state', state: '[{"type":"text","text":"hi"}]' }
          yield { type: 'done', reason: 'end' }
        },
      }),
    )

    let session = new HelperAgentSession({
      transport: { url: ENDPOINT, fetch: (request) => router.fetch(request) },
    })
    await session.send('hello')

    assert.deepEqual(session.messages.at(-1), {
      role: 'assistant',
      content: 'hi',
      state: '[{"type":"text","text":"hi"}]',
    })
  })

  it('reports a failure without losing what had already arrived', async () => {
    let router = createRouter()
    router.post(
      '/helper-agent',
      helperAgentController({
        async *respond() {
          yield { type: 'text', text: 'as far as ' }
          yield { type: 'error', message: 'the model is down' }
        },
      }),
    )

    let session = new HelperAgentSession({
      transport: { url: ENDPOINT, fetch: (request) => router.fetch(request) },
    })
    await session.send('hello')

    assert.equal(session.status, 'error')
    assert.equal(session.error, 'the model is down')
    assert.deepEqual(session.messages.at(-1), { role: 'assistant', content: 'as far as ' })
  })

  it('reports a controller that refuses the turn', async () => {
    let router = createRouter()
    router.post('/helper-agent', () => new Response('Sign in first', { status: 401 }))

    let session = new HelperAgentSession({
      transport: { url: ENDPOINT, fetch: (request) => router.fetch(request) },
    })
    await session.send('hello')

    assert.equal(session.status, 'error')
    assert.match(session.error ?? '', /401/)
  })

  it('stops bouncing between the model and the page', async () => {
    let session = sessionOver(() => ({ toolCalls: [{ name: 'where_am_i' }] }), {
      tools: [whereAmI],
    })
    await session.send('loop')

    assert.equal(session.status, 'error')
    assert.match(session.error ?? '', /over/)
  })

  it('empties on reset', async () => {
    let session = sessionOver(() => ({ text: 'hi' }))
    await session.send('hello')
    session.reset()

    assert.deepEqual(session.messages, [])
    assert.equal(session.status, 'idle')
  })
})

describe('unansweredCalls', () => {
  it('finds the calls behind the results that were answered', () => {
    let pending = unansweredCalls([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'a', name: 'mine', input: {} }, { id: 'b', name: 'yours', input: {} }],
      },
      { role: 'tool', results: [{ id: 'a', content: 'done' }] },
    ])

    assert.deepEqual(pending, [{ id: 'b', name: 'yours', input: {} }])
  })
})
