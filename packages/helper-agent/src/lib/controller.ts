/**
 * The server half: one route that takes a conversation and streams back the next turn.
 *
 * It is deliberately thin. It parses the request, decides whether to answer it at all, asks the
 * {@link Agent} for the turn, and frames what comes back. It has no opinion about models, tools or
 * prompts, and it keeps nothing between requests — which is what lets the same handler sit on a
 * serverless function, on a long-lived server, and inside a router running in the browser, where
 * the only thing that ever reaches it is `router.fetch()`.
 *
 * Two things it does have an opinion about, because a chat endpoint that lacks them is a chat
 * endpoint someone runs up a bill on:
 *
 * - **Limits.** The transcript arrives from the browser, so its length and its size are the
 *   caller's choice until this says otherwise. Both are capped, and both are options.
 * - **A gate.** {@link HelperAgentControllerOptions.beforeTurn} runs before the agent does, with
 *   the request context in hand, and can answer with a `Response` instead — a `401` for a
 *   conversation from someone not signed in, a `429` for one arriving too fast.
 *
 * @module
 */

import type { RequestContext, RequestHandler } from '@remix-run/fetch-router'

import type { Agent } from './agent.ts'
import type { AgentEvent, ChatMessage, ChatRequest, ToolSchema } from './protocol.ts'
import { encodeEvent, EVENT_STREAM_CONTENT_TYPE } from './protocol.ts'

/**
 * A request context of any shape. The handler only reads the request, so it composes with whatever
 * params and context entries the surrounding router provides.
 *
 * `any` is load-bearing here: a context carrying params or entries is not assignable to the empty
 * `RequestContext`, so a narrower parameter type would reject every real router's context.
 */
// deno-lint-ignore no-explicit-any
export type AnyContext = RequestContext<any, any>

/** Options for {@link helperAgentController}. */
export interface HelperAgentControllerOptions {
  /**
   * How many messages a transcript may carry. Defaults to `100`.
   *
   * A support conversation that has run past a hundred turns has stopped being one. The cap is on
   * the transcript the browser sends, so it bounds what any single request can cost regardless of
   * what the page's own code would have sent.
   */
  maxMessages?: number
  /**
   * How many bytes the request body may be. Defaults to `1_048_576` (1 MiB).
   *
   * Separate from {@link maxMessages} because the two fail differently: a hundred messages is a
   * long conversation, and one message can be a pasted stack trace.
   */
  maxBytes?: number
  /**
   * Runs before the agent does, and decides whether this turn happens.
   *
   * Return the request — the one handed in, or a changed one — to continue, or a `Response` to
   * answer with instead. This is the hook for authentication, for rate limiting, and for the thing
   * a stateless protocol makes possible: a transcript arrives from the browser, so a deployment
   * that cares can check that the one in front of it is a conversation it recognises rather than
   * one that was written to look like it.
   *
   * @param request What the browser posted
   * @param context The request context, for whatever middleware put in it
   * @returns The request to run, or the response to send instead
   */
  beforeTurn?(
    request: ChatRequest,
    context: AnyContext,
  ): ChatRequest | Response | Promise<ChatRequest | Response>
}

const DEFAULT_MAX_MESSAGES = 100
const DEFAULT_MAX_BYTES = 1_048_576

/**
 * Creates the request handler that serves `agent`.
 *
 * Register it with `router.post()`: the conversation is the body, so the route is a `POST` and
 * every other method gets the `405` the router writes for free.
 *
 * @param agent The agent to serve, or a function that builds one per request — take the second
 * form when the agent's tools need something only the request knows, like who is asking
 * @param options Limits and the pre-turn gate
 * @returns The request handler
 *
 * @example
 * ```ts
 * import { createRouter } from '@remix-run/fetch-router'
 * import { helperAgentController } from '@remix-kbn/helper-agent/controller'
 * import { claudeAgent } from '@remix-kbn/helper-agent/agent/claude'
 *
 * let router = createRouter()
 * router.post('/helper-agent', helperAgentController(claudeAgent({ system: 'You help…' })))
 * ```
 */
export function helperAgentController(
  agent: Agent | ((context: AnyContext) => Agent | Promise<Agent>),
  options: HelperAgentControllerOptions = {},
): RequestHandler<AnyContext> {
  let {
    maxMessages = DEFAULT_MAX_MESSAGES,
    maxBytes = DEFAULT_MAX_BYTES,
    beforeTurn,
  } = options

  return async (context: AnyContext): Promise<Response> => {
    let { request } = context

    let body = await request.text()
    if (body.length > maxBytes) {
      return problem(413, `Request body is larger than ${maxBytes} bytes`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return problem(400, 'Request body is not JSON')
    }

    let chat = readChatRequest(parsed)
    if (chat === null) return problem(400, 'Request body is not a chat request')
    if (chat.messages.length === 0) return problem(400, 'Request carries no messages')
    if (chat.messages.length > maxMessages) {
      return problem(413, `Conversation is longer than ${maxMessages} messages`)
    }

    if (beforeTurn) {
      let gated = await beforeTurn(chat, context)
      if (gated instanceof Response) return gated
      chat = gated
    }

    let resolved = typeof agent === 'function' ? await agent(context) : agent

    return streamTurn(resolved, chat, request.signal)
  }
}

/**
 * Runs the turn into a `text/event-stream` response.
 *
 * The stream owns the abort: the request's own signal aborts it, and so does the reader going away,
 * which is what a closed tab looks like from here. Whichever happens first stops the agent — a
 * generator that keeps producing into a stream nobody is reading is a request that is still being
 * billed.
 *
 * Exactly one terminal event is guaranteed, whatever the agent did. An agent that returned without
 * one gets a `done`, and one that threw gets an `error`: by the time it throws the response has
 * already started, so there is no status code left to say it with.
 */
function streamTurn(agent: Agent, chat: ChatRequest, signal: AbortSignal): Response {
  let aborter = new AbortController()
  let abort = () => aborter.abort()
  signal.addEventListener('abort', abort, { once: true })

  let encoder = new TextEncoder()

  let stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let send = (event: AgentEvent) => controller.enqueue(encoder.encode(encodeEvent(event)))
      let terminal = false

      try {
        for await (
          let event of agent.respond({
            messages: chat.messages,
            clientTools: chat.tools ?? [],
            signal: aborter.signal,
          })
        ) {
          if (aborter.signal.aborted) break
          terminal ||= event.type === 'done' || event.type === 'error'
          send(event)
        }

        if (!terminal && !aborter.signal.aborted) send({ type: 'done', reason: 'end' })
      } catch (error) {
        if (!aborter.signal.aborted) {
          send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      } finally {
        signal.removeEventListener('abort', abort)
        controller.close()
      }
    },
    cancel() {
      aborter.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': `${EVENT_STREAM_CONTENT_TYPE}; charset=utf-8`,
      'cache-control': 'no-store',
      // nginx buffers proxied responses by default, which turns a stream into one block at the end.
      'x-accel-buffering': 'no',
    },
  })
}

/** A plain-text error, for the cases that fail before the stream starts. */
function problem(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Reads a posted body as a {@link ChatRequest}, or `null` if it is not one.
 *
 * Structural rather than trusting: the body is whatever was posted, and a transcript with a
 * malformed message in the middle would otherwise reach the agent and fail there, where the only
 * thing left to answer with is an `error` event on an already-started stream.
 */
function readChatRequest(value: unknown): ChatRequest | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) return null

  let messages: ChatMessage[] = []
  for (let message of value.messages) {
    let read = readMessage(message)
    if (read === null) return null
    messages.push(read)
  }

  let tools: ToolSchema[] = []
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools)) return null
    for (let tool of value.tools) {
      let read = readTool(tool)
      if (read === null) return null
      tools.push(read)
    }
  }

  return { messages, tools }
}

function readMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null

  if (value.role === 'user') {
    return typeof value.content === 'string' ? { role: 'user', content: value.content } : null
  }

  if (value.role === 'assistant') {
    if (typeof value.content !== 'string') return null
    if (value.state !== undefined && typeof value.state !== 'string') return null
    let state = value.state as string | undefined

    if (value.toolCalls === undefined) return { role: 'assistant', content: value.content, state }
    if (!Array.isArray(value.toolCalls)) return null

    let toolCalls = []
    for (let call of value.toolCalls) {
      if (!isRecord(call) || typeof call.id !== 'string' || typeof call.name !== 'string') {
        return null
      }
      toolCalls.push({ id: call.id, name: call.name, input: call.input })
    }
    return { role: 'assistant', content: value.content, toolCalls, state }
  }

  if (value.role === 'tool') {
    if (!Array.isArray(value.results)) return null

    let results = []
    for (let result of value.results) {
      if (
        !isRecord(result) || typeof result.id !== 'string' || typeof result.content !== 'string'
      ) {
        return null
      }
      results.push({ id: result.id, content: result.content, isError: result.isError === true })
    }
    return { role: 'tool', results }
  }

  return null
}

function readTool(value: unknown): ToolSchema | null {
  if (!isRecord(value)) return null
  if (typeof value.name !== 'string' || typeof value.description !== 'string') return null
  if (!isRecord(value.inputSchema)) return null

  return { name: value.name, description: value.description, inputSchema: value.inputSchema }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
