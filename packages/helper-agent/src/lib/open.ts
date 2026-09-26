/**
 * Putting the panel on the screen, for the host that just wants a button.
 *
 * Opening the chat is the host app's job — where the button goes, what it looks like, whether it is
 * in the header or floating in a corner, are all things this package should stay out of. What it
 * can usefully do is the part after the click, which is the same everywhere: a `<dialog>` in the
 * top layer, a root rendered into it, and a handle to open and close it again.
 *
 * Non-modal by default, deliberately. A support chat explaining how to use a screen is a chat the
 * person has to be able to use the screen alongside; `showModal()` puts an inert backdrop over the
 * very thing being explained. Pass `modal` when the chat *is* the task.
 *
 * Call it once and keep the handle. The conversation lives in the session behind it, so a second
 * call is a second conversation — `close()` and `open()` are how the button toggles the one that is
 * already there.
 *
 * @module
 */

import { createElement, createRoot } from '@remix-run/ui'

import { HelperAgentChat } from './chat.tsx'
import { HelperAgentSession } from './session.ts'
import type { HelperAgentSessionOptions } from './session.ts'

/** Options for {@link openHelperAgent}. */
export interface OpenHelperAgentOptions extends HelperAgentSessionOptions {
  /** The panel's heading. Defaults to `'Help'`. */
  title?: string
  /** What it says before the person has typed anything. */
  greeting?: string
  /** Placeholder for the composer. */
  placeholder?: string
  /**
   * An existing conversation to show, instead of starting one.
   *
   * When it is given, the transport and tool options are ignored — the session already has them.
   */
  session?: HelperAgentSession
  /**
   * Show it modally, over an inert page. Defaults to `false`.
   *
   * Modal buys `Escape` to dismiss and a focus trap, and costs the ability to touch the page the
   * chat is about.
   */
  modal?: boolean
  /** Where the `<dialog>` goes. Defaults to `document.body`. */
  container?: HTMLElement
}

/** The panel, once it is on the screen. */
export interface HelperAgentPanel {
  /** The conversation. Keep it across open and close; that is what makes the button a toggle. */
  readonly session: HelperAgentSession
  /** The element it is drawn in, for a host that wants to position or restyle it. */
  readonly dialog: HTMLDialogElement
  /** Whether it is showing. */
  readonly open: boolean
  /** Shows it. */
  show(): void
  /** Hides it, keeping the conversation. */
  close(): void
  /** Hides it, tears down the root, and removes the element. */
  dispose(): void
}

/**
 * Opens the chat panel.
 *
 * @param options Where the controller is, what this page can do, and how the panel is framed
 * @returns The handle, for the button to toggle
 *
 * @example
 * ```ts
 * let panel = openHelperAgent({ transport: '/helper-agent', tools: [whereAmI] })
 * button.addEventListener('click', () => panel.open ? panel.close() : panel.show())
 * ```
 */
export function openHelperAgent(options: OpenHelperAgentOptions): HelperAgentPanel {
  let { title, greeting, placeholder, modal = false, container = document.body } = options
  let session = options.session ?? new HelperAgentSession(options)

  let dialog = document.createElement('dialog')
  dialog.style.cssText = modal ? MODAL_STYLE : PANEL_STYLE
  container.appendChild(dialog)

  let root = createRoot(dialog)
  let panel: HelperAgentPanel = {
    session,
    dialog,
    get open() {
      return dialog.open
    },
    show() {
      if (dialog.open) return
      if (modal) dialog.showModal()
      else dialog.show()
    },
    close() {
      if (dialog.open) dialog.close()
    },
    dispose() {
      panel.close()
      root.dispose()
      dialog.remove()
    },
  }

  // `createElement` rather than JSX: this file builds one node and has nothing else to gain from
  // a JSX pragma, and a `.ts` file is one fewer thing for a bundler to be configured about.
  root.render(
    createElement(HelperAgentChat, {
      session,
      title,
      greeting,
      placeholder,
      onClose: () => panel.close(),
    }),
  )

  panel.show()
  return panel
}

/** A corner panel: over the page, but not on top of it. */
const PANEL_STYLE = [
  'position: fixed',
  'inset: auto 1rem 1rem auto',
  'width: min(24rem, calc(100vw - 2rem))',
  'height: min(32rem, calc(100vh - 2rem))',
  'max-width: none',
  'max-height: none',
  'padding: 0',
  'border: 1px solid color-mix(in srgb, CanvasText 20%, Canvas)',
  'border-radius: 0.75rem',
  'box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.2)',
  'overflow: hidden',
].join('; ')

/** The modal variant: centred, with the page inert behind it. */
const MODAL_STYLE = [
  'width: min(36rem, calc(100vw - 2rem))',
  'height: min(40rem, calc(100vh - 2rem))',
  'max-width: none',
  'max-height: none',
  'padding: 0',
  'border: 1px solid color-mix(in srgb, CanvasText 20%, Canvas)',
  'border-radius: 0.75rem',
  'overflow: hidden',
].join('; ')
