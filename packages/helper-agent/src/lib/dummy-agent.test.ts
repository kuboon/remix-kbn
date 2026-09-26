import * as assert from '@remix-run/assert'
import { describe, it } from '@std/testing/bdd'

import { dummyAgent, scriptedTurns } from './dummy-agent.ts'
import type { AgentTool } from './agent.ts'
import type { AgentEvent, ChatMessage } from './protocol.ts'

let ask = (text: string): ChatMessage[] => [{ role: 'user', content: text }]

async function run(
  agent: ReturnType<typeof dummyAgent>,
  messages: ChatMessage[],
  clientTools: { name: string; description: string; inputSchema: Record<string, unknown> }[] = [],
): Promise<AgentEvent[]> {
  let events: AgentEvent[] = []
  let signal = new AbortController().signal
  for await (let event of agent.respond({ messages, clientTools, signal })) events.push(event)
  return events
}

let text = (events: AgentEvent[]) =>
  events.filter((event) => event.type === 'text').map((event) => event.text).join('')

describe('dummyAgent', () => {
  it('streams a scripted reply a word at a time and ends the turn', async () => {
    let agent = dummyAgent({
      wordDelay: 0,
      script: scriptedTurns([{ match: /price/i, turn: { text: 'It is free.' } }]),
    })

    let events = await run(agent, ask('what is the price?'))

    assert.equal(text(events), 'It is free.')
    assert.ok(events.filter((event) => event.type === 'text').length > 1)
    assert.deepEqual(events.at(-1), { type: 'done', reason: 'end' })
  })

  it('runs its own tools inside the turn and asks the script again', async () => {
    let lookup: AgentTool = {
      name: 'lookup',
      description: 'Looks something up',
      inputSchema: { type: 'object', properties: {} },
      run: () => 'forty-two',
    }

    let agent = dummyAgent({
      wordDelay: 0,
      tools: [lookup],
      script: scriptedTurns(
        [{ match: 'answer', turn: { toolCalls: [{ name: 'lookup' }] } }],
        (input) =>
          input.messages.at(-1)?.role === 'tool' ? { text: 'It is forty-two.' } : { text: 'Hm.' },
      ),
    })

    let events = await run(agent, ask('what is the answer?'))

    assert.deepEqual(events[0], {
      type: 'tool-call',
      call: { id: 'dummy-0', name: 'lookup', input: {} },
    })
    assert.deepEqual(events[1], {
      type: 'tool-result',
      result: { id: 'dummy-0', content: 'forty-two' },
    })
    assert.equal(text(events), 'It is forty-two.')
    assert.deepEqual(events.at(-1), { type: 'done', reason: 'end' })
  })

  it('stops the turn when a call belongs to the browser', async () => {
    let agent = dummyAgent({
      wordDelay: 0,
      script: () => ({ toolCalls: [{ name: 'where_am_i' }] }),
    })

    let events = await run(agent, ask('where am I?'), [
      { name: 'where_am_i', description: 'The current page', inputSchema: { type: 'object' } },
    ])

    assert.deepEqual(events.at(-1), { type: 'done', reason: 'tools' })
    assert.equal(events.some((event) => event.type === 'tool-result'), false)
  })

  it('turns a tool that throws into an error result rather than ending the turn', async () => {
    let broken: AgentTool = {
      name: 'broken',
      description: 'Always fails',
      inputSchema: { type: 'object' },
      run: () => {
        throw new Error('no')
      },
    }

    let agent = dummyAgent({
      wordDelay: 0,
      tools: [broken],
      script: (input) =>
        input.messages.at(-1)?.role === 'tool'
          ? { text: 'Sorry.' }
          : { toolCalls: [{ name: 'broken' }] },
    })

    let events = await run(agent, ask('break it'))

    assert.deepEqual(events[1], {
      type: 'tool-result',
      result: { id: 'dummy-0', content: 'no', isError: true },
    })
    assert.deepEqual(events.at(-1), { type: 'done', reason: 'end' })
  })

  it('gives up rather than looping when the script never finishes', async () => {
    let spin: AgentTool = {
      name: 'spin',
      description: 'Spins',
      inputSchema: { type: 'object' },
      run: () => 'again',
    }

    let agent = dummyAgent({
      wordDelay: 0,
      maxRounds: 2,
      tools: [spin],
      script: () => ({ toolCalls: [{ name: 'spin' }] }),
    })

    let events = await run(agent, ask('spin'))

    assert.deepEqual(events.at(-1), {
      type: 'error',
      message: 'Script ran for 2 rounds without finishing',
    })
  })

  it('answers with the default script when nothing is configured', async () => {
    let events = await run(dummyAgent({ wordDelay: 0 }), ask('hello'))

    assert.match(text(events), /dummy agent/)
    assert.match(text(events), /You said: hello/)
  })
})
