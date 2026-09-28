import { clampScale, type ScaleLimits, type Transform } from './transform.ts'

/** A point in the content's coordinate space — the untransformed box, origin at its top-left. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** One finger, identified so the set can be compared between events. */
export interface GesturePointer extends Point {
  /** `PointerEvent.pointerId`. */
  readonly id: number
}

/**
 * What the gesture was anchored to when it started.
 *
 * Everything a move needs is captured here, which is what makes re-anchoring cheap: when the set of
 * fingers changes, anchor again against the transform the content already has and the content does
 * not jump.
 */
export interface GestureAnchor {
  /** The pointer ids this anchor was taken from, sorted. */
  readonly ids: readonly number[]
  /** Centroid of those pointers at anchor time. */
  readonly centroid: Point
  /** Mean distance from the centroid at anchor time. `0` for a single pointer. */
  readonly spread: number
  /** The transform the content had at anchor time. */
  readonly transform: Transform
}

/**
 * Averages a set of points.
 *
 * @param points Points to average
 * @returns Their centroid, or the origin when given none
 */
export function centroidOf(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (let point of points) {
    x += point.x
    y += point.y
  }
  return { x: x / points.length, y: y / points.length }
}

/**
 * Measures how far apart a set of points is.
 *
 * The mean distance from the centroid, rather than the distance between two fingers, so that a
 * third finger joining a pinch changes the measure continuously instead of redefining it.
 *
 * @param points Points to measure
 * @returns Mean distance from the centroid; `0` for fewer than two points
 */
export function spreadOf(points: readonly Point[]): number {
  if (points.length < 2) return 0
  let center = centroidOf(points)
  let total = 0
  for (let point of points) {
    total += Math.hypot(point.x - center.x, point.y - center.y)
  }
  return total / points.length
}

/**
 * Captures the state a gesture is measured against.
 *
 * @param pointers Fingers currently down, in content coordinates
 * @param transform The transform the content has right now
 * @returns An anchor to pass to {@link advanceGesture}
 */
export function anchorGesture(
  pointers: readonly GesturePointer[],
  transform: Transform,
): GestureAnchor {
  return {
    ids: pointers.map((pointer) => pointer.id).sort((a, b) => a - b),
    centroid: centroidOf(pointers),
    spread: spreadOf(pointers),
    transform,
  }
}

/**
 * Whether a pointer set is still the one an anchor was taken from.
 *
 * @param anchor Anchor to check against
 * @param pointers Fingers currently down
 * @returns `true` when the same ids are down, in any order
 */
export function anchorMatches(
  anchor: GestureAnchor,
  pointers: readonly GesturePointer[],
): boolean {
  if (anchor.ids.length !== pointers.length) return false
  let ids = pointers.map((pointer) => pointer.id).sort((a, b) => a - b)
  return ids.every((id, index) => id === anchor.ids[index])
}

/**
 * Scales the view about a point that must not move.
 *
 * The content point currently under `at` is put back under `at` at the new scale. This is the
 * primitive behind every zoom in this package — a pinch zooms about the fingers' centroid, a wheel
 * about the cursor — and the reason it takes a fixed point rather than a factor alone is that a
 * zoom which does not hold something still is a zoom that slides the content away from whatever the
 * person was looking at.
 *
 * Clamping happens to the scale *before* the translation is solved. Clamping the finished transform
 * instead lets the content drift at the limit, because the translation was computed for a scale the
 * view never reached.
 *
 * @param transform The transform to start from
 * @param at The point to hold still, in content coordinates
 * @param factor What to multiply the scale by
 * @param limits Scale bounds
 * @returns The scaled transform
 */
export function zoomAt(
  transform: Transform,
  at: Point,
  factor: number,
  limits: ScaleLimits = {},
): Transform {
  let previous = transform.scale > 0 ? transform.scale : 1
  let scale = clampScale(previous * factor, limits)

  // The content point under `at`, recovered by undoing the current transform.
  let contentX = (at.x - transform.x) / previous
  let contentY = (at.y - transform.y) / previous

  return { x: at.x - contentX * scale, y: at.y - contentY * scale, scale }
}

/**
 * Moves the view without scaling it.
 *
 * @param transform The transform to start from
 * @param dx Horizontal movement in view pixels
 * @param dy Vertical movement in view pixels
 * @returns The moved transform
 */
export function panBy(transform: Transform, dx: number, dy: number): Transform {
  return { x: transform.x + dx, y: transform.y + dy, scale: transform.scale }
}

/**
 * Computes the transform a multi-finger gesture has reached.
 *
 * The content point that sat under the fingers' centroid when the gesture started is put back under
 * their centroid now. That single rule produces pan and zoom at once: moving both fingers moves the
 * centroid, spreading them changes the scale, and doing both does both.
 *
 * Written as the two primitives above rather than as its own algebra, which is not a tidying: it
 * says what a pinch *is*. Zoom about the anchor centroid by how much the fingers spread, then move
 * by how far the centroid travelled — and a wheel is the same two operations with the cursor in
 * place of the centroid.
 *
 * @param anchor What the gesture was anchored to
 * @param pointers Fingers currently down, in content coordinates
 * @param limits Scale bounds
 * @returns The transform to paint
 */
export function advanceGesture(
  anchor: GestureAnchor,
  pointers: readonly GesturePointer[],
  limits: ScaleLimits = {},
): Transform {
  let spread = spreadOf(pointers)
  let factor = anchor.spread > 0 && spread > 0 ? spread / anchor.spread : 1

  let zoomed = zoomAt(anchor.transform, anchor.centroid, factor, limits)

  let centroid = centroidOf(pointers)
  return panBy(zoomed, centroid.x - anchor.centroid.x, centroid.y - anchor.centroid.y)
}
