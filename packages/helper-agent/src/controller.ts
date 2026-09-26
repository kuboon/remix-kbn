/**
 * The server half: the route that answers a conversation, and the vocabulary it answers in.
 *
 * Mount {@link helperAgentController} on a `POST` route, hand it an agent, and that is the whole of
 * the integration. It keeps nothing between requests, so the same handler runs on a serverless
 * function, on a long-lived server, and — with `agent/dummy` behind it — inside a router running in
 * the browser, where there is no server at all.
 *
 * The {@link Agent} interface is here rather than in an export of its own because this is the thing
 * that takes one. Writing an agent against another provider means implementing that one method.
 *
 * @module
 */

export { helperAgentController } from './lib/controller.ts'
export type { AnyContext, HelperAgentControllerOptions } from './lib/controller.ts'

export type { Agent, AgentInput, AgentTool, AgentToolContext } from './lib/agent.ts'

export { EVENT_STREAM_CONTENT_TYPE } from './lib/protocol.ts'
export type {
  AgentEvent,
  ChatMessage,
  ChatRequest,
  DoneReason,
  ToolCall,
  ToolResult,
  ToolSchema,
} from './lib/protocol.ts'
