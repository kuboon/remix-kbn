/**
 * An agent that answers from a script instead of a model.
 *
 * It exists for the two places a real one cannot go. Tests: a turn that streams the same words in
 * the same order every run, with no API key, no network and no bill. And static hosting: mount the
 * controller on a router that runs in the browser, hand it this, and the whole chat — the client,
 * the wire protocol, the tool round trip — works on GitHub Pages, where there is no server to put
 * an API key on. The client cannot tell the difference, which is the point: what you exercise there
 * is the real thing, minus the model.
 *
 * It is a real {@link Agent} and not a stub, so it honours the parts of the contract that are easy
 * to get wrong elsewhere — it runs its own tools and loops on their results, it emits exactly one
 * terminal event, and it stops when the signal aborts.
 *
 * @module
 */

import type { Agent, AgentInput, AgentTool } from './agent.ts'
import type { AgentEvent, ChatMessage, ToolResult } from './protocol.ts'

/** A turn, as a script describes it. */
export interface DummyTurn {
  /** What to say. Streamed a word at a time, so the client's rendering is exercised too. */
  text?: string
  /** Tools to call. Ones the dummy holds it runs itself; the rest go to the browser. */
  toolCalls?: readonly DummyToolCall[]
}

/** A call a script asked for. The id is assigned for it. */
export interface DummyToolCall {
  name: string
  input?: unknown
}

/**
 * Decides one turn.
 *
 * Called again after the dummy has run its own tools, with the results appended to `messages`, so a
 * script can react to them the way a model would.
 *
 * @param input The conversation, the browser's tools, and the abort signal
 * @returns What to say and what to call
 */
export type DummyScript = (input: AgentInput) => DummyTurn | Promise<DummyTurn>

/** A canned reply, for {@link scriptedTurns}. */
export interface DummyReply {
  /** Matched against the most recent user message. A string matches case-insensitively anywhere. */
  match: string | RegExp
  /** What to answer with. */
  turn: DummyTurn
}

/** Options for {@link dummyAgent}. */
export interface DummyAgentOptions {
  /** How it decides a turn. Defaults to {@link echoTurn}. */
  script?: DummyScript
  /**
   * Tools it runs itself, standing in for the ones a real deployment would run where its
   * credentials are. A script that calls one of these gets its result inside the same turn.
   */
  tools?: readonly AgentTool[]
  /**
   * Milliseconds between streamed words. Defaults to `15`.
   *
   * Pass `0` in tests: it makes a turn resolve in one microtask queue rather than in real time, and
   * it is the difference between a suite that runs instantly and one that sleeps.
   */
  wordDelay?: number
  /**
   * How many times it will run its own tools and ask the script again. Defaults to `4`.
   *
   * A script that calls the same tool every time it sees its result is a loop, and this is where it
   * stops rather than where it runs out of memory.
   */
  maxRounds?: number
}

/**
 * Creates a scripted agent.
 *
 * @param options The script, its tools, and the pacing
 * @returns The agent, to hand to `helperAgentController`
 *
 * @example
 * ```ts
 * let agent = dummyAgent({
 *   script: scriptedTurns([
 *     { match: /price|cost/i, turn: { text: 'Everything here is free.' } },
 *     { match: 'bug', turn: { toolCalls: [{ name: 'report_bug', input: { summary: 'demo' } }] } },
 *   ]),
 * })
 * ```
 */
export function dummyAgent(options: DummyAgentOptions = {}): Agent {
  let { script = echoTurn, tools = [], wordDelay = 15, maxRounds = 4 } = options

  return {
    async *respond(input: AgentInput): AsyncGenerator<AgentEvent> {
      let messages = [...input.messages]
      // Call ids have to be unique across the whole conversation, not just this turn: the client
      // matches results to calls by id, and a turn that reissues one the transcript already
      // answered looks, from there, like a call that needs nothing.
      let issued = countCalls(input.messages)

      for (let round = 0; round < maxRounds; round++) {
        let turn = await script({ ...input, messages })
        if (input.signal.aborted) return

        for (let word of splitWords(turn.text ?? '')) {
          if (input.signal.aborted) return
          if (wordDelay > 0) await sleep(wordDelay, input.signal)
          yield { type: 'text', text: word }
        }

        let calls = (turn.toolCalls ?? []).map((call) => ({
          id: `dummy-${issued++}`,
          name: call.name,
          input: call.input ?? {},
        }))
        if (calls.length === 0) {
          yield { type: 'done', reason: 'end' }
          return
        }

        for (let call of calls) yield { type: 'tool-call', call }

        let mine = calls.filter((call) => tools.some((tool) => tool.name === call.name))
        let results: ToolResult[] = []
        for (let call of mine) {
          let tool = tools.find((candidate) => candidate.name === call.name)!
          let result = await runTool(tool, call.id, call.input, messages, input.signal)
          results.push(result)
          yield { type: 'tool-result', result }
        }

        // Anything the dummy does not hold is the browser's, and the browser cannot be reached from
        // inside a turn. Stop and let the client answer.
        if (mine.length < calls.length) {
          yield { type: 'done', reason: 'tools' }
          return
        }

        messages = [
          ...messages,
          { role: 'assistant', content: turn.text ?? '', toolCalls: calls },
          { role: 'tool', results },
        ]
      }

      yield { type: 'error', message: `Script ran for ${maxRounds} rounds without finishing` }
    },
  }
}

/**
 * Builds a script from a list of canned replies.
 *
 * The first whose `match` hits the most recent user message wins. A turn that follows the dummy's
 * own tool results is matched against that same user message, so a two-step reply is written as one
 * entry whose second round the script reaches through `fallback` — or, more simply, by giving the
 * matching turn no further calls.
 *
 * @param replies The replies to try, in order
 * @param fallback What to answer when none match. Defaults to {@link echoTurn}
 * @returns The script
 */
export function scriptedTurns(
  replies: readonly DummyReply[],
  fallback: DummyScript = echoTurn,
): DummyScript {
  return (input) => {
    // A turn that already carries tool results has had its say; answering it with the same canned
    // turn again would call the same tools forever.
    if (input.messages.at(-1)?.role === 'tool') return fallback(input)

    let text = latestUserText(input.messages)
    for (let reply of replies) {
      let hit = typeof reply.match === 'string'
        ? text.toLowerCase().includes(reply.match.toLowerCase())
        : reply.match.test(text)
      if (hit) return reply.turn
    }

    return fallback(input)
  }
}

/**
 * The default script: says what it was given, and what it could have been given.
 *
 * Useless as an answer and useful as a check — it proves the transcript arrived, the browser's
 * tools were declared, and the stream came back, without anybody writing a script first.
 *
 * @param input The conversation and the browser's tools
 * @returns A turn that only talks
 */
export function echoTurn(input: AgentInput): DummyTurn {
  let last = input.messages.at(-1)

  if (last?.role === 'tool') {
    let reported = last.results
      .map((result) => `${result.isError ? 'error' : 'result'}: ${result.content}`)
      .join('; ')
    return { text: `Thanks — the tools came back with ${reported}.` }
  }

  let offered = input.clientTools.map((tool) => tool.name)
  let tools = offered.length === 0
    ? 'This page offered no tools.'
    : `This page offered ${offered.join(', ')}.`

  return {
    text: `There is no model behind this chat — it is the dummy agent, replying from a script. ` +
      `You said: ${latestUserText(input.messages)}. ${tools}`,
  }
}

/** How many calls the conversation has already made, so the next id carries on from there. */
function countCalls(messages: readonly ChatMessage[]): number {
  let count = 0
  for (let message of messages) {
    if (message.role === 'assistant') count += message.toolCalls?.length ?? 0
  }
  return count
}

/** The most recent thing the person typed, or `''` if they have not typed anything. */
function latestUserText(messages: readonly ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    let message = messages[index]
    if (message.role === 'user') return message.content
  }
  return ''
}

/** Runs one tool, turning a throw into the error result the model reads. */
async function runTool(
  tool: AgentTool,
  id: string,
  input: unknown,
  messages: readonly ChatMessage[],
  signal: AbortSignal,
): Promise<ToolResult> {
  try {
    return { id, content: await tool.run(input, { messages, signal }) }
  } catch (error) {
    return { id, content: error instanceof Error ? error.message : String(error), isError: true }
  }
}

/** Splits text into chunks that keep their trailing space, so concatenating them restores it. */
function splitWords(text: string): string[] {
  return text === '' ? [] : text.split(/(?<=\s)/)
}

/** Sleeps, and resolves early when the turn is abandoned. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })

    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}
