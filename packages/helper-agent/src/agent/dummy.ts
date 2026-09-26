/**
 * The agent that answers from a script.
 *
 * For tests, where a turn has to stream the same words every run without a key or a network, and
 * for static hosting, where the controller runs in the browser and there is no server to keep a key
 * on. It is a real agent, not a stub: it runs its own tools, it loops on their results, and the
 * client cannot tell the difference.
 *
 * @module
 */

export { dummyAgent, echoTurn, scriptedTurns } from '../lib/dummy-agent.ts'
export type {
  DummyAgentOptions,
  DummyReply,
  DummyScript,
  DummyToolCall,
  DummyTurn,
} from '../lib/dummy-agent.ts'

export type { Agent, AgentInput, AgentTool, AgentToolContext } from '../lib/agent.ts'
