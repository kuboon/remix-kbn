# remix-helper-agent

An in-page support assistant for a [`remix/fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router) app: a chat panel the host opens from its own button, a route that answers it, and an agent behind that which can answer questions about the site and file a bug report from inside the conversation.

It is three pieces that snap together and can each be replaced:

```
/client  ←──── POST, SSE ────→  /controller  ←──── Agent ────→  /agent/claude
(the panel, in the browser)     (one route)                     /agent/dummy
```

- **`/client`** holds the conversation and draws it. It is [`@kuboon/chat-element`](https://jsr.io/@kuboon/chat-element) — a custom element with no Remix in it — under this package's names. Its transport is a `fetch`, not a URL, so the thing answering does not have to be a server.
- **`/controller`** is one `POST` route. It keeps nothing between requests.
- **`/agent/claude`** answers through the Anthropic Messages API. **`/agent/dummy`** answers from a script.

## Features

- **Tool use on both sides** — tools the controller runs where the credentials are (file the bug report, search the docs) and tools the browser runs on the page the question is about (which screen is this, what is in the form). The model is not told which is which.
- **Streaming** — `text/event-stream`, with the header that stops nginx buffering it into one block at the end.
- **Stateless** — the browser holds the transcript and posts it each turn, so the controller runs anywhere: a serverless function, a long-lived server, or a router inside the page.
- **Testable without a model** — `agent/dummy` is a real agent, so the client, the protocol and the tool round trip are exercised with no key, no network and no bill.
- **Pointing at the page** — a button beside the composer lets the person click the element they mean instead of describing it. Only its CSS path is sent, never its contents. The model can ask for the same through a tool.
- **The host owns the button** — this package draws the panel, not the thing that opens it.

## Installation

This package is published to [JSR](https://jsr.io/@remix-kbn/helper-agent):

```sh
deno add jsr:@remix-kbn/helper-agent npm:@remix-run/fetch-router
deno add npm:@anthropic-ai/sdk   # only if you serve agent/claude
```

For Node:

```sh
npx jsr add @remix-kbn/helper-agent
npm install @remix-run/fetch-router @anthropic-ai/sdk
```

## Usage

### The server half

```ts
import { createRouter } from '@remix-run/fetch-router'
import { helperAgentController } from '@remix-kbn/helper-agent/controller'
import { claudeAgent } from '@remix-kbn/helper-agent/agent/claude'

let agent = claudeAgent({
  system: [
    'You help people use example.com.',
    'Settings live under the avatar menu. Exports are generated overnight.',
    'If you do not know, say so and offer to file a report.',
  ].join('\n'),
})

let router = createRouter()
router.post('/helper-agent', helperAgentController(agent))
```

`router.post` rather than `router.map`: the conversation is the body, and every other method gets a `405` from the router for free.

### The browser half

```ts
import { openHelperAgent } from '@remix-kbn/helper-agent/client'

let panel = openHelperAgent({
  transport: '/helper-agent',
  title: 'Help',
  greeting: 'Ask me how anything here works.',
  pickElementTool: true,
})

document.querySelector('#help')!.addEventListener('click', () => {
  panel.open ? panel.close() : panel.show()
})
```

Open it once and keep the handle: the conversation lives in the session behind it, so `show()` and `close()` are a toggle and a second `openHelperAgent()` is a second conversation.

For a chat inside your own layout, take the two pieces under it instead — `HelperAgentSession` is the conversation on its own, and `createChatPanel` makes a `<chat-panel>` element over one:

```ts
import { createChatPanel, HelperAgentSession } from '@remix-kbn/helper-agent/client'

let session = new HelperAgentSession({ transport: '/helper-agent' })
let panel = createChatPanel(session)
panel.heading = 'Help'
sidebar.append(panel)
```

It is a plain custom element, so it goes anywhere a `<div>` does — a Remix component, a server-rendered page, a static one.

### Pointing at the page

The ⌖ button beside the composer lets the person click the element they are asking about. What is under the pointer is outlined, the click is swallowed rather than pressed, `Escape` cancels, and the element's CSS path (`#settings > button:nth-of-type(2)`) lands in the composer, where they can see it before sending.

**Only the path is sent** — no text, no form values. Whatever the model needs to know about the element after that is a tool's to read, under the page's own rules.

`pickElementTool: true` offers the same to the model as a `pick_element` tool, so it can ask "which one?" itself. `pickElement()` and `elementPath()` are exported for a tool of your own.

## Tools

A tool is declared the same way wherever it runs, and the model is never told which side is which. What differs is who holds it.

### Tools the controller runs

These go on the agent, and run where the credentials are. This is where the bug report belongs:

```ts
import type { AgentTool } from '@remix-kbn/helper-agent/controller'

let reportBug: AgentTool = {
  name: 'report_bug',
  description:
    'Files a bug report against this site. Use it when the person has described something ' +
    'broken and has confirmed they want it reported. Returns the report URL.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'One line, in the words the person used' },
      body: { type: 'string', description: 'What they did, what happened, what they expected' },
      page: { type: 'string', description: 'The path they were on, if known' },
    },
    required: ['title', 'body'],
  },
  run: async (input) => {
    let { title, body, page } = input as { title: string; body: string; page?: string }
    let issue = await openIssue({ title, body: `${body}\n\nPage: ${page ?? 'unknown'}` })
    return `Filed as ${issue.url}`
  },
}

let agent = claudeAgent({ system: '…', tools: [reportBug] })
```

`input` is whatever the model produced, from a conversation a stranger was half of — check it rather than destructuring it. Throwing is how a tool reports that it could not run; the failure goes back to the model, which can say so or try something else.

### Tools the browser runs

These go on the session, and can see the page the question is about:

```ts
import type { ClientTool } from '@remix-kbn/helper-agent/client'

let whereAmI: ClientTool = {
  name: 'where_am_i',
  description: 'The page the person is looking at, as a path and a heading.',
  inputSchema: { type: 'object', properties: {} },
  run: () => `${location.pathname} — ${document.querySelector('h1')?.textContent ?? ''}`,
}

openHelperAgent({ transport: '/helper-agent', tools: [whereAmI] })
```

They are declared to the controller per request and never stored there, so a page offers only what it can actually do — a tool that fills in the settings form has nothing to offer from the blog.

The round trip costs one extra request: the controller emits the call and ends the turn, the session runs the tool, appends the result and asks for the next turn. Everything else about it is the same.

## Testing, and running the whole chat on a static host

`agent/dummy` answers from a script, and the controller is an ordinary request handler, so the entire chat runs in one process:

```ts
import { createRouter } from '@remix-run/fetch-router'
import { helperAgentController } from '@remix-kbn/helper-agent/controller'
import { dummyAgent, scriptedTurns } from '@remix-kbn/helper-agent/agent/dummy'
import { HelperAgentSession } from '@remix-kbn/helper-agent/client'

let router = createRouter()
router.post(
  '/helper-agent',
  helperAgentController(dummyAgent({
    wordDelay: 0,
    script: scriptedTurns([
      { match: /price|cost/i, turn: { text: 'Everything here is free.' } },
      { match: 'where', turn: { toolCalls: [{ name: 'where_am_i' }] } },
    ]),
  })),
)

let session = new HelperAgentSession({
  transport: { url: 'http://localhost/helper-agent', fetch: (request) => router.fetch(request) },
  tools: [whereAmI],
})

await session.send('what page am I on?')
```

The same arrangement is how a static host serves a working chat. On GitHub Pages there is no server, so there is nowhere to keep an API key — but a `@remix-run/spa` app already runs a real router in the browser, and the transport takes a `fetch`. Mount the controller on the client router, put `dummyAgent` behind it, and the panel, the wire protocol and the tool round trip all work with nothing behind the origin:

```ts
// The app's own client router, or one created just for this — the session calls `fetch()` on it
// directly, so it is never a navigation and never reaches the runtime's link handling.
let helper = createRouter()
helper.post('/helper-agent', helperAgentController(dummyAgent({ script })))

openHelperAgent({
  transport: { url: '/helper-agent', fetch: (request) => helper.fetch(request) },
  tools: [whereAmI],
})
```

What you cannot demonstrate there is the model; everything else is the real thing.

## API

### `/controller`

#### `helperAgentController(agent, options?): RequestHandler`

The route. `agent` is an `Agent`, or a function from the request context to one — take the second form when the agent's tools need something only the request knows.

- `maxMessages` — how many messages a transcript may carry (default `100`).
- `maxBytes` — how large the body may be (default `1_048_576`).
- `beforeTurn(request, context)` — runs before the agent. Return the request, changed or not, to continue; return a `Response` to answer with that instead. This is where authentication, rate limiting, and any check on a transcript that arrived from a browser go.

#### `Agent`

```ts
interface Agent {
  respond(input: AgentInput): AsyncIterable<AgentEvent>
}
```

One method: continue the conversation, stream what happens. Implementing it is how another provider gets plugged in.

### `/client`

Re-exports of [`@kuboon/chat-element`](https://jsr.io/@kuboon/chat-element) under this package's names; its README has the rest.

#### `openHelperAgent(options): HelperAgentPanel`

A `<dialog>` with a `<chat-panel>` in it. Takes everything `HelperAgentSession` does, plus `title`, `greeting`, `placeholder`, `pickElementTool` (default `false`), `modal` (default `false`) and `container` (default `document.body`). Returns `{ session, dialog, panel, open, show(), close(), dispose() }`.

Non-modal by default: a chat explaining how to use a screen is a chat the person has to be able to use the screen alongside — and point at.

#### `new HelperAgentSession(options)`

The conversation. An `EventTarget` that fires `change` whenever anything observable moves.

- `transport` — a path or URL, or `{ url, fetch }` to have something other than the network answer it.
- `tools` — what this page can run.
- `maxRounds` — how many times a turn may come back asking for them (default `4`).

Exposes `messages`, `status`, `error`, `busy`, and `send(text)`, `stop()`, `reset()`.

#### `createChatPanel(session): ChatPanelElement`

A `<chat-panel>` over a session. Properties (and attributes): `heading`, `greeting`, `placeholder`, `closable` (fires `close`), `picker` (the ⌖ button; off with `no-picker`), `labels`.

`http(s)` URLs in a reply are rendered as links, which is most of what support is: pointing at the page with the setting on it, the article that explains it, the report a tool just drafted. Nothing else is linkified — a `javascript:` URL is a word here, not a URL — and a tool should return a URL rather than try to open a tab, since by the time it runs there is no user gesture left and the browser blocks it.

It styles itself from custom properties — `--chat-panel-bg`, `--chat-panel-fg`, `--chat-panel-muted`, `--chat-panel-border`, `--chat-panel-accent`, `--chat-panel-on-accent`, `--chat-panel-radius`. Set them on `:root` or on any element above the panel, and it follows the site.

#### `pickElement(options?)`, `elementPath(element)`, `pickElementTool(options?)`

Letting the person point at an element, describing it as a CSS path, and offering that to the model as a tool.

### `/agent/claude`

#### `claudeAgent(options): Agent`

- `system` — required. Who the assistant is, what site it is on, what it knows and what it must not claim. This is the biggest lever on whether the thing is useful.
- `tools` — the ones it runs itself.
- `model` (default `'claude-opus-5'`), `maxTokens` (default `8192`), `maxRounds` (default `8`).
- `client` — an `Anthropic` instance. The default resolves the key from `ANTHROPIC_API_KEY`.
- `request` — anything else to put on the request (`thinking`, `effort`, a server tool in `tools`), merged over what the agent builds.

### `/agent/dummy`

#### `dummyAgent(options): Agent`

- `script` — a `DummyScript`, called again after its own tools have run. Defaults to `echoTurn`.
- `tools` — the ones it runs itself.
- `wordDelay` (default `15`; pass `0` in tests), `maxRounds` (default `4`).

`scriptedTurns(replies, fallback?)` builds a script from `{ match, turn }` entries; `echoTurn` is the default script, which says what it was given and what tools the page offered.

## How a turn works

The browser posts the whole transcript and the tools this page can run. The controller streams back what happens:

| Event         | Meaning                                                         |
| ------------- | --------------------------------------------------------------- |
| `text`        | A delta to append                                               |
| `tool-call`   | A call has been made                                            |
| `tool-result` | One the controller ran itself                                   |
| `state`       | The agent's own record of the turn, to be echoed back untouched |
| `done`        | `end`, `tools`, `max-tokens` or `refusal`                       |
| `error`       | The turn failed after the response had started                  |

Exactly one of `done` / `error` ends a turn. `done: 'tools'` means the model asked for something only the browser can run: the session runs it, appends the result, and posts again.

One turn can hold several assistant messages, because a tool the controller runs is answered inside the turn and the model then says something about it. Where one message ends and the next begins is not announced — it follows from the events, by three rules the client applies every time: a `tool-result` closes the assistant message whose call it answers, `text` after a result starts the next assistant message, and `done` closes whatever is open.

## What this does not do

- **It does not keep the conversation.** The browser does, and posts it back each turn. That is what makes the controller run anywhere, and it means the transcript arriving at the controller is one the person on the other end could have edited — `beforeTurn` is where to care about that, and a tool's input is to be checked rather than trusted.
- **It does not authenticate anybody.** A route with a model behind it is a route someone will run up a bill on. Put the check in `beforeTurn`, or in middleware ahead of it.
- **It does not open the panel.** Where the button goes, what it looks like, and when the chat appears are the host app's, deliberately.

## Related Packages

- [`fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router) — the router the controller mounts on
- [`@kuboon/chat-element`](https://jsr.io/@kuboon/chat-element) — the panel, the session and the wire format
- [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) — what `agent/claude` talks through

## License

See [LICENSE](./LICENSE)
