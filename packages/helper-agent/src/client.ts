/**
 * The browser half: [`@kuboon/chat-element`](https://jsr.io/@kuboon/chat-element), under the
 * names this package has always used for it.
 *
 * {@link openHelperAgent} is the one-line version — a `<dialog>` with a `<chat-panel>` in it, for
 * a host whose plan is "press this button and the helper opens". Under it, {@link HelperAgentSession}
 * is the conversation on its own, and `createChatPanel` draws one inside the host's own layout.
 *
 * None of it depends on Remix: the panel is a custom element, and the session is an `EventTarget`
 * that posts to anything answering a `Request` — the controller on a server, or a
 * `@remix-run/fetch-router` router running in this same document, which is what lets the whole
 * chat work on a static host with `agent/dummy` behind it.
 *
 * The panel can also let the person point at something on the page instead of describing it; only
 * the element's CSS path is sent. `pickElementTool: true` offers the same to the model.
 *
 * @module
 */

export {
  ChatSession as HelperAgentSession,
  createChatPanel,
  defineChatPanel,
  elementPath,
  openChat as openHelperAgent,
  pickElement,
  pickElementTool,
  unansweredCalls,
} from '@kuboon/chat-element'
export type {
  ChatDialog as HelperAgentPanel,
  ChatPanelElement,
  ChatPanelLabels,
  ChatSessionOptions as HelperAgentSessionOptions,
  ChatStatus as HelperAgentStatus,
  ChatTransport as HelperAgentTransport,
  ClientTool,
  OpenChatOptions as OpenHelperAgentOptions,
  PickElementOptions,
  PickElementToolOptions,
} from '@kuboon/chat-element'

export type {
  AgentEvent,
  ChatMessage,
  ChatRequest,
  DoneReason,
  ToolCall,
  ToolResult,
  ToolSchema,
} from './lib/protocol.ts'
