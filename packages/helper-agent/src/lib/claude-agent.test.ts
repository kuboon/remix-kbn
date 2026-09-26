/**
 * The Messages API mapping, against a stand-in client.
 *
 * What is worth testing here is not that the SDK works — it is the two directions this file
 * translates: the transcript on the way out, and the turn on the way back. So the client is
 * replaced with one that records what it was asked for and hands back turns that were written here.
 */

import type Anthropic from '@anthropic-ai/sdk'
import * as assert from '@remix-run/assert'
import { describe, it } from '@std/testing/bdd'

import type { AgentTool } from './agent.ts'
import { claudeAgent } from './claude-agent.ts'
import type { AgentEvent, ChatMessage } from './protocol.ts'

/** The bits of a turn this agent reads. */
function turn(
  content: Anthropic.ContentBlock[],
  stop_reason: Anthropic.Message['stop_reason'] = 'end_turn',
): Anthropic.Message {
  return { content, stop_reason } as Anthropic.Message
}

let say = (text: string): Anthropic.ContentBlock => ({ type: 'text', text, citations: null })

let call = (
  id: string,
  name: string,
  input: unknown,
): Anthropic.ContentBlock => ({ type: 'tool_use', id, name, input } as Anthropic.ContentBlock)

/** A client that hands back the given turns in order and records every request. */
function fakeClient(
  turns: Anthropic.Message[],
): { client: Anthropic; sent: Anthropic.MessageCreateParams[] } {
  let sent: Anthropic.MessageCreateParams[] = []
  let next = 0

  let client = {
    messages: {
      stream(params: Anthropic.MessageCreateParams) {
        sent.push(params)
        let message = turns[next++]
        return {
          async *[Symbol.asyncIterator]() {
            for (let block of message.content) {
              if (block.type === 'text') {
                yield {
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text: block.text },
                }
              }
            }
          },
          finalMessage: () => Promise.resolve(message),
        }
      },
    },
  }

  return { client: client as unknown as Anthropic, sent }
}

async function run(
  turns: Anthropic.Message[],
  messages: ChatMessage[],
  options: {
    tools?: readonly AgentTool[]
    clientTools?: Parameters<typeof claudeAgent>[0]['tools']
  } = {},
): Promise<{ events: AgentEvent[]; sent: Anthropic.MessageCreateParams[] }> {
  let { client, sent } = fakeClient(turns)
  let agent = claudeAgent({ system: 'You help.', tools: options.tools, client })

  let events: AgentEvent[] = []
  for await (
    let event of agent.respond({ messages, clientTools: [], signal: new AbortController().signal })
  ) {
    events.push(event)
  }

  return { events, sent }
}

describe('claudeAgent', () => {
  it('streams the text and hands back the turn as state', async () => {
    let { events, sent } = await run([turn([say('Hello there.')])], [
      { role: 'user', content: 'hi' },
    ])

    assert.deepEqual(events, [
      { type: 'text', text: 'Hello there.' },
      { type: 'state', state: JSON.stringify([say('Hello there.')]) },
      { type: 'done', reason: 'end' },
    ])
    assert.equal(sent[0].model, 'claude-opus-5')
    assert.equal(sent[0].system, 'You help.')
  })

  it('runs its own tools and goes back to the model within the turn', async () => {
    let lookup: AgentTool = {
      name: 'lookup',
      description: 'Looks something up',
      inputSchema: { type: 'object', properties: {} },
      run: () => 'the docs say yes',
    }

    let { events, sent } = await run(
      [turn([call('t1', 'lookup', {})], 'tool_use'), turn([say('Yes.')])],
      [{ role: 'user', content: 'does it?' }],
      { tools: [lookup] },
    )

    assert.deepEqual(events.filter((event) => event.type === 'tool-result'), [
      { type: 'tool-result', result: { id: 't1', content: 'the docs say yes' } },
    ])
    assert.deepEqual(events.at(-1), { type: 'done', reason: 'end' })
    assert.equal(sent.length, 2)
    assert.deepEqual(sent[1].messages.at(-1), {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 't1',
        content: 'the docs say yes',
        is_error: undefined,
      }],
    })
  })

  it('stops the turn for a tool it does not hold', async () => {
    let { events, sent } = await run(
      [turn([call('t1', 'where_am_i', {})], 'tool_use')],
      [{ role: 'user', content: 'where?' }],
    )

    assert.deepEqual(events.at(-1), { type: 'done', reason: 'tools' })
    assert.equal(sent.length, 1)
  })

  it('reports the stop reasons that are not an ending', async () => {
    let cut = await run([turn([say('as far as')], 'max_tokens')], [{ role: 'user', content: 'go' }])
    assert.deepEqual(cut.events.at(-1), { type: 'done', reason: 'max-tokens' })

    let no = await run([turn([], 'refusal')], [{ role: 'user', content: 'go' }])
    assert.deepEqual(no.events.at(-1), { type: 'done', reason: 'refusal' })
  })

  it('replays an assistant turn from its state rather than rebuilding it', async () => {
    let blocks = [say('Checking.'), call('t1', 'where_am_i', {})]
    let { sent } = await run([turn([say('Right.')])], [
      { role: 'user', content: 'where?' },
      { role: 'assistant', content: 'Checking.', toolCalls: [], state: JSON.stringify(blocks) },
      { role: 'tool', results: [{ id: 't1', content: '/settings' }] },
    ])

    assert.deepEqual(sent[0].messages[1], { role: 'assistant', content: blocks })
  })

  it('rebuilds an assistant turn when its state is unusable', async () => {
    let { sent } = await run([turn([say('Right.')])], [
      { role: 'user', content: 'where?' },
      {
        role: 'assistant',
        content: 'Checking.',
        toolCalls: [{ id: 't1', name: 'where_am_i', input: {} }],
        state: 'not json',
      },
      { role: 'tool', results: [{ id: 't1', content: '/settings' }] },
    ])

    assert.deepEqual(sent[0].messages[1], {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 't1', name: 'where_am_i', input: {} },
      ],
    })
  })

  it('merges the neighbours that would otherwise be two user turns in a row', async () => {
    let { sent } = await run([turn([say('Right.')])], [
      { role: 'user', content: 'where?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'p', input: {} }] },
      { role: 'tool', results: [{ id: 't1', content: '/settings' }] },
      { role: 'user', content: 'and now?' },
    ])

    assert.deepEqual(sent[0].messages.map((message) => message.role), [
      'user',
      'assistant',
      'user',
    ])
    assert.equal((sent[0].messages[2].content as unknown[]).length, 2)
  })
})
