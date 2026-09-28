/**
 * The mixin: the DOM half, and nothing else.
 *
 * What is left here once the arithmetic is in `gesture.ts`, the reading in `recognizer.ts` and the
 * painting in `apply.ts` is the part that genuinely needs an element — listening, pointer capture,
 * `touch-action`, measuring where the content's corner is, and the one timer in the package. Each
 * of those is a browser fact rather than a decision about how a pinch should feel, which is the
 * line the split is drawn on.
 *
 * @module
 */

import { createMixin, type ElementProps, type MixinFactory } from '@remix-run/ui'

import { cssTransform, type TransformApplier, type TransformTarget } from './apply.ts'
import type { GesturePointer, Point } from './gesture.ts'
import {
  createGestureRecognizer,
  type GestureRecognizer,
  type GestureRecognizerOptions,
  type GestureUpdate,
  type WheelMode,
} from './recognizer.ts'
import type { ScaleLimits, Transform } from './transform.ts'

/** Programmatic access to the view, handed to {@link PinchPanOptions.controls}. */
export interface PinchPanControls {
  /** The transform the content currently has. */
  readonly transform: Transform
  /**
   * Moves the view. Omitted fields keep their current value and the scale is clamped.
   *
   * @param next Fields to change
   */
  set(next: Partial<Transform>): void
  /** Returns the view to the transform the mixin started from. */
  reset(): void
}

/** How to resolve the element that receives the transform. */
export type PinchPanContent = string | ((host: Element) => Element | null)

/** Options for {@link pinchPan}. */
export interface PinchPanOptions extends ScaleLimits {
  /**
   * The element to transform, as a selector resolved within the host or a function of the host.
   *
   * Defaults to the host's first element child, or the host itself when it has none — so
   * `<div mix={[pinchPan()]}><img /></div>` moves the image inside a fixed frame, and
   * `<img mix={[pinchPan()]} />` moves the image itself.
   */
  readonly content?: PinchPanContent
  /** Where the view starts, and where {@link PinchPanControls.reset} returns to. */
  readonly initial?: Partial<Transform>
  /**
   * What puts the transform on screen. Defaults to {@link cssTransform}.
   *
   * Pass another applier, or one of your own, to paint the view differently — a canvas, a WebGL
   * uniform, custom properties for the stylesheet to use. Pass `null` to paint nothing and drive
   * everything from {@link PinchPanOptions.onChange}.
   */
  readonly applier?: TransformApplier | null
  /**
   * Set `touch-action: none` on the host. Default `true`.
   *
   * Without it the browser claims the gesture first and scrolls or zooms the page instead, and no
   * `pointermove` arrives. Turn it off only if you set an equivalent rule in CSS yourself.
   */
  readonly touchAction?: boolean
  /** Pointer types that take part. Default `['touch', 'pen']`. */
  readonly pointerTypes?: readonly string[]
  /**
   * How the wheel is read, or `false` to leave wheels to the page. Default `'auto'`.
   *
   * `'auto'` is what makes a laptop behave like a phone without asking what it is: a trackpad
   * pinch arrives as a wheel with `ctrlKey` set, so it zooms, and a two-finger scroll pans.
   * `'zoom'` is the map-like variant where every wheel zooms.
   *
   * Note that any setting but `false` takes the wheel over the host away from the page, the same
   * way `touchAction` takes the touch. For a viewer inside a scrolling article that is usually not
   * what you want; `'auto'` at least leaves the zoom on the modifier people already use.
   */
  readonly wheel?: WheelMode | false
  /** How fast the wheel zooms, per pixel of delta. Default `0.0025`. */
  readonly zoomSpeed?: number
  /**
   * How long after the last wheel event the gesture is considered over, in milliseconds.
   * Default `120`.
   *
   * A wheel has no "up" event, so this is what decides when `onEnd` fires for one.
   */
  readonly wheelSettleMs?: number
  /** Called when a gesture starts — the second finger down, or the first wheel of a burst. */
  readonly onStart?: (transform: Transform) => void
  /** Called whenever the view changes, by gesture or by {@link PinchPanControls}. */
  readonly onChange?: (transform: Transform) => void
  /** Called when the last finger lifts, or the wheel has been still for a moment. */
  readonly onEnd?: (transform: Transform) => void
  /**
   * Receives the controls once the host is inserted, with a signal aborted when it is removed.
   *
   * @param controls Programmatic access to the view
   * @param signal Aborted when the host leaves the document
   */
  readonly controls?: (controls: PinchPanControls, signal: AbortSignal) => void
}

const DEFAULT_POINTER_TYPES: readonly string[] = ['touch', 'pen']
const DEFAULT_WHEEL_SETTLE_MS = 120

/**
 * Pinch, pan and wheel for one element's content.
 *
 * The host element listens; its content is transformed. Two or more accepted pointers pinch and
 * pan — the content point under their centroid is held under their centroid, so spreading the
 * fingers zooms about the point between them and moving both pans. A wheel does the same two
 * things about the cursor, which on a laptop trackpad means two-finger scroll pans and two-finger
 * pinch zooms, because the browser reports that pinch as `Ctrl` plus a wheel.
 *
 * Changing the set of fingers mid-gesture re-anchors against the transform the content already
 * has, so lifting one of three fingers does not make the view jump. Touch and wheel share the
 * transform rather than each keeping their own, so they can be mixed without the view resetting.
 *
 * The content is scaled about its top-left (`transform-origin: 0 0`, which {@link cssTransform}
 * sets), because the arithmetic that keeps a point under the fingers has to agree with the origin
 * CSS scales about.
 *
 * Mouse *drags* are ignored by default: one mouse pointer cannot pinch, and claiming its drags
 * would take them away from selection and from the page. Add `'mouse'` to `pointerTypes` if the
 * host has no other use for them; the wheel is handled regardless.
 *
 * @example
 * ```tsx
 * <div class="viewport" mix={[pinchPan({ maxScale: 6 })]}>
 *   <img src="/map.png" alt="" />
 * </div>
 * ```
 */
export const pinchPan: MixinFactory<Element, [options?: PinchPanOptions], ElementProps> =
  createMixin<Element, [options?: PinchPanOptions], ElementProps>((handle) => {
    let options: PinchPanOptions = {}
    let target: TransformTarget | null = null
    let controller: AbortController | undefined
    let settleTimer: ReturnType<typeof setTimeout> | undefined

    let view: GestureRecognizer = createGestureRecognizer()

    /** Client-space position of the content's untransformed top-left, taken once per interaction. */
    let origin: Point = { x: 0, y: 0 }
    /** Whether an interaction is under way, and so whether {@link origin} is still good. */
    let interacting = false

    /** The mixin's options, as the recognizer's — the only overlap between the two option sets. */
    let recognizerOptions = (): GestureRecognizerOptions => ({
      minScale: options.minScale,
      maxScale: options.maxScale,
      initial: options.initial,
      wheel: options.wheel,
      zoomSpeed: options.zoomSpeed,
    })

    let resolveContent = (node: Element): Element => {
      let { content: selector } = options
      if (typeof selector === 'function') return selector(node) ?? node
      if (typeof selector === 'string') return node.querySelector(selector) ?? node
      return node.firstElementChild ?? node
    }

    let paint = (transform: Transform) => {
      if (!target) return
      let applier = options.applier === undefined ? defaultApplier : options.applier
      applier?.(transform, target)
    }

    /**
     * Turns what the recognizer answered into everything the outside sees.
     *
     * One place, so the pointer path and the wheel path cannot drift: the same update produces the
     * same paint and the same callbacks whichever input caused it.
     */
    let commit = (update: GestureUpdate) => {
      if (update.phase === 'start') options.onStart?.(update.transform)
      if (update.changed) {
        paint(update.transform)
        options.onChange?.(update.transform)
      }
      if (update.phase === 'end') options.onEnd?.(update.transform)
    }

    // The content's untransformed top-left in client coordinates. `transform-origin: 0 0` means the
    // painted box starts at that corner plus the translation, so subtracting the translation back
    // out recovers it without depending on layout details we do not control.
    //
    // Measured once per interaction rather than per event: `getBoundingClientRect` forces layout,
    // and a trackpad pinch would ask for one sixty times a second.
    let beginInteraction = () => {
      if (interacting) return
      interacting = true
      if (!target) return
      let rect = target.content.getBoundingClientRect()
      let { x, y } = view.transform
      origin = { x: rect.left - x, y: rect.top - y }
    }

    let toContentSpace = (event: PointerEvent): GesturePointer => ({
      id: event.pointerId,
      x: event.clientX - origin.x,
      y: event.clientY - origin.y,
    })

    let accepts = (event: PointerEvent): boolean =>
      (options.pointerTypes ?? DEFAULT_POINTER_TYPES).includes(event.pointerType)

    let onPointerDown = (event: PointerEvent) => {
      if (!accepts(event)) return
      beginInteraction()
      // Capture so the gesture survives a finger sliding off the host, which it will as soon as the
      // content moves out from under it.
      if (target && 'setPointerCapture' in target.host) {
        try {
          target.host.setPointerCapture(event.pointerId)
        } catch {
          // A pointer that ended between the event and here; the up/cancel handler cleans up.
        }
      }
      commit(view.pointerDown(toContentSpace(event)))
    }

    let onPointerMove = (event: PointerEvent) => {
      let update = view.pointerMove(toContentSpace(event))
      if (update.consumed) event.preventDefault()
      commit(update)
    }

    let onPointerEnd = (event: PointerEvent) => {
      if (target && 'releasePointerCapture' in target.host) {
        try {
          target.host.releasePointerCapture(event.pointerId)
        } catch {
          // Capture was already released with the pointer; nothing to undo.
        }
      }
      let update = view.pointerEnd(event.pointerId)
      commit(update)
      if (!view.gesturing) interacting = false
    }

    let onWheel = (event: WheelEvent) => {
      if (options.wheel === false) return
      beginInteraction()

      let update = view.wheel({
        at: { x: event.clientX - origin.x, y: event.clientY - origin.y },
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      })
      if (update.consumed) event.preventDefault()
      commit(update)

      // The recognizer keeps no clock, so the end of a burst is decided here.
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        commit(view.settle())
        if (!view.gesturing) interacting = false
      }, options.wheelSettleMs ?? DEFAULT_WHEEL_SETTLE_MS)
    }

    let controls: PinchPanControls = {
      get transform() {
        return view.transform
      },
      set(next) {
        commit(view.set(next))
      },
      reset() {
        commit(view.reset())
      },
    }

    handle.addEventListener('insert', (event) => {
      let host = event.node
      controller = new AbortController()
      let signal = controller.signal
      target = { host, content: resolveContent(host), signal }

      if (options.touchAction !== false) {
        ;(host as HTMLElement).style?.setProperty('touch-action', 'none')
      }

      // Built here rather than reused, so a host that is removed and inserted again starts from
      // `initial` instead of wherever the last one was left. Built *with* the options, because
      // where the view starts is read once, when the recognizer is made.
      view = createGestureRecognizer(recognizerOptions())
      paint(view.transform)

      host.addEventListener('pointerdown', onPointerDown as EventListener, { signal })
      host.addEventListener('pointermove', onPointerMove as EventListener, {
        signal,
        passive: false,
      })
      host.addEventListener('pointerup', onPointerEnd as EventListener, { signal })
      host.addEventListener('pointercancel', onPointerEnd as EventListener, { signal })
      // `passive: false` because the whole point is to stop the page scrolling under the viewer,
      // and a wheel listener is passive by default on a scrolling element.
      host.addEventListener('wheel', onWheel as EventListener, { signal, passive: false })

      options.controls?.(controls, signal)
    })

    handle.addEventListener('remove', () => {
      controller?.abort(new DOMException('', 'AbortError'))
      controller = undefined
      clearTimeout(settleTimer)
      settleTimer = undefined
      interacting = false
      target = null
    })

    return (nextOptions = {}) => {
      options = nextOptions
      view.configure(recognizerOptions())
      return handle.element
    }
  })

/** Built once, because the default is the same for every host. */
const defaultApplier: TransformApplier = cssTransform()
