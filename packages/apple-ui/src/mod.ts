/**
 * Where the window is: tall or wide, and on the left or right half of the screen.
 *
 * That is all an adaptive layout needs to decide where its chrome goes. A tall window puts the tab
 * bar along the bottom, where a thumb reaches it. A wide one puts it down a side, and the side
 * follows the window: a window on the left half of the screen gets its bar on the left edge, one on
 * the right half on the right edge, so two windows side by side keep their bars at the outer edges.
 *
 * ```ts
 * import { screenLayout, watchScreenLayout } from '@remix-kbn/apple-ui'
 *
 * screenLayout() // { orientation: 'landscape', side: 'left' }
 *
 * watchScreenLayout((layout) => render(layout), { signal })
 * ```
 *
 * @module
 */

/** `portrait` when the window is taller than it is wide, `landscape` otherwise. */
export type Orientation = 'portrait' | 'landscape'

/** Which half of the physical screen the window starts on. */
export type Side = 'left' | 'right'

/** Where the window is. */
export interface ScreenLayout {
  readonly orientation: Orientation
  readonly side: Side
}

/** The numbers a layout is decided from, as a window reports them. */
export interface ScreenMetrics {
  /** The window's viewport width (`innerWidth`). */
  readonly width: number
  /** The window's viewport height (`innerHeight`). */
  readonly height: number
  /** The width of the whole physical display (`screen.width`). */
  readonly screenWidth: number
  /** The window's left edge on that display (`screenX`). */
  readonly screenX: number
}

/** What a layout is without a window to measure: a phone held upright. */
export const DEFAULT_LAYOUT: ScreenLayout = { orientation: 'portrait', side: 'left' }

/**
 * Decides a layout from measurements. Pure, so it can be tested and used on numbers that came
 * from somewhere other than a window.
 *
 * A square window counts as landscape. A window whose left edge is exactly at the middle of the
 * screen counts as the right half.
 *
 * @param metrics The window's size and position
 * @returns The layout
 */
export function layoutOf(metrics: ScreenMetrics): ScreenLayout {
  return {
    orientation: metrics.height > metrics.width ? 'portrait' : 'landscape',
    side: metrics.screenX < metrics.screenWidth / 2 ? 'left' : 'right',
  }
}

/**
 * Measures a window.
 *
 * @param win The window. Defaults to the global one
 * @returns Its metrics, or `undefined` where there is no window (on the server)
 */
export function screenMetrics(
  win: Window | undefined = globalThis.window,
): ScreenMetrics | undefined {
  if (!win) return undefined
  return {
    width: win.innerWidth,
    height: win.innerHeight,
    screenWidth: win.screen.width,
    // screenLeft is the older name, still the only one some browsers fill in.
    screenX: win.screenX || win.screenLeft || 0,
  }
}

/**
 * The current window's layout.
 *
 * @param win The window. Defaults to the global one
 * @returns Its layout, or {@link DEFAULT_LAYOUT} where there is no window (on the server)
 */
export function screenLayout(win: Window | undefined = globalThis.window): ScreenLayout {
  const metrics = screenMetrics(win)
  return metrics ? layoutOf(metrics) : DEFAULT_LAYOUT
}

/** Whether two layouts are the same. */
export function layoutsEqual(a: ScreenLayout, b: ScreenLayout): boolean {
  return a.orientation === b.orientation && a.side === b.side
}

/** Options for {@link watchScreenLayout}. */
export interface WatchScreenLayoutOptions {
  /** Stops watching when aborted. */
  readonly signal?: AbortSignal
  /** The window. Defaults to the global one. */
  readonly window?: Window
  /**
   * How often, in milliseconds, to check whether the window has moved. Defaults to `1000`; `0`
   * turns it off.
   *
   * A resize fires an event, so orientation changes are seen at once. Moving a window to the other
   * half of the screen fires nothing, so the side can only be noticed by looking.
   */
  readonly pollInterval?: number
}

/**
 * Calls `callback` whenever the layout changes. It is not called for the current layout: read
 * that from the return value.
 *
 * @param callback Gets the new layout
 * @param options When to stop, and how often to look for a moved window
 * @returns The layout now
 */
export function watchScreenLayout(
  callback: (layout: ScreenLayout) => void,
  options: WatchScreenLayoutOptions = {},
): ScreenLayout {
  const win = options.window ?? globalThis.window
  let current = screenLayout(win)
  if (!win || options.signal?.aborted) return current

  const check = () => {
    const next = screenLayout(win)
    if (layoutsEqual(next, current)) return
    current = next
    callback(next)
  }

  win.addEventListener('resize', check, { signal: options.signal })
  win.screen.orientation?.addEventListener('change', check, { signal: options.signal })
  const pollInterval = options.pollInterval ?? 1000
  if (pollInterval > 0) {
    const timer = setInterval(check, pollInterval)
    options.signal?.addEventListener('abort', () => clearInterval(timer), { once: true })
  }
  return current
}
