/**
 * The vocabulary the two halves share: what a conversation is made of, and what travels between
 * the browser and the controller while a turn runs.
 *
 * Nothing here is provider-shaped. A transcript is text, tool calls and tool results — no thinking
 * blocks, no `content: [{ type: 'text' }]`, no model ids. That is deliberate, and it is what lets
 * `agent/dummy` be a twenty-line function rather than a fake Anthropic server: an {@link Agent} is
 * asked for the next turn of *this* conversation and answers in *these* events, whatever it is
 * backed by. Mapping to and from a provider's own shape is the agent's job and stops at its edge.
 *
 * It is also why the conversation lives in the browser. The client posts the whole transcript on
 * every turn and the controller keeps nothing between requests — no session table, no eviction, no
 * sticky routing, and the same handler works on a serverless function or inside a router running in
 * the page. The cost is stated rather than hidden: a transcript that arrives over the wire is a
 * transcript the person on the other end can edit, so treat what a tool is asked to do as coming
 * from them and not from the model. See `helperAgentController`'s `beforeTurn` for where to check.
 *
 * @module
 */

/**
 * A tool, as the side that runs it declares it.
 *
 * The same shape whichever side that is — the controller's own tools and the ones the browser
 * offers for a turn are declared alike, and the model is never told which is which.
 */
export interface ToolSchema {
  /** What the model calls it. Must match `^[a-zA-Z0-9_-]{1,128}$`, which is the API's rule. */
  name: string
  /**
   * What it does, when to reach for it, and what it returns.
   *
   * This is the prompt for the tool, not a comment: it is the only thing the model reads before
   * deciding to call it. "Files a bug report against this site. Use it when the person describes
   * something broken and has confirmed they want it reported." beats "reports a bug".
   */
  description: string
  /** JSON Schema for the input — an object schema, as the Messages API requires. */
  inputSchema: Record<string, unknown>
}

/** The model asking for a tool to be run. */
export interface ToolCall {
  /** Ties the call to its result. Unique within the conversation. */
  id: string
  name: string
  /** Whatever the model produced for the schema — unvalidated until the side that runs it says so. */
  input: unknown
}

/** What running a {@link ToolCall} produced. */
export interface ToolResult {
  /** The {@link ToolCall.id} this answers. */
  id: string
  /** What the model reads back. A tool that has nothing to say still says something. */
  content: string
  /** Set when the tool failed. The model sees the failure and can try something else. */
  isError?: boolean
}

/**
 * One turn of the conversation.
 *
 * A `tool` message answers the `toolCalls` of the assistant message immediately before it, and must
 * answer all of them — the same rule the Messages API has, kept here so a transcript that is valid
 * in this vocabulary is valid after the agent maps it.
 */
export type ChatMessage =
  | { role: 'user'; content: string }
  | {
    role: 'assistant'
    content: string
    toolCalls?: readonly ToolCall[]
    /**
     * The agent's own record of this turn, in whatever form it wants it, for it to read back.
     *
     * Opaque on purpose: the client stores it beside the message and posts it again untouched, and
     * nothing but the agent that wrote it ever looks inside. It is how a stateless protocol stays
     * correct against a provider that cares about more than the words — `agent/claude` keeps the
     * turn's raw content blocks here, so the transcript it replays is the one the API returned
     * rather than one rebuilt from the text, which is what keeps reasoning and the cached prefix
     * intact across a round trip to the browser.
     *
     * An agent that has no such need — `agent/dummy` — simply never sets it, and one that finds
     * the value unreadable falls back to the text: a client is free to drop it, and a transcript
     * without it is still a valid transcript.
     */
    state?: string
  }
  | { role: 'tool'; results: readonly ToolResult[] }

/** What the client posts to ask for the next turn. */
export interface ChatRequest {
  /** The conversation so far, oldest first, ending with the `user` or `tool` message to answer. */
  messages: readonly ChatMessage[]
  /**
   * The tools this browser can run for this turn — reading the page, moving around it, whatever
   * the host app registered.
   *
   * Declared per request rather than once, because what the browser can do depends on the page it
   * is on: a tool that fills in the form on the settings screen has nothing to offer from the blog.
   */
  tools?: readonly ToolSchema[]
}

/** Why a turn stopped. */
export type DoneReason =
  /** The model finished. Nothing is owed. */
  | 'end'
  /** The model called tools the browser has to run. Answer them and post again. */
  | 'tools'
  /** The turn was cut off at the output limit, mid-sentence. */
  | 'max-tokens'
  /** The model declined to continue. */
  | 'refusal'

/**
 * One thing that happened while a turn ran.
 *
 * The stream is append-only and the client can render it as it arrives: `text` events are deltas to
 * concatenate, a `tool-call` is a call that has been made, and a `tool-result` is one the controller
 * answered itself. Exactly one terminal event ends a turn — `done` or `error`.
 *
 * One turn can hold several assistant messages, because a tool the controller runs itself is
 * answered inside the turn and the model then says something about it. Where one message ends and
 * the next begins is not announced; it follows from the events, and the client applies the same
 * three rules every time: a `tool-result` closes the assistant message whose call it answers,
 * `text` after a result starts the next assistant message, and `done` closes whatever is open.
 */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; result: ToolResult }
  /** Attaches to the assistant message being built — see {@link ChatMessage}'s `state`. */
  | { type: 'state'; state: string }
  | { type: 'done'; reason: DoneReason }
  | { type: 'error'; message: string }

/** The content type the controller answers with, and the one the client asks for. */
export const EVENT_STREAM_CONTENT_TYPE = 'text/event-stream'

/**
 * Frames an event for the stream.
 *
 * Server-sent events rather than newline-delimited JSON, for one reason that only shows up in
 * production: `text/event-stream` is the content type proxies and CDNs know not to buffer. A chat
 * that streams perfectly through `router.fetch()` in a test and arrives as one block through a
 * gateway is the failure this avoids.
 *
 * @param event The event to frame
 * @returns The SSE frame, newline-terminated
 */
export function encodeEvent(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Turns a `text/event-stream` body back into events.
 *
 * Chunk boundaries fall wherever the network puts them, so frames are reassembled from a buffer
 * rather than read one chunk at a time. A trailing partial frame at end of stream is dropped: a
 * truncated response is a turn that never ended, which the caller notices by the absence of a
 * terminal event rather than by a half-parsed one.
 *
 * @param body The response body to read
 * @returns The events, in order
 */
export async function* decodeEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  let decoder = new TextDecoder()
  let buffer = ''

  for await (let chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })

    let boundary: number
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      let frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      let data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')

      if (data !== '') yield JSON.parse(data) as AgentEvent
    }
  }
}
