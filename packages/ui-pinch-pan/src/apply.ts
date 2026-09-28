/**
 * Running the gesture: a transform in, something on screen out.
 *
 * The other half. The recognizer decides what the view should become and stops there; an applier
 * is what makes that visible, and which one runs is the caller's choice. `style.transform` is the
 * default because it is what most viewers want, but it is one function among several rather than
 * something baked into the mixin — a canvas redraws, a WebGL view sets a uniform, a component that
 * already owns its rendering just records the numbers.
 *
 * An applier is a plain function called on every change. There is no attach or dispose step, and
 * that is deliberate: everything one needs arrives with the call, so writing another is writing a
 * function rather than implementing an interface, and two of them compose by being called one
 * after the other.
 *
 * @module
 */

import type { Transform } from './transform.ts'
import { transformToCss } from './transform.ts'

/** What an applier is told, besides the transform. */
export interface TransformTarget {
  /** The element that listens for the gesture. */
  readonly host: Element
  /** The element the transform is meant for, as `PinchPanOptions.content` resolved it. */
  readonly content: Element
  /** Aborted when the host leaves the document, for an applier that starts something. */
  readonly signal: AbortSignal
}

/**
 * Puts a transform on screen.
 *
 * Called on every change, including the first one that establishes the initial view, and called
 * synchronously — a gesture is already at the browser's frame rate, so an applier that does its
 * own scheduling is scheduling twice.
 *
 * @param transform Where the view should be
 * @param target The elements it belongs to
 */
export type TransformApplier = (transform: Transform, target: TransformTarget) => void

/** Options for {@link cssTransform}. */
export interface CssTransformOptions {
  /**
   * What to set `transform-origin` to. Defaults to `'0 0'`.
   *
   * It is set here rather than left to a stylesheet because the arithmetic depends on it: the
   * algebra that keeps a point under the fingers scales about the content's top-left, and a
   * stylesheet quietly saying `center` would put the content somewhere else on every zoom. Pass
   * `null` to take responsibility for it yourself.
   */
  readonly origin?: string | null
}

/**
 * The default: writes `style.transform` on the content element.
 *
 * @param options What to set `transform-origin` to
 * @returns An applier
 */
export function cssTransform(options: CssTransformOptions = {}): TransformApplier {
  let origin = options.origin === undefined ? '0 0' : options.origin

  return (transform, { content }) => {
    let style = (content as HTMLElement).style as CSSStyleDeclaration | undefined
    if (!style) return
    if (origin !== null) style.transformOrigin = origin
    style.transform = transformToCss(transform)
  }
}

/** Options for {@link cssVariables}. */
export interface CssVariablesOptions {
  /** The property name prefix. Defaults to `'--pinch-pan'`, giving `--pinch-pan-x` and friends. */
  readonly prefix?: string
  /** Where to set them. Defaults to the content element. */
  readonly on?: 'content' | 'host'
}

/**
 * Writes the transform as custom properties and leaves the rest to CSS.
 *
 * The other useful shape of execution, and the reason appliers are a type rather than a boolean:
 * the numbers reach the stylesheet, and what the page does with them — a `transform`, a background
 * position, a `clip-path`, a filter that gets stronger as you zoom out — stops being this
 * package's business.
 *
 * `--pinch-pan-x` and `--pinch-pan-y` carry pixels with their unit, so they drop straight into
 * `translate()`; `--pinch-pan-scale` is a bare number.
 *
 * @param options The prefix, and which element to set them on
 * @returns An applier
 *
 * @example
 * ```css
 * .content {
 *   transform-origin: 0 0;
 *   transform: translate(var(--pinch-pan-x), var(--pinch-pan-y)) scale(var(--pinch-pan-scale));
 * }
 * ```
 */
export function cssVariables(options: CssVariablesOptions = {}): TransformApplier {
  let prefix = options.prefix ?? '--pinch-pan'
  let on = options.on ?? 'content'

  return (transform, target) => {
    let style = (target[on] as HTMLElement).style as CSSStyleDeclaration | undefined
    if (!style) return
    style.setProperty(`${prefix}-x`, `${transform.x}px`)
    style.setProperty(`${prefix}-y`, `${transform.y}px`)
    style.setProperty(`${prefix}-scale`, String(transform.scale))
  }
}
