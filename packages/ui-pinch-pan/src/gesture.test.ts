import * as assert from '@remix-run/assert'
import { describe, it } from '@std/testing/bdd'

import {
  advanceGesture,
  anchorGesture,
  anchorMatches,
  centroidOf,
  type GesturePointer,
  panBy,
  type Point,
  spreadOf,
  zoomAt,
} from './gesture.ts'
import { IDENTITY_TRANSFORM, type Transform } from './transform.ts'

/** The content point currently painted under a point on screen. */
function contentUnder(transform: Transform, point: Point): Point {
  return {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  }
}

function closeTo(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  )
}

function samePoint(actual: Point, expected: Point, epsilon = 1e-9): void {
  closeTo(actual.x, expected.x, epsilon)
  closeTo(actual.y, expected.y, epsilon)
}

const twoFingers = (
  a: [number, number],
  b: [number, number],
): GesturePointer[] => [
  { id: 1, x: a[0], y: a[1] },
  { id: 2, x: b[0], y: b[1] },
]

describe('centroidOf', () => {
  it('averages the points', () => {
    samePoint(centroidOf(twoFingers([0, 0], [100, 50])), { x: 50, y: 25 })
  })

  it('returns the origin for no points', () => {
    samePoint(centroidOf([]), { x: 0, y: 0 })
  })
})

describe('spreadOf', () => {
  it('is the half-distance for two points', () => {
    closeTo(spreadOf(twoFingers([0, 0], [100, 0])), 50)
  })

  it('is zero for fewer than two points', () => {
    closeTo(spreadOf([{ x: 3, y: 4 }]), 0)
    closeTo(spreadOf([]), 0)
  })

  it('changes continuously when a third finger joins', () => {
    // A finger landing on the centroid of the other two lowers the mean distance, it does not
    // redefine the measure the way "distance between the first two" would.
    let two = spreadOf(twoFingers([0, 0], [120, 0]))
    let three = spreadOf([...twoFingers([0, 0], [120, 0]), { id: 3, x: 60, y: 0 }])
    closeTo(two, 60)
    closeTo(three, 40)
  })
})

describe('zoomAt', () => {
  it('holds the point it is given', () => {
    let at: Point = { x: 120, y: 80 }
    let from: Transform = { x: 30, y: -10, scale: 1.5 }
    let before = contentUnder(from, at)

    samePoint(contentUnder(zoomAt(from, at, 2.5), at), before)
  })

  it('multiplies the scale', () => {
    closeTo(zoomAt(IDENTITY_TRANSFORM, { x: 0, y: 0 }, 3).scale, 3)
  })

  it('holds the point even at a limit, rather than sliding past it', () => {
    let at: Point = { x: 200, y: 50 }
    let from: Transform = { x: 0, y: 0, scale: 2 }
    let before = contentUnder(from, at)

    let zoomed = zoomAt(from, at, 10, { maxScale: 4 })

    closeTo(zoomed.scale, 4)
    samePoint(contentUnder(zoomed, at), before)
  })

  it('recovers from a scale CSS would have dropped', () => {
    closeTo(zoomAt({ x: 0, y: 0, scale: 0 }, { x: 0, y: 0 }, 2).scale, 2)
  })
})

describe('panBy', () => {
  it('moves without scaling', () => {
    assert.deepEqual(panBy({ x: 10, y: 20, scale: 3 }, -4, 6), { x: 6, y: 26, scale: 3 })
  })
})

describe('advanceGesture', () => {
  it('pans by exactly the centroid movement when the spread holds', () => {
    let start = twoFingers([100, 100], [200, 100])
    let anchor = anchorGesture(start, IDENTITY_TRANSFORM)
    let moved = twoFingers([130, 80], [230, 80])

    let next = advanceGesture(anchor, moved)

    closeTo(next.scale, 1)
    closeTo(next.x, 30)
    closeTo(next.y, -20)
  })

  it('doubles the scale when the fingers spread to twice the distance', () => {
    let start = twoFingers([100, 100], [200, 100])
    let anchor = anchorGesture(start, IDENTITY_TRANSFORM)
    let spread = twoFingers([50, 100], [250, 100])

    let next = advanceGesture(anchor, spread)

    closeTo(next.scale, 2)
  })

  it('holds the content point that was under the centroid', () => {
    let start = twoFingers([100, 100], [200, 140])
    let anchor = anchorGesture(start, IDENTITY_TRANSFORM)
    let pinned = contentUnder(IDENTITY_TRANSFORM, centroidOf(start))

    // Spread, rotate and drag all at once — the rule is about the centroid, not about the fingers.
    let moved = twoFingers([60, 40], [320, 300])
    let next = advanceGesture(anchor, moved)

    samePoint(contentUnder(next, centroidOf(moved)), pinned, 1e-9)
  })

  it('continues from the transform it was anchored against', () => {
    let already: Transform = { x: -40, y: 15, scale: 2.5 }
    let start = twoFingers([100, 100], [200, 100])
    let anchor = anchorGesture(start, already)

    // Fingers that have not moved leave the view exactly where it was.
    let next = advanceGesture(anchor, start)

    closeTo(next.x, already.x)
    closeTo(next.y, already.y)
    closeTo(next.scale, already.scale)
  })

  it('keeps the anchor point under the fingers when the scale hits maxScale', () => {
    // Clamping the scale after solving the translation is the tempting shortcut, and it slides the
    // content out from under the fingers as soon as a pinch reaches the limit.
    let limits = { minScale: 1, maxScale: 2 }
    let start = twoFingers([100, 100], [200, 100])
    let anchor = anchorGesture(start, IDENTITY_TRANSFORM)
    let pinned = contentUnder(IDENTITY_TRANSFORM, centroidOf(start))

    let beyond = twoFingers([-100, 100], [400, 100])
    let next = advanceGesture(anchor, beyond, limits)

    closeTo(next.scale, 2)
    samePoint(contentUnder(next, centroidOf(beyond)), pinned, 1e-9)
  })

  it('keeps the anchor point under the fingers when the scale hits minScale', () => {
    let limits = { minScale: 1, maxScale: 4 }
    let start = twoFingers([0, 0], [200, 0])
    let anchor = anchorGesture(start, { x: 0, y: 0, scale: 1.2 })
    let pinned = contentUnder({ x: 0, y: 0, scale: 1.2 }, centroidOf(start))

    let pinched = twoFingers([95, 0], [105, 0])
    let next = advanceGesture(anchor, pinched, limits)

    closeTo(next.scale, 1)
    samePoint(contentUnder(next, centroidOf(pinched)), pinned, 1e-9)
  })

  it('pans without zooming when the anchor has a single pointer', () => {
    let anchor = anchorGesture([{ id: 1, x: 10, y: 10 }], IDENTITY_TRANSFORM)

    let next = advanceGesture(anchor, [{ id: 1, x: 40, y: 70 }])

    closeTo(next.scale, 1)
    closeTo(next.x, 30)
    closeTo(next.y, 60)
  })

  it('does not jump when a finger lifts and the gesture is anchored again', () => {
    let three = [...twoFingers([0, 0], [200, 0]), { id: 3, x: 100, y: 160 }]
    let anchor = anchorGesture(three, IDENTITY_TRANSFORM)
    let midGesture = advanceGesture(
      anchor,
      [{ id: 1, x: 20, y: 10 }, { id: 2, x: 240, y: 10 }, { id: 3, x: 130, y: 190 }],
    )

    // Finger 3 lifts. Re-anchoring against the transform the content already has, and then reading
    // the two remaining fingers where they still are, has to leave the view untouched.
    let remaining = [{ id: 1, x: 20, y: 10 }, { id: 2, x: 240, y: 10 }]
    let next = advanceGesture(anchorGesture(remaining, midGesture), remaining)

    closeTo(next.x, midGesture.x)
    closeTo(next.y, midGesture.y)
    closeTo(next.scale, midGesture.scale)
  })
})

describe('anchorMatches', () => {
  let anchor = anchorGesture(twoFingers([0, 0], [10, 10]), IDENTITY_TRANSFORM)

  it('accepts the same ids in any order', () => {
    assert.ok(anchorMatches(anchor, [
      { id: 2, x: 10, y: 10 },
      { id: 1, x: 0, y: 0 },
    ]))
  })

  it('rejects a different set', () => {
    assert.ok(!anchorMatches(anchor, [{ id: 1, x: 0, y: 0 }]))
    assert.ok(
      !anchorMatches(anchor, [
        ...twoFingers([0, 0], [10, 10]),
        { id: 3, x: 5, y: 5 },
      ]),
    )
  })
})
