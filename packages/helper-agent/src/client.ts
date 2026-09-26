/**
 * The browser half: the conversation, and a panel to show it in.
 *
 * {@link openHelperAgent} is the one-line version — a `<dialog>` with the chat in it, for a host
 * whose plan is "press this button and the helper opens". Under it, {@link HelperAgentSession} is
 * the conversation on its own, and {@link HelperAgentChat} is a `@remix-run/ui` component over one;
 * an app that wants the chat inside its own layout, or drawn its own way, takes those two instead.
 *
 * The transport is where the interesting choice is. It defaults to the network, and it takes a
 * `fetch` — so a `@remix-run/fetch-router` running in this same document answers it too, which is
 * what lets the whole chat work on a static host with `agent/dummy` behind it.
 *
 * @module
 */

export { openHelperAgent } from './lib/open.ts'
export type { HelperAgentPanel, OpenHelperAgentOptions } from './lib/open.ts'

export { HelperAgentChat } from './lib/chat.tsx'
export type { HelperAgentChatProps } from './lib/chat.tsx'

export { HelperAgentSession, unansweredCalls } from './lib/session.ts'
export type {
  ClientTool,
  HelperAgentSessionOptions,
  HelperAgentStatus,
  HelperAgentTransport,
} from './lib/session.ts'

export type {
  AgentEvent,
  ChatMessage,
  ChatRequest,
  DoneReason,
  ToolCall,
  ToolResult,
  ToolSchema,
} from './lib/protocol.ts'
