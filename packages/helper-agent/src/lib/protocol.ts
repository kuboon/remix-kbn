/**
 * The wire format, which lives with the browser half in `@kuboon/chat-element`.
 *
 * Re-exported from its DOM-free entry so the controller and the agents keep importing it from
 * here, and so the two halves can never disagree about what a turn looks like.
 *
 * @module
 */

export { decodeEvents, encodeEvent, EVENT_STREAM_CONTENT_TYPE } from '@kuboon/chat-element/protocol'
export type {
  AgentEvent,
  ChatMessage,
  ChatRequest,
  DoneReason,
  ToolCall,
  ToolResult,
  ToolSchema,
} from '@kuboon/chat-element/protocol'
