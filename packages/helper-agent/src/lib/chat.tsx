/**
 * The chat panel.
 *
 * A `@remix-run/ui` component over a {@link HelperAgentSession}, and nothing more: it subscribes to
 * the session's `change` event, renders the transcript it exposes, and calls `send`. All of the
 * conversation's behaviour is next door in `session.ts`, so an app that wants a chat of its own
 * shape takes the session and leaves this behind.
 *
 * It subscribes from a queued task rather than from setup, which looks like a detail and is not:
 * setup also runs on a server, where `handle.signal` is a stand-in rather than a real
 * `AbortSignal`, and handing that to `addEventListener` throws while the page is being generated. A
 * queued task runs at the first client commit and nowhere else — which is also exactly when there
 * is a session worth listening to.
 *
 * Its styling is `css(...)` mixins with its own custom properties on the panel, rather than a
 * stylesheet to link or class names to match. A host that wants it to look like the rest of the
 * site sets those properties on the element it mounts into; a host that wants something else
 * entirely writes its own component.
 *
 * @module
 */

import { css, on, ref } from '@remix-run/ui'
import type { Handle, RemixNode } from '@remix-run/ui'

import type { ChatMessage, ToolCall, ToolResult } from './protocol.ts'
import type { HelperAgentSession } from './session.ts'

/** What the panel is given. */
export interface HelperAgentChatProps {
  /** The conversation to show. */
  session: HelperAgentSession
  /** The panel's heading. Defaults to `'Help'`. */
  title?: string
  /** What it says before the person has typed anything. */
  greeting?: string
  /** Placeholder for the composer. Defaults to `'Ask about this page…'`. */
  placeholder?: string
  /**
   * Called when the person asks to close the panel.
   *
   * Omit it and no close button is drawn — appropriate when the panel is part of the page rather
   * than something that opened over it.
   */
  onClose?: () => void
}

/**
 * Renders a conversation.
 *
 * @param handle The session to show, and how it is framed
 * @returns The panel
 *
 * @example
 * ```tsx
 * <HelperAgentChat session={session} title="Help" greeting="Ask me how anything here works." />
 * ```
 */
export function HelperAgentChat(handle: Handle<HelperAgentChatProps>): () => RemixNode {
  let composer: HTMLTextAreaElement | null = null
  let log: HTMLElement | null = null

  handle.queueTask(() => {
    handle.props.session.addEventListener('change', () => {
      // Re-render, then put the newest message in view — `update()` resolves after the commit, so
      // by the time this runs the element that has to be scrolled to exists.
      handle.update().then(() => log?.scrollTo({ top: log.scrollHeight }))
    }, { signal: handle.signal })
  })

  function submit() {
    if (composer === null) return
    let text = composer.value
    composer.value = ''
    handle.props.session.send(text)
  }

  return () => {
    let { session, title = 'Help', greeting, placeholder = 'Ask about this page…' } = handle.props
    let results = resultsById(session.messages)

    return (
      <section mix={panelStyle} aria-label={title}>
        <header mix={headerStyle}>
          <h2 mix={titleStyle}>{title}</h2>
          {handle.props.onClose
            ? (
              <button
                type='button'
                aria-label='Close'
                mix={[iconButtonStyle, on('click', () => handle.props.onClose?.())]}
              >
                ✕
              </button>
            )
            : null}
        </header>

        <ol
          mix={[logStyle, ref<HTMLElement>((element) => log = element)]}
          aria-live='polite'
          aria-busy={session.busy ? 'true' : 'false'}
        >
          {greeting !== undefined && session.messages.length === 0
            ? <Bubble role='assistant'>{greeting}</Bubble>
            : null}

          {session.messages.map((message, index) => (
            <Message key={index} message={message} results={results} />
          ))}

          {session.status === 'streaming' && !hasFreshText(session.messages)
            ? <li mix={noticeStyle}>…</li>
            : null}

          {session.error !== null ? <li mix={errorStyle}>{session.error}</li> : null}
        </ol>

        <form
          mix={[
            composerStyle,
            on('submit', (event) => {
              event.preventDefault()
              submit()
            }),
          ]}
        >
          <textarea
            rows={2}
            placeholder={placeholder}
            aria-label={placeholder}
            mix={[
              textareaStyle,
              ref<HTMLTextAreaElement>((element) => composer = element),
              // Enter sends and Shift+Enter breaks the line, which is what every chat does and
              // what a `<textarea>` does the other way round by default.
              on('keydown', (event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
                event.preventDefault()
                submit()
              }),
            ]}
          >
          </textarea>
          {session.busy
            ? (
              <button
                type='button'
                mix={[sendStyle, on('click', () => session.stop())]}
              >
                Stop
              </button>
            )
            : <button type='submit' mix={sendStyle}>Send</button>}
        </form>
      </section>
    )
  }
}

/** One message, or nothing for the `tool` messages whose results are drawn beside their calls. */
function Message(
  handle: Handle<{ message: ChatMessage; results: ReadonlyMap<string, ToolResult> }>,
): () => RemixNode {
  return () => {
    let { message, results } = handle.props

    if (message.role === 'user') return <Bubble role='user'>{message.content}</Bubble>
    if (message.role === 'tool') return null

    return (
      <>
        {message.content !== '' ? <Bubble role='assistant'>{message.content}</Bubble> : null}
        {(message.toolCalls ?? []).map((call) => (
          <ToolLine key={call.id} call={call} result={results.get(call.id)} />
        ))}
      </>
    )
  }
}

/** A tool call, and how it went. */
function ToolLine(handle: Handle<{ call: ToolCall; result?: ToolResult }>): () => RemixNode {
  return () => {
    let { call, result } = handle.props
    let mark = result === undefined ? '⋯' : result.isError ? '✕' : '✓'

    return (
      <li mix={toolStyle}>
        <span aria-hidden='true'>{mark}</span> <code>{call.name}</code>
        {result?.isError ? <span mix={toolErrorStyle}>{result.content}</span> : null}
      </li>
    )
  }
}

/** A line of the conversation. */
function Bubble(
  handle: Handle<{ role: 'user' | 'assistant'; children: RemixNode }>,
): () => RemixNode {
  return () => (
    <li mix={[bubbleStyle, handle.props.role === 'user' ? userStyle : assistantStyle]}>
      {handle.props.children}
    </li>
  )
}

/** Every tool result in the transcript, by the id of the call it answers. */
function resultsById(messages: readonly ChatMessage[]): ReadonlyMap<string, ToolResult> {
  let byId = new Map<string, ToolResult>()
  for (let message of messages) {
    if (message.role === 'tool') { for (let result of message.results) byId.set(result.id, result) }
  }
  return byId
}

/**
 * Whether the turn arriving has said anything yet.
 *
 * What decides between showing the waiting mark and showing nothing: the transcript already ends
 * with the assistant message being streamed, so an empty one means the request is out and the first
 * word has not landed.
 */
function hasFreshText(messages: readonly ChatMessage[]): boolean {
  let last = messages.at(-1)
  return last?.role === 'assistant' && last.content !== ''
}

// --- styles -----------------------------------------------------------------

/**
 * The panel, and the properties a host overrides to restyle it.
 *
 * Custom properties rather than options, because they cascade: setting `--helper-agent-accent` on
 * the element the panel is mounted into, or on `:root`, reaches it without this component having an
 * opinion about theming. The fallbacks below are what it looks like when nobody sets any of them.
 */
const panelStyle = css({
  '--helper-agent-bg': 'Canvas',
  '--helper-agent-fg': 'CanvasText',
  '--helper-agent-muted': 'color-mix(in srgb, CanvasText 55%, Canvas)',
  '--helper-agent-border': 'color-mix(in srgb, CanvasText 20%, Canvas)',
  '--helper-agent-accent': 'AccentColor',
  '--helper-agent-on-accent': 'AccentColorText',
  '--helper-agent-radius': '0.75rem',

  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  font: 'inherit',
  color: 'var(--helper-agent-fg)',
  background: 'var(--helper-agent-bg)',
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid var(--helper-agent-border)',
})

const titleStyle = css({ font: 'inherit', fontWeight: 600, margin: 0 })

const iconButtonStyle = css({
  font: 'inherit',
  lineHeight: 1,
  cursor: 'pointer',
  padding: '0.25rem 0.5rem',
  border: 0,
  borderRadius: 'var(--helper-agent-radius)',
  background: 'transparent',
  color: 'var(--helper-agent-muted)',
  '&:hover': { color: 'var(--helper-agent-fg)' },
})

const logStyle = css({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  listStyle: 'none',
  margin: 0,
  padding: '1rem',
})

const bubbleStyle = css({
  maxWidth: '85%',
  padding: '0.5rem 0.75rem',
  borderRadius: 'var(--helper-agent-radius)',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
})

const userStyle = css({
  alignSelf: 'flex-end',
  background: 'var(--helper-agent-accent)',
  color: 'var(--helper-agent-on-accent)',
})

const assistantStyle = css({
  alignSelf: 'flex-start',
  border: '1px solid var(--helper-agent-border)',
})

const toolStyle = css({
  alignSelf: 'flex-start',
  fontSize: '0.85em',
  color: 'var(--helper-agent-muted)',
})

const toolErrorStyle = css({ color: 'color-mix(in srgb, red 60%, CanvasText)' })

const noticeStyle = css({ alignSelf: 'flex-start', color: 'var(--helper-agent-muted)' })

const errorStyle = css({
  alignSelf: 'stretch',
  fontSize: '0.9em',
  padding: '0.5rem 0.75rem',
  borderRadius: 'var(--helper-agent-radius)',
  border: '1px solid color-mix(in srgb, red 40%, transparent)',
  color: 'color-mix(in srgb, red 60%, CanvasText)',
})

const composerStyle = css({
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'flex-end',
  padding: '0.75rem 1rem',
  borderTop: '1px solid var(--helper-agent-border)',
})

const textareaStyle = css({
  flex: 1,
  font: 'inherit',
  resize: 'none',
  color: 'inherit',
  background: 'transparent',
  padding: '0.5rem',
  border: '1px solid var(--helper-agent-border)',
  borderRadius: 'var(--helper-agent-radius)',
})

const sendStyle = css({
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '0.5rem 1rem',
  border: 0,
  borderRadius: 'var(--helper-agent-radius)',
  background: 'var(--helper-agent-accent)',
  color: 'var(--helper-agent-on-accent)',
})
