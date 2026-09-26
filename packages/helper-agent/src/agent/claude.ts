/**
 * The agent that answers through the Anthropic Messages API.
 *
 * Give it a system prompt saying what site it is on and what it knows, and the tools it should be
 * able to run where the credentials are; hand the result to `helperAgentController`.
 *
 * `@anthropic-ai/sdk` is only imported from here, so a deployment that serves `agent/dummy` never
 * loads it.
 *
 * @module
 */

export { claudeAgent } from '../lib/claude-agent.ts'
export type { ClaudeAgentOptions } from '../lib/claude-agent.ts'

export type { Agent, AgentInput, AgentTool, AgentToolContext } from '../lib/agent.ts'
