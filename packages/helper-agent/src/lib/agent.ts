/**
 * What the controller is handed, and what a tool it runs itself looks like.
 *
 * One method. An agent is asked to continue a conversation and streams back what happens — text as
 * it is produced, the tools it called, the ones it ran. Everything else an implementation needs
 * (a model, an API key, a system prompt, its own tools) it closes over when it is constructed, so
 * the controller never learns any of it and swapping `agent/dummy` for `agent/claude` is one line.
 *
 * The split that matters is where a tool runs, and it is decided by who declared it. A tool the
 * agent holds runs inside `respond()` — the agent calls it, feeds the result back to the model and
 * keeps going, all within one turn. A tool the browser declared cannot be run here at all, so the
 * agent emits the call and stops; the client runs it, appends the result to the transcript and asks
 * for the next turn. Both end up in the transcript the same way, which is why the second kind costs
 * a round trip and nothing else.
 *
 * @module
 */

import type { AgentEvent, ChatMessage, ToolSchema } from './protocol.ts'

/** What an agent is asked to continue. */
export interface AgentInput {
  /** The conversation so far, oldest first. */
  messages: readonly ChatMessage[]
  /**
   * The tools the browser offered for this turn.
   *
   * The agent gives them to the model alongside its own and emits a `tool-call` when one is
   * chosen, but never runs one — it has no page to run it against.
   */
  clientTools: readonly ToolSchema[]
  /**
   * Aborted when the caller stops caring: the person closed the chat, or the request was cut off.
   *
   * Pass it to every request and every tool. A turn that keeps generating into a closed connection
   * is a turn that is still being billed.
   */
  signal: AbortSignal
}

/** The thing the controller serves. */
export interface Agent {
  /**
   * Continues the conversation.
   *
   * Yields until the turn is over, and the last thing it yields is terminal — `done` or `error`.
   * An implementation that throws instead is not a bug the controller cannot handle; it turns the
   * throw into an `error` event, because by then the response has already started and there is no
   * status code left to set.
   *
   * @param input The conversation, the browser's tools, and the abort signal
   * @returns The events of this turn, in order
   */
  respond(input: AgentInput): AsyncIterable<AgentEvent>
}

/** What a tool is told about the turn it is running in. */
export interface AgentToolContext {
  /** The conversation up to the call, for a tool that wants the context it was called from. */
  messages: readonly ChatMessage[]
  /** Aborted when the turn is. A tool that reaches the network should pass it on. */
  signal: AbortSignal
}

/**
 * A tool the agent runs itself, on whichever side the controller is.
 *
 * This is where the useful ones live for a support chat: filing the bug report, searching the
 * documentation, looking up an order. They run where the credentials are, and the browser never
 * sees them — the person chatting learns that a bug was filed, not what it took to file one.
 */
export interface AgentTool extends ToolSchema {
  /**
   * Runs the tool.
   *
   * `input` is whatever the model produced. It is shaped like {@link ToolSchema.inputSchema} often
   * enough to be tempting and not often enough to trust, and on a support chat the conversation it
   * came from is a stranger's, so validate it here rather than destructuring it.
   *
   * Returning is how a tool reports what happened; throwing is how it reports that it could not.
   * Both reach the model — a throw as an error result it can react to — so neither ends the turn.
   *
   * @param input What the model passed
   * @param context The conversation and the turn's abort signal
   * @returns What the model reads back
   */
  run(input: unknown, context: AgentToolContext): string | Promise<string>
}
