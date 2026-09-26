/**
 * Reading the gesture: input in, transforms out.
 *
 * This is the half of the package that decides *what the view should become*. It holds the fingers
 * that are down, the anchor they are measured against, and the transform reached so far, and it
 * answers each input with the transform that input produced. It never touches an element, never
 * paints, and never reads the clock — so the behaviour that is hard to get right is the behaviour
 * that is cheap to test.
 *
 * Touch and wheel go through the same two primitives, which is the point of them sharing a file
 * rather than a naming convention. A pinch zooms about the fingers' centroid and pans by how far
 * that centroid travelled; a wheel zooms about the cursor or pans by its delta. Both end up in
 * {@link zoomAt} and {@link panBy}, both clamp the same way, and both leave the view in a state the
 * other can continue from — so a laptop user can pinch the trackpad, scroll, and grab the
 * touchscreen without the view noticing.
 *
 * It does not read DOM events either: {@link GestureRecognizer.wheel} takes the numbers a
 * `WheelEvent` carries rather than the event, and pointers arrive as ids and coordinates. That is
 * what the mixin next door is for, and it is why a component that gets its input from somewhere
 * else — a test, a replay, a native bridge — can drive this directly.
 *
 * @module
 */

import {
  advanceGesture,
  anchorGesture,
  anchorMatches,
  type GestureAnchor,
  type GesturePointer,
  panBy,
  type Point,
  zoomAt,
} from './gesture.ts'
import {
  clampScale,
  IDENTITY_TRANSFORM,
  type ScaleLimits,
  type Transform,
  transformsEqual,
} from './transform.ts'

/** How a wheel is read. */
export type WheelMode =
  /**
   * The modifier decides: `Ctrl` or `⌘` zooms, anything else pans.
   *
   * The default, and the one that makes a laptop behave like a phone — a trackpad pinch *is* a
   * wheel event with `ctrlKey` set, in every browser, so this maps two-finger scroll to pan and
   * two-finger pinch to zoom without knowing anything about the hardware.
   */
  | 'auto'
  /** Every wheel zooms about the cursor, modifier or not. Map-like. */
  | 'zoom'
  /** Every wheel pans. */
  | 'pan'

/** What a wheel did, as numbers rather than as an event. */
export interface WheelInput {
  /** The cursor, in content coordinates. */
  readonly at: Point
  /** `WheelEvent.deltaX`. */
  readonly deltaX: number
  /** `WheelEvent.deltaY`. */
  readonly deltaY: number
  /**
   * `WheelEvent.deltaMode` — `0` pixels, `1` lines, `2` pages. Defaults to pixels.
   *
   * Worth passing: Firefox reports lines for a mouse wheel, and treating `3` as three pixels makes
   * the wheel do almost nothing there.
   */
  readonly deltaMode?: number
  /** `WheelEvent.ctrlKey`. In `'auto'`, what a trackpad pinch sets. */
  readonly ctrlKey?: boolean
  /** `WheelEvent.metaKey` — `⌘`, which zooms in `'auto'` alongside `Ctrl`. */
  readonly metaKey?: boolean
}

/** Where the gesture is in its life. */
export type GesturePhase =
  /** Nothing is happening, and nothing was. */
  | 'idle'
  /** This input began a gesture. */
  | 'start'
  /** A gesture is running. */
  | 'move'
  /** This input ended one. */
  | 'end'

/** What one input did. */
export interface GestureUpdate {
  /** The transform after the input. */
  readonly transform: Transform
  /** Whether it differs from the one before, by more than a pixel could show. */
  readonly changed: boolean
  /** Where the gesture is now. */
  readonly phase: GesturePhase
  /**
   * Whether the recognizer took the input.
   *
   * The caller's cue to call `preventDefault()`. Separate from {@link changed} because an input can
   * be claimed and still move nothing — a pinch held at `maxScale` is still the recognizer's, and
   * letting the page scroll under it would be worse than doing nothing.
   */
  readonly consumed: boolean
}

/** Options for {@link createGestureRecognizer}, all of them changeable later. */
export interface GestureRecognizerOptions extends ScaleLimits {
  /** Where the view starts, and where {@link GestureRecognizer.reset} returns to. */
  readonly initial?: Partial<Transform>
  /** How a wheel is read, or `false` to ignore wheels entirely. Defaults to `'auto'`. */
  readonly wheel?: WheelMode | false
  /**
   * How fast a wheel zooms, per pixel of delta. Defaults to `0.0025`.
   *
   * The factor is `exp(-delta * zoomSpeed)`, so zooming in and back out by the same delta returns
   * to the same scale. A linear factor does not, and the drift is visible within a few flicks.
   */
  readonly zoomSpeed?: number
  /** Pixels per line, for a wheel reporting `deltaMode: 1`. Defaults to `16`. */
  readonly linePixels?: number
  /** Pixels per page, for a wheel reporting `deltaMode: 2`. Defaults to `400`. */
  readonly pagePixels?: number
}

/**
 * Turns input into transforms.
 *
 * Every method answers with the {@link GestureUpdate} its input produced; nothing is emitted, so
 * there is nothing to subscribe to and nothing to unsubscribe from.
 */
export interface GestureRecognizer {
  /** The transform the view has reached. */
  readonly transform: Transform
  /** Whether a gesture is running — two fingers down, or a wheel still turning. */
  readonly gesturing: boolean
  /**
   * Replaces the options. Limits apply from the next input; the current transform is left alone.
   *
   * @param options The new options
   */
  configure(options: GestureRecognizerOptions): void
  /**
   * A finger went down.
   *
   * @param pointer The finger, in content coordinates
   * @returns What it did
   */
  pointerDown(pointer: GesturePointer): GestureUpdate
  /**
   * A finger moved.
   *
   * @param pointer The finger, in content coordinates
   * @returns What it did
   */
  pointerMove(pointer: GesturePointer): GestureUpdate
  /**
   * A finger lifted, or its pointer was cancelled.
   *
   * @param id The pointer id
   * @returns What it did
   */
  pointerEnd(id: number): GestureUpdate
  /**
   * The wheel turned.
   *
   * @param input What the wheel reported
   * @returns What it did
   */
  wheel(input: WheelInput): GestureUpdate
  /**
   * The wheel stopped turning.
   *
   * A wheel has no "up" event, so whoever owns the clock decides when a burst is over and says so
   * here. The recognizer stays free of timers, which is what keeps its behaviour reproducible.
   *
   * @returns What it did
   */
  settle(): GestureUpdate
  /**
   * Moves the view directly. Omitted fields keep their current value; the scale is clamped.
   *
   * @param next Fields to change
   * @returns What it did
   */
  set(next: Partial<Transform>): GestureUpdate
  /**
   * Returns the view to {@link GestureRecognizerOptions.initial}.
   *
   * @returns What it did
   */
  reset(): GestureUpdate
}

const DEFAULT_ZOOM_SPEED = 0.0025
const DEFAULT_LINE_PIXELS = 16
const DEFAULT_PAGE_PIXELS = 400

/**
 * Creates a recognizer.
 *
 * @param options Scale bounds, where the view starts, and how the wheel is read
 * @returns The recognizer, positioned at `initial`
 *
 * @example
 * ```ts
 * let view = createGestureRecognizer({ maxScale: 8 })
 * view.pointerDown({ id: 1, x: 0, y: 0 })
 * view.pointerDown({ id: 2, x: 100, y: 0 })
 * let { transform } = view.pointerMove({ id: 2, x: 200, y: 0 })
 * ```
 */
export function createGestureRecognizer(
  options: GestureRecognizerOptions = {},
): GestureRecognizer {
  let settings = options
  let pointers = new Map<number, GesturePointer>()
  let anchor: GestureAnchor | null = null
  let pinching = false
  let wheeling = false

  let limits = (): ScaleLimits => ({
    minScale: settings.minScale,
    maxScale: settings.maxScale,
  })

  let initial = (): Transform => {
    let from = settings.initial ?? {}
    return {
      x: from.x ?? IDENTITY_TRANSFORM.x,
      y: from.y ?? IDENTITY_TRANSFORM.y,
      scale: clampScale(from.scale ?? IDENTITY_TRANSFORM.scale, limits()),
    }
  }

  let transform = initial()

  let active = (): boolean => pinching || wheeling

  /**
   * Builds the answer, and works out the phase from what was true before.
   *
   * The phase is derived rather than assigned, so there is one definition of "a gesture is running"
   * and every input agrees with it.
   */
  let update = (next: Transform, wasActive: boolean, consumed: boolean): GestureUpdate => {
    let changed = !transformsEqual(next, transform)
    if (changed) transform = next

    let now = active()
    let phase: GesturePhase = !wasActive && now
      ? 'start'
      : wasActive && !now
      ? 'end'
      : now
      ? 'move'
      : 'idle'

    return { transform, changed, phase, consumed }
  }

  /**
   * Anchors against where the content is now.
   *
   * Called whenever the set of fingers changes, which is what stops the view jumping when a third
   * finger joins or one of three lifts: the gesture carries on from the transform the content
   * already has rather than from one measured against fingers that are no longer down.
   */
  let reanchor = () => {
    let down = [...pointers.values()]
    anchor = down.length >= 2 ? anchorGesture(down, transform) : null
  }

  /** Normalises a wheel's delta to pixels, whichever unit it arrived in. */
  let pixels = (delta: number, mode: number | undefined): number => {
    if (mode === 1) return delta * (settings.linePixels ?? DEFAULT_LINE_PIXELS)
    if (mode === 2) return delta * (settings.pagePixels ?? DEFAULT_PAGE_PIXELS)
    return delta
  }

  return {
    get transform() {
      return transform
    },

    get gesturing() {
      return active()
    },

    configure(next) {
      settings = next
    },

    pointerDown(pointer) {
      let wasActive = active()
      pointers.set(pointer.id, pointer)
      if (pointers.size >= 2) pinching = true
      reanchor()
      return update(transform, wasActive, pointers.size >= 2)
    },

    pointerMove(pointer) {
      let wasActive = active()
      if (!pointers.has(pointer.id)) return update(transform, wasActive, false)

      pointers.set(pointer.id, pointer)
      let down = [...pointers.values()]
      // A move that arrives before the anchor has caught up with the finger set is not this
      // gesture's; answering it would measure against a spread nobody made.
      if (anchor === null || !anchorMatches(anchor, down)) {
        return update(transform, wasActive, false)
      }

      return update(advanceGesture(anchor, down, limits()), wasActive, true)
    },

    pointerEnd(id) {
      let wasActive = active()
      if (!pointers.delete(id)) return update(transform, wasActive, false)
      // The gesture is over when the hand leaves, not when it drops to one finger: a finger still
      // down is someone still holding on, and putting a second one back continues rather than
      // restarts.
      if (pointers.size === 0) pinching = false
      reanchor()
      return update(transform, wasActive, true)
    },

    wheel(input) {
      let wasActive = active()
      let mode = settings.wheel ?? 'auto'
      if (mode === false) return update(transform, wasActive, false)

      let deltaX = pixels(input.deltaX, input.deltaMode)
      let deltaY = pixels(input.deltaY, input.deltaMode)

      wheeling = true

      let zooms = mode === 'zoom' ||
        (mode === 'auto' && (input.ctrlKey === true || input.metaKey === true))

      if (zooms) {
        let speed = settings.zoomSpeed ?? DEFAULT_ZOOM_SPEED
        let factor = Math.exp(-deltaY * speed)
        return update(zoomAt(transform, input.at, factor, limits()), wasActive, true)
      }

      // Scrolling down moves the content up, which is the sign a scrollbar has.
      return update(panBy(transform, -deltaX, -deltaY), wasActive, true)
    },

    settle() {
      let wasActive = active()
      wheeling = false
      return update(transform, wasActive, false)
    },

    set(next) {
      let wasActive = active()
      return update(
        {
          x: next.x ?? transform.x,
          y: next.y ?? transform.y,
          scale: clampScale(next.scale ?? transform.scale, limits()),
        },
        wasActive,
        false,
      )
    },

    reset() {
      let wasActive = active()
      return update(initial(), wasActive, false)
    },
  }
}
