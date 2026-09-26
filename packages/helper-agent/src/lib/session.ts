/**
 * The conversation, as the browser holds it.
 *
 * This is the whole client apart from the pixels: the transcript, the request, the stream, the
 * tools this page can run, and the round trip that happens when the model asks for one. It is a
 * `TypedEventTarget` that fires `change` whenever any of that moves, so the component over in
 * `chat.tsx` is a render function and nothing else — and so a host app that wants its own chat UI
 * can take this and draw whatever it likes.
 *
 * It holds the conversation because the controller does not. Every request carries the transcript
 * so far, which is what makes the server half stateless and, more usefully, what makes the server
 * half optional: point {@link HelperAgentSessionOptions.transport} at a router running in this same
 * document and the entire chat happens in the browser, with no origin behind it. That is not a test
 * seam bolted on afterwards — it is the same code path, answered by something nearer.
 *
 * @module
 */

import { TypedEventTarget } from '@remix-run/ui'

import type { AgentEvent, ChatMessage, ToolCall, ToolResult, ToolSchema } from './protocol.ts'
import { decodeEvents, EVENT_STREAM_CONTENT_TYPE } from './protocol.ts'

/** Where the controller is, and who answers. */
export interface HelperAgentTransport {
  /** The controller's path or URL. Resolved against the document, so a path is enough. */
  url: string | URL
  /**
   * Who answers it. Defaults to the network.
   *
   * A `@remix-run/fetch-router` router running in this browser answers too — pass its `fetch` and
   * the request never leaves the page. That is how a static host serves a working chat: mount the
   * controller on the client router with `agent/dummy` behind it.
   */
  fetch?: (request: Request) => Promise<Response>
}

/**
 * A tool this page can run.
 *
 * These are the ones worth having for explaining a site, because they are the ones that can see it:
 * which screen is open, what a form currently holds, what the person just selected. They run in the
 * browser, on the page the question is about, and their results go back into the conversation like
 * any other.
 *
 * They are declared to the controller per request and never persisted there, so a page registers
 * only what it can actually do.
 */
export interface ClientTool extends ToolSchema {
  /**
   * Runs the tool.
   *
   * `input` is whatever the model produced — check it rather than destructuring it. Throwing is how
   * to report that the tool could not run; the failure goes back to the model, which can say so or
   * try something else.
   *
   * @param input What the model passed
   * @param signal Aborted when the turn is abandoned
   * @returns What the model reads back
   */
  run(input: unknown, signal: AbortSignal): string | Promise<string>
}

/** What the session is doing. */
export type HelperAgentStatus =
  /** Waiting for the person to type. */
  | 'idle'
  /** A turn is in flight. */
  | 'streaming'
  /** The model asked for this page's tools and they are running. */
  | 'running-tools'
  /** The last turn failed. {@link HelperAgentSession.error} says how. */
  | 'error'

/** Options for {@link HelperAgentSession}. */
export interface HelperAgentSessionOptions {
  /** Where the controller is. A bare path or URL means "over the network, at this URL". */
  transport: string | URL | HelperAgentTransport
  /** What this page can do, offered to the model on every turn. */
  tools?: readonly ClientTool[]
  /**
   * How many times a turn may come back asking for this page's tools. Defaults to `4`.
   *
   * Each round is another request, so this is the stop on a conversation that would otherwise
   * bounce between the model and the page indefinitely.
   */
  maxRounds?: number
}

const DEFAULT_MAX_ROUNDS = 4

/**
 * One conversation.
 *
 * Fires `change` after anything observable moves — a delta arriving, a tool starting, a turn
 * ending. Render from {@link messages} and {@link status} on every one of them.
 */
export class HelperAgentSession extends TypedEventTarget<{ change: Event }> {
  #transport: Required<HelperAgentTransport>
  #tools: readonly ClientTool[]
  #maxRounds: number

  #committed: ChatMessage[] = []
  #turn: TurnBuilder | null = null
  #status: HelperAgentStatus = 'idle'
  #error: string | null = null
  #aborter: AbortController | null = null

  /**
   * @param options Where the controller is, and what this page can do
   */
  constructor(options: HelperAgentSessionOptions) {
    super()
    this.#transport = resolveTransport(options.transport)
    this.#tools = options.tools ?? []
    this.#maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS
  }

  /**
   * The conversation, including the turn currently arriving.
   *
   * A partly-streamed assistant message is in here as soon as its first word is, which is what
   * makes rendering this list the whole of rendering the chat.
   */
  get messages(): readonly ChatMessage[] {
    return this.#turn === null ? this.#committed : [...this.#committed, ...this.#turn.preview()]
  }

  /** What the session is doing. */
  get status(): HelperAgentStatus {
    return this.#status
  }

  /** Why the last turn failed, or `null`. */
  get error(): string | null {
    return this.#error
  }

  /** Whether a turn is in flight, so the composer knows to wait. */
  get busy(): boolean {
    return this.#status === 'streaming' || this.#status === 'running-tools'
  }

  /**
   * Sends what the person typed and runs the turn to its end, tool round trips included.
   *
   * Resolves when the conversation is waiting on the person again. A failure does not throw — it
   * lands in {@link error} with the status set to `'error'`, because a chat panel has somewhere to
   * show that and a caller usually does not.
   *
   * @param text What the person typed
   */
  async send(text: string): Promise<void> {
    if (this.busy) return

    let trimmed = text.trim()
    if (trimmed === '') return

    this.#committed = [...this.#committed, { role: 'user', content: trimmed }]
    this.#error = null
    await this.#run()
  }

  /** Abandons the turn in flight. What has already arrived stays in the transcript. */
  stop(): void {
    this.#aborter?.abort()
  }

  /** Abandons the turn in flight and empties the transcript. */
  reset(): void {
    this.stop()
    this.#committed = []
    this.#turn = null
    this.#error = null
    this.#status = 'idle'
    this.#changed()
  }

  /** Runs turns until the model stops asking for this page's tools. */
  async #run(): Promise<void> {
    let aborter = new AbortController()
    this.#aborter = aborter
    this.#status = 'streaming'
    this.#changed()

    try {
      for (let round = 0; round < this.#maxRounds; round++) {
        let reason = await this.#turnOnce(aborter.signal)
        // Read through the getter: `#fail` may have changed the status from inside the turn, which
        // narrowing on the assignments in this method alone does not see.
        if (aborter.signal.aborted || this.status === 'error') return
        if (reason !== 'tools') return

        let pending = unansweredCalls(this.#committed)
        if (pending.length === 0) return

        this.#status = 'running-tools'
        this.#changed()

        let results: ToolResult[] = []
        for (let call of pending) results.push(await this.#runTool(call, aborter.signal))
        if (aborter.signal.aborted) return

        this.#committed = [...this.#committed, { role: 'tool', results }]
        this.#status = 'streaming'
        this.#changed()
      }

      this.#fail(`The assistant asked for this page's tools ${this.#maxRounds} times over`)
    } finally {
      if (this.#aborter === aborter) this.#aborter = null
      if (this.status !== 'error') this.#status = 'idle'
      this.#turn = null
      this.#changed()
    }
  }

  /** Runs one request, folding its events into the transcript as they arrive. */
  async #turnOnce(signal: AbortSignal): Promise<'end' | 'tools' | 'failed'> {
    let turn = new TurnBuilder()
    this.#turn = turn

    let request = new Request(this.#transport.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: EVENT_STREAM_CONTENT_TYPE,
      },
      body: JSON.stringify({
        messages: this.#committed,
        tools: this.#tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      }),
      signal,
    })

    let outcome: 'end' | 'tools' | 'failed' = 'end'

    try {
      let response = await this.#transport.fetch(request)
      if (!response.ok) {
        this.#fail(`The assistant is unavailable (${response.status} ${response.statusText})`)
        return 'failed'
      }
      if (response.body === null) {
        this.#fail('The assistant answered with an empty response')
        return 'failed'
      }

      for await (let event of decodeEvents(response.body)) {
        if (signal.aborted) break

        if (event.type === 'error') {
          this.#fail(event.message)
          return 'failed'
        }

        if (event.type === 'done') {
          outcome = event.reason === 'tools' ? 'tools' : 'end'
          // The answer stops mid-sentence at the output cap, and nothing else in the transcript
          // would say so. An ellipsis is not a fix, but it is the difference between a truncated
          // answer and one that looks complete.
          if (event.reason === 'max-tokens') turn.push({ type: 'text', text: ' …' })
          break
        }

        turn.push(event)
        this.#changed()
      }
    } catch (error) {
      if (signal.aborted) return 'failed'
      this.#fail(error instanceof Error ? error.message : String(error))
      return 'failed'
    } finally {
      this.#committed = turn.commitInto(this.#committed)
      this.#turn = null
    }

    return outcome
  }

  /** Runs one of this page's tools, turning a throw into the error result the model reads. */
  async #runTool(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    let tool = this.#tools.find((candidate) => candidate.name === call.name)
    if (tool === undefined) {
      return { id: call.id, content: `This page has no ${call.name} tool`, isError: true }
    }

    try {
      return { id: call.id, content: await tool.run(call.input, signal) }
    } catch (error) {
      let content = error instanceof Error ? error.message : String(error)
      return { id: call.id, content, isError: true }
    }
  }

  #fail(message: string): void {
    this.#error = message
    this.#status = 'error'
    this.#changed()
  }

  #changed(): void {
    this.dispatchEvent(new Event('change'))
  }
}

/**
 * Turns the event stream back into messages.
 *
 * The rules are the ones {@link AgentEvent} states, and they are here rather than inline because
 * getting them wrong is silent: text that arrives after a tool result belongs to the *next*
 * assistant message, and folding it into the previous one produces a transcript that reads fine and
 * replays wrong.
 */
class TurnBuilder {
  #done: ChatMessage[] = []
  #text = ''
  #calls: ToolCall[] = []
  #state: string | undefined
  #results: ToolResult[] = []

  /** Folds one event in. Terminal events are the caller's to handle and never reach here. */
  push(event: TurnEvent): void {
    if (event.type === 'text') {
      this.#flushResults()
      this.#text += event.text
      return
    }
    if (event.type === 'state') {
      this.#state = event.state
      return
    }
    if (event.type === 'tool-call') {
      this.#calls.push(event.call)
      return
    }
    this.#flushAssistant()
    this.#results.push(event.result)
  }

  /** What has arrived so far, for rendering mid-turn. */
  preview(): readonly ChatMessage[] {
    return this.#close([...this.#done])
  }

  /**
   * Appends the finished turn to the transcript.
   *
   * @param committed The transcript so far
   * @returns The transcript with this turn on the end
   */
  commitInto(committed: readonly ChatMessage[]): ChatMessage[] {
    return this.#close([...committed, ...this.#done])
  }

  /** Adds whatever is still open, without consuming it — `preview` runs on every delta. */
  #close(into: ChatMessage[]): ChatMessage[] {
    if (this.#text !== '' || this.#calls.length > 0 || this.#state !== undefined) {
      into.push({
        role: 'assistant',
        content: this.#text,
        ...(this.#calls.length > 0 ? { toolCalls: [...this.#calls] } : {}),
        ...(this.#state !== undefined ? { state: this.#state } : {}),
      })
    }
    if (this.#results.length > 0) into.push({ role: 'tool', results: [...this.#results] })
    return into
  }

  #flushAssistant(): void {
    if (this.#text === '' && this.#calls.length === 0 && this.#state === undefined) return
    this.#done.push({
      role: 'assistant',
      content: this.#text,
      ...(this.#calls.length > 0 ? { toolCalls: this.#calls } : {}),
      ...(this.#state !== undefined ? { state: this.#state } : {}),
    })
    this.#text = ''
    this.#calls = []
    this.#state = undefined
  }

  #flushResults(): void {
    if (this.#results.length === 0) return
    this.#done.push({ role: 'tool', results: this.#results })
    this.#results = []
  }
}

/** The events that build a message. The terminal two end a turn instead. */
type TurnEvent = Exclude<AgentEvent, { type: 'done' } | { type: 'error' }>

/**
 * The calls in the transcript that nothing has answered.
 *
 * A scan rather than a look at the last message: a turn where the controller ran one of its own
 * tools and left one for the browser ends with the results it produced, so the calls still owed
 * sit behind them.
 *
 * @param messages The transcript
 * @returns The calls still owed a result, in the order they were made
 */
export function unansweredCalls(messages: readonly ChatMessage[]): readonly ToolCall[] {
  let calls: ToolCall[] = []
  let answered = new Set<string>()

  for (let message of messages) {
    if (message.role === 'assistant') calls.push(...message.toolCalls ?? [])
    if (message.role === 'tool') { for (let result of message.results) answered.add(result.id) }
  }

  return calls.filter((call) => !answered.has(call.id))
}

/** Normalises the transport option into a URL and the function that answers it. */
function resolveTransport(
  transport: string | URL | HelperAgentTransport,
): Required<HelperAgentTransport> {
  let given = typeof transport === 'string' || transport instanceof URL
    ? { url: transport }
    : transport

  return {
    url: new URL(String(given.url), globalThis.location?.href),
    fetch: given.fetch ?? ((request) => globalThis.fetch(request)),
  }
}
