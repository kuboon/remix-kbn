import * as assert from '@remix-run/assert'
import { describe, it } from '@std/testing/bdd'

import { createGestureRecognizer, type GestureRecognizer } from './recognizer.ts'
import type { Point } from './gesture.ts'
import type { Transform } from './transform.ts'

function closeTo(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  )
}

/** The content point currently painted under a point on screen. */
function contentUnder(transform: Transform, point: Point): Point {
  return {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  }
}

/** Puts two fingers down and spreads them, which is the shortest real gesture. */
function pinch(view: GestureRecognizer, from: number, to: number): void {
  view.pointerDown({ id: 1, x: 0, y: 0 })
  view.pointerDown({ id: 2, x: from, y: 0 })
  view.pointerMove({ id: 2, x: to, y: 0 })
}

describe('the recognizer as a state machine', () => {
  it('starts at the identity, and at initial when given one', () => {
    assert.deepEqual(createGestureRecognizer().transform, { x: 0, y: 0, scale: 1 })
    assert.deepEqual(
      createGestureRecognizer({ initial: { x: 10, scale: 2 } }).transform,
      { x: 10, y: 0, scale: 2 },
    )
  })

  it('clamps an initial scale that is outside the limits', () => {
    let view = createGestureRecognizer({ initial: { scale: 20 }, maxScale: 4 })
    closeTo(view.transform.scale, 4)
  })

  it('is not gesturing until a second finger lands, and not after the last lifts', () => {
    let view = createGestureRecognizer()

    let first = view.pointerDown({ id: 1, x: 0, y: 0 })
    assert.equal(view.gesturing, false)
    assert.equal(first.phase, 'idle')

    let second = view.pointerDown({ id: 2, x: 100, y: 0 })
    assert.equal(view.gesturing, true)
    assert.equal(second.phase, 'start')

    assert.equal(view.pointerMove({ id: 2, x: 120, y: 0 }).phase, 'move')

    // One finger up is still a hand on the screen: the gesture is not over yet.
    assert.equal(view.pointerEnd(2).phase, 'move')
    assert.equal(view.gesturing, true)

    assert.equal(view.pointerEnd(1).phase, 'end')
    assert.equal(view.gesturing, false)
  })

  it('ignores a move from a pointer it never saw go down', () => {
    let view = createGestureRecognizer()
    let update = view.pointerMove({ id: 9, x: 50, y: 50 })

    assert.equal(update.changed, false)
    assert.equal(update.consumed, false)
    assert.deepEqual(update.transform, { x: 0, y: 0, scale: 1 })
  })

  it('reports a pinch as consumed even when the scale will not move', () => {
    let view = createGestureRecognizer({ maxScale: 1 })
    view.pointerDown({ id: 1, x: 0, y: 0 })
    view.pointerDown({ id: 2, x: 100, y: 0 })

    let update = view.pointerMove({ id: 2, x: 400, y: 0 })
    assert.equal(update.consumed, true)
    closeTo(update.transform.scale, 1)
  })

  it('set and reset move the view without starting a gesture', () => {
    let view = createGestureRecognizer({ initial: { x: 5, y: 5 }, maxScale: 3 })

    let set = view.set({ scale: 99 })
    assert.equal(set.phase, 'idle')
    closeTo(set.transform.scale, 3)

    let reset = view.reset()
    assert.deepEqual(reset.transform, { x: 5, y: 5, scale: 1 })
    assert.equal(reset.phase, 'idle')
  })
})

describe('the wheel', () => {
  let at: Point = { x: 200, y: 100 }

  it('pans by the delta, in the direction a scrollbar moves', () => {
    let view = createGestureRecognizer()
    let { transform, consumed } = view.wheel({ at, deltaX: 30, deltaY: 50 })

    assert.equal(consumed, true)
    assert.deepEqual(transform, { x: -30, y: -50, scale: 1 })
  })

  it('zooms about the cursor when Ctrl is held, and holds that point still', () => {
    let view = createGestureRecognizer()
    let before = contentUnder(view.transform, at)

    let { transform } = view.wheel({ at, deltaX: 0, deltaY: -100, ctrlKey: true })

    assert.ok(transform.scale > 1, `expected a zoom in, got ${transform.scale}`)
    let after = contentUnder(transform, at)
    closeTo(after.x, before.x, 1e-9)
    closeTo(after.y, before.y, 1e-9)
  })

  it('treats ⌘ the same as Ctrl', () => {
    let view = createGestureRecognizer()
    let { transform } = view.wheel({ at, deltaX: 0, deltaY: -100, metaKey: true })

    assert.ok(transform.scale > 1)
  })

  it('returns to the same scale when a zoom is undone', () => {
    let view = createGestureRecognizer()
    view.wheel({ at, deltaX: 0, deltaY: -240, ctrlKey: true })
    let { transform } = view.wheel({ at, deltaX: 0, deltaY: 240, ctrlKey: true })

    closeTo(transform.scale, 1, 1e-12)
    closeTo(transform.x, 0, 1e-9)
    closeTo(transform.y, 0, 1e-9)
  })

  it('zooms on every wheel in zoom mode, and pans on none', () => {
    let view = createGestureRecognizer({ wheel: 'zoom' })
    let { transform } = view.wheel({ at, deltaX: 40, deltaY: -100 })

    assert.ok(transform.scale > 1)
  })

  it('pans on every wheel in pan mode, Ctrl or not', () => {
    let view = createGestureRecognizer({ wheel: 'pan' })
    let { transform } = view.wheel({ at, deltaX: 0, deltaY: -100, ctrlKey: true })

    assert.deepEqual(transform, { x: 0, y: 100, scale: 1 })
  })

  it('leaves the wheel to the page when told to', () => {
    let view = createGestureRecognizer({ wheel: false })
    let update = view.wheel({ at, deltaX: 0, deltaY: 100 })

    assert.equal(update.consumed, false)
    assert.equal(update.changed, false)
    assert.equal(view.gesturing, false)
  })

  it('reads line and page deltas as pixels', () => {
    let lines = createGestureRecognizer()
    assert.deepEqual(
      lines.wheel({ at, deltaX: 0, deltaY: 3, deltaMode: 1 }).transform,
      { x: 0, y: -48, scale: 1 },
    )

    let pages = createGestureRecognizer({ pagePixels: 500 })
    assert.deepEqual(
      pages.wheel({ at, deltaX: 0, deltaY: 1, deltaMode: 2 }).transform,
      { x: 0, y: -500, scale: 1 },
    )
  })

  it('runs as a gesture until it is settled', () => {
    let view = createGestureRecognizer()

    assert.equal(view.wheel({ at, deltaX: 0, deltaY: 50 }).phase, 'start')
    assert.equal(view.wheel({ at, deltaX: 0, deltaY: 50 }).phase, 'move')
    assert.equal(view.gesturing, true)

    assert.equal(view.settle().phase, 'end')
    assert.equal(view.gesturing, false)
    // Settling again is not a second ending.
    assert.equal(view.settle().phase, 'idle')
  })

  it('obeys the scale limits', () => {
    let view = createGestureRecognizer({ minScale: 0.5, maxScale: 2 })

    for (let i = 0; i < 50; i++) view.wheel({ at, deltaX: 0, deltaY: -100, ctrlKey: true })
    closeTo(view.transform.scale, 2)

    for (let i = 0; i < 100; i++) view.wheel({ at, deltaX: 0, deltaY: 100, ctrlKey: true })
    closeTo(view.transform.scale, 0.5)
  })
})

describe('touch and wheel in one view', () => {
  it('continues a pinch from where the wheel left the view', () => {
    let view = createGestureRecognizer()
    view.wheel({ at: { x: 0, y: 0 }, deltaX: 0, deltaY: -100, ctrlKey: true })
    let zoomed = view.transform.scale
    view.settle()

    pinch(view, 100, 200)

    // The pinch doubled the spread, so it doubled whatever the wheel had reached.
    closeTo(view.transform.scale, zoomed * 2, 1e-9)
  })

  it('lets the wheel carry on from where the fingers left off', () => {
    let view = createGestureRecognizer()
    pinch(view, 100, 200)
    view.pointerEnd(1)
    view.pointerEnd(2)
    let pinched = view.transform

    let { transform } = view.wheel({ at: { x: 0, y: 0 }, deltaX: 10, deltaY: 20 })

    assert.deepEqual(transform, { x: pinched.x - 10, y: pinched.y - 20, scale: pinched.scale })
  })
})
