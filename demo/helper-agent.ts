/// <reference lib="dom" />

import { createRouter } from '@remix-run/fetch-router'
import { helperAgentController } from '@remix-kbn/helper-agent/controller'
import type { AgentTool } from '@remix-kbn/helper-agent/controller'
import { dummyAgent, scriptedTurns } from '@remix-kbn/helper-agent/agent/dummy'
import type { DummyScript } from '@remix-kbn/helper-agent/agent/dummy'
import {
  type ClientTool,
  type HelperAgentPanel,
  openHelperAgent,
} from '@remix-kbn/helper-agent/client'

// GitHub Pages has no server, so the controller runs here, on a router in the page, with the
// scripted agent behind it. The panel, the wire protocol and both kinds of tool round trip are the
// real thing; only the model is missing.

/** A tool the controller runs, where a real deployment keeps its credentials. */
const reportBug: AgentTool = {
  name: 'report_bug',
  description: 'Files a bug report against this site. Returns the report URL.',
  inputSchema: {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  },
  run: (input) => {
    const { title } = input as { title?: unknown }
    const slug = String(title ?? 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    return `Filed (not really — this is a demo) as https://example.com/issues/${slug}`
  },
}

/** A tool the browser runs: it can see the page the question is about. */
const whereAmI: ClientTool = {
  name: 'where_am_i',
  description: 'The page the person is looking at, as a path and a heading.',
  inputSchema: { type: 'object', properties: {} },
  run: () => `${location.pathname} — ${document.querySelector('h1')?.textContent ?? ''}`,
}

/** What to say once tools have answered, or when nothing matched. */
const afterTools: DummyScript = (input) => {
  const last = input.messages.at(-1)
  if (last?.role !== 'tool') {
    return {
      text:
        'This chat runs on the dummy agent, so there is no model behind it. Try "where am I?", ' +
        '"which one?" (or the ⌖ button), or "something is broken".',
    }
  }
  const result = last.results[0]
  if (result.isError) return { text: `That did not work: ${result.content}` }
  return { text: result.content }
}

const replies = scriptedTurns([
  {
    match: /bug|broken|壊れ|バグ/i,
    turn: {
      text: 'Filing that for you. ',
      toolCalls: [{ name: 'report_bug', input: { title: 'Something is broken' } }],
    },
  },
  {
    match: /where|page|どこ|ページ/i,
    turn: { text: 'Let me look. ', toolCalls: [{ name: 'where_am_i' }] },
  },
  {
    match: /which|pick|point|どれ|指/i,
    turn: {
      text: 'Click the element you mean on the page (Esc to cancel). ',
      toolCalls: [{ name: 'pick_element' }],
    },
  },
], afterTools)

const router = createRouter()
router.post(
  '/helper-agent',
  helperAgentController(dummyAgent({ script: replies, tools: [reportBug] })),
)

export function setupHelperAgentDemo(): void {
  const button = document.getElementById('helper-agent-open') as HTMLButtonElement
  let panel: HelperAgentPanel | null = null

  button.addEventListener('click', () => {
    if (panel === null) {
      panel = openHelperAgent({
        transport: { url: '/helper-agent', fetch: (request) => router.fetch(request) },
        tools: [whereAmI],
        pickElementTool: true,
        title: 'Help',
        greeting: 'Ask "where am I?", "which one?", or tell me something is broken.',
      })
      return
    }
    if (panel.open) panel.close()
    else panel.show()
  })
}
