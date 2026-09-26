/**
 * An agent backed by the Anthropic Messages API.
 *
 * It maps the neutral transcript onto the API's shape, streams the turn back as it is produced,
 * runs the tools it holds itself, and stops when the model asks for one the browser has to run.
 * Everything a deployment has to decide — the model, the system prompt, the tools, the key — is
 * given here, once, and nothing about it reaches the controller or the browser.
 *
 * Three things it does that are easy to leave out and expensive to leave out:
 *
 * - **It streams.** A support answer takes seconds to generate and the person is watching an empty
 *   box for all of them otherwise.
 * - **It replays the turn the API returned, not a rebuild of it.** The raw content blocks go back to
 *   the client as the message's opaque `state` and come back untouched on the next request. That is
 *   what keeps the cached prefix stable across a tool round trip through the browser — and on the
 *   models that bind reasoning to the conversation that produced it, what keeps the reasoning.
 * - **It passes the signal down.** A closed tab aborts the request in flight rather than paying for
 *   the rest of an answer nobody will read.
 *
 * Tool inputs are not streamed eagerly. That option exists for tools whose input is a file or a
 * document, where waiting for the server to buffer it is the slow part; a support chat's inputs are
 * a sentence, and the cost of eager streaming — the client, not the API, becomes responsible for
 * validating a possibly truncated input — buys nothing against them.
 *
 * @module
 */

import Anthropic from '@anthropic-ai/sdk'

import type { Agent, AgentInput, AgentTool } from './agent.ts'
import type { AgentEvent, ChatMessage, ToolResult, ToolSchema } from './protocol.ts'

/** Options for {@link claudeAgent}. */
export interface ClaudeAgentOptions {
  /**
   * The system prompt: who this assistant is, what site it is on, and what it must not claim.
   *
   * Required, because a support chat with no system prompt is a general-purpose assistant sitting
   * on someone's site under their name. This is where the site's own knowledge goes — the
   * vocabulary its screens use, where the settings live, what it cannot do — and it is the single
   * biggest lever on whether the thing is useful.
   */
  system: string
  /**
   * Tools it runs itself, where the credentials are: filing the bug report, searching the
   * documentation, looking something up.
   */
  tools?: readonly AgentTool[]
  /** The model. Defaults to `'claude-opus-5'`. */
  model?: string
  /**
   * The output cap for one turn, in tokens. Defaults to `8192`.
   *
   * Well below what the model can produce, because this is a chat panel: an answer long enough to
   * need more is an answer that should have been a link to a page.
   */
  maxTokens?: number
  /**
   * How many times it will run its own tools and go back to the model within one turn. Defaults
   * to `8`.
   *
   * The stop for a model that keeps reaching for the same tool. Hitting it ends the turn with an
   * `error` rather than with a half-answer that looks finished.
   */
  maxRounds?: number
  /**
   * The client to use. Defaults to `new Anthropic()`, which resolves the key from the environment
   * (`ANTHROPIC_API_KEY`).
   *
   * Pass one to set a base URL, a proxy, retries, or a key from somewhere other than the
   * environment.
   */
  client?: Anthropic
  /**
   * Anything else to put on the request — `thinking`, `effort`, `service_tier`, a server tool in
   * `tools`, `context_management`.
   *
   * Merged over what this builds, and deliberately untyped against a moving API rather than
   * mirrored option by option. `tools` given here is appended to the ones built from
   * {@link tools} and the browser's, so a server tool like web search sits alongside them.
   */
  request?: Record<string, unknown>
}

/** What `client.messages.stream()` takes, named from the client so the SDK's own shape is used. */
type StreamParams = Parameters<Anthropic['messages']['stream']>[0]

const DEFAULT_MODEL = 'claude-opus-5'
const DEFAULT_MAX_TOKENS = 8192
const DEFAULT_MAX_ROUNDS = 8

/**
 * Creates an agent that answers through the Messages API.
 *
 * @param options The system prompt, the tools it runs, and the model
 * @returns The agent, to hand to `helperAgentController`
 *
 * @example
 * ```ts
 * let agent = claudeAgent({
 *   system: 'You help people use example.com. Answer from the site guide below…',
 *   tools: [reportBug],
 * })
 * ```
 */
export function claudeAgent(options: ClaudeAgentOptions): Agent {
  let {
    system,
    tools = [],
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    maxRounds = DEFAULT_MAX_ROUNDS,
    client = new Anthropic(),
    request = {},
  } = options

  return {
    async *respond(input: AgentInput): AsyncGenerator<AgentEvent> {
      let messages = toMessageParams(input.messages)
      let extraTools = Array.isArray(request.tools) ? (request.tools as Anthropic.ToolUnion[]) : []
      let toolParams: Anthropic.ToolUnion[] = [
        ...tools.map(toToolParam),
        ...input.clientTools.map(toToolParam),
        ...extraTools,
      ]

      for (let round = 0; round < maxRounds; round++) {
        let stream = client.messages.stream({
          model,
          max_tokens: maxTokens,
          system,
          messages,
          ...request,
          // After the spread: `toolParams` already folded in whatever `request.tools` carried, so
          // this puts the merged list back rather than letting the spread win with a partial one.
          tools: toolParams,
        } as StreamParams, { signal: input.signal })

        for await (let event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text }
          }
        }

        let message = await stream.finalMessage()

        // The turn as the API returned it, for the client to hand back verbatim next time.
        yield { type: 'state', state: JSON.stringify(message.content) }
        messages = [...messages, { role: 'assistant', content: message.content }]

        // A server-side tool ran out of its own iterations. Nothing is owed by anyone here; sending
        // the turn back is what continues it.
        if (message.stop_reason === 'pause_turn') continue

        if (message.stop_reason === 'max_tokens') {
          yield { type: 'done', reason: 'max-tokens' }
          return
        }
        if (message.stop_reason === 'refusal') {
          yield { type: 'done', reason: 'refusal' }
          return
        }

        let calls = message.content.filter((block) => block.type === 'tool_use')
        if (calls.length === 0) {
          yield { type: 'done', reason: 'end' }
          return
        }

        for (let call of calls) {
          yield { type: 'tool-call', call: { id: call.id, name: call.name, input: call.input } }
        }

        let mine = calls.filter((call) => tools.some((tool) => tool.name === call.name))
        let results: ToolResult[] = []
        for (let call of mine) {
          let tool = tools.find((candidate) => candidate.name === call.name)!
          let result = await runTool(tool, call.id, call.input, input.messages, input.signal)
          results.push(result)
          yield { type: 'tool-result', result }
        }

        // Whatever is left belongs to the browser, which cannot be reached from inside a turn.
        if (mine.length < calls.length) {
          yield { type: 'done', reason: 'tools' }
          return
        }

        messages = [...messages, { role: 'user', content: results.map(toToolResultParam) }]
      }

      yield { type: 'error', message: `Gave up after ${maxRounds} rounds of tool use` }
    },
  }
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

function toToolParam(tool: ToolSchema): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
  }
}

function toToolResultParam(result: ToolResult): Anthropic.ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: result.id,
    content: result.content,
    is_error: result.isError,
  }
}

/**
 * Maps the neutral transcript onto the API's messages.
 *
 * Two things it does that are not a straight translation, and both are the API's rules rather than
 * this package's. An assistant turn is restored from its `state` when there is one, so what goes
 * back is the content the API returned rather than a rebuild of it. And messages that end up with
 * the same role next to each other are merged — a tool result is a `user` message here, so the
 * person's next question would otherwise arrive as a second `user` turn in a row.
 *
 * @param messages The transcript
 * @returns The messages to send
 */
function toMessageParams(messages: readonly ChatMessage[]): Anthropic.MessageParam[] {
  let out: Anthropic.MessageParam[] = []

  let push = (role: 'user' | 'assistant', content: Anthropic.ContentBlockParam[]) => {
    if (content.length === 0) return
    let last = out.at(-1)
    if (last?.role === role && Array.isArray(last.content)) {
      last.content = [...last.content, ...content]
      return
    }
    out.push({ role, content })
  }

  for (let message of messages) {
    if (message.role === 'user') {
      push('user', [{ type: 'text', text: message.content }])
      continue
    }

    if (message.role === 'tool') {
      push('user', message.results.map(toToolResultParam))
      continue
    }

    let restored = restoreState(message.state)
    if (restored !== null) {
      push('assistant', restored)
      continue
    }

    let content: Anthropic.ContentBlockParam[] = []
    if (message.content !== '') content.push({ type: 'text', text: message.content })
    for (let call of message.toolCalls ?? []) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input ?? {} })
    }
    push('assistant', content)
  }

  return out
}

/**
 * Reads back what this agent stored on an assistant message, or `null` if there is nothing usable.
 *
 * The value came from the browser, so it is checked rather than trusted: anything that is not a
 * non-empty array of blocks falls back to rebuilding the turn from its text, which is a worse
 * prompt and never a broken request.
 */
function restoreState(state: string | undefined): Anthropic.ContentBlockParam[] | null {
  if (state === undefined) return null

  try {
    let parsed = JSON.parse(state)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    if (!parsed.every((block) => typeof block?.type === 'string')) return null
    return parsed as Anthropic.ContentBlockParam[]
  } catch {
    return null
  }
}
