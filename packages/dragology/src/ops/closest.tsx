// @ts-types="npm:@types/lodash-es@^4.17.12"
import * as _ from 'lodash-es'
import {
  type DragFrame,
  type DragInitContext,
  getElementPosition,
  getElementPositionCheap,
  renderStateReadOnly,
} from '../DragBehavior.tsx'
import {
  type DragSpec,
  type DragSpecData,
  type DragSpecLike,
  operator,
  resolveDragSpecLike,
} from '../DragSpec.tsx'
import type { Vec2 } from '../math/vec2.ts'
import { type Child, Operator, type OpOverlayVisProps, type OpResult } from '../op/index.tsx'
import { OverlayVis } from '../OverlayVis.tsx'
import { assert } from '../utils/assert.ts'
import { type Many, manyToArray } from '../utils/flexible-types.ts'

/**
 * This drag behavior combines multiple behaviors. During the drag,
 * it continuously switches to the behavior that gets the dragged
 * element closest to the pointer (lowest "gap").
 */
export function closest<T extends object>(
  specs: Many<DragSpecLike<T>>,
  options?: {
    /**
     * Stickiness tells `d.closest` to stay on the current option
     * until its gap is `stickiness` pixels bigger than the
     * next-best option.
     */
    stickiness?: number
    /**
     * Once the active option has carried the dragged element more
     * than `lockPast` pixels from where it started, `d.closest`
     * locks onto that option, ignoring the others, until it brings
     * the element back within `lockPast` pixels. Use this for
     * options that all start from the current state (like
     * `d.between([state, target])` for several targets), so that a
     * drag heading out toward one target can't jump partway onto
     * another.
     */
    lockPast?: number
  },
): DragSpec<T> {
  return operator(ClosestOp)(
    manyToArray(specs).map(resolveDragSpecLike),
    options?.stickiness ?? 0,
    options?.lockPast,
  )
}

/**
 * `d.closest`: run every option, and follow whichever gets the dragged
 * element closest to the pointer (lowest gap).
 */
class ClosestOp<T extends object> extends Operator<T> {
  readonly name = 'closest'
  readonly options: Child<T>[]
  /** Memory: the last frame's choice, which `stickiness` favors. */
  lastBest: number | null = null
  /** Memory, for `lockPast`: the option the drag is locked onto. */
  lockedIndex: number | null = null
  /**
   * Which options ran on the last frame. (While the drag is locked
   * onto an option, the others don't run.)
   */
  ran: boolean[] = []
  /** For `lockPast`: where the dragged element starts out. */
  private readonly home: Vec2 | undefined

  constructor(
    ctx: DragInitContext<T>,
    specs: DragSpecData<T>[],
    readonly stickiness: number,
    readonly lockPast: number | undefined,
  ) {
    super(ctx)
    this.options = specs.map((s, i) => this.child(String(i), s))
    if (lockPast !== undefined) {
      const home = getElementPositionCheap(ctx, ctx.startState)
      assert(
        home !== null,
        'closest: dragged element not found in start state',
      )
      this.home = home
    }
  }

  /** Whether an option's result has carried the element past `lockPast`. */
  private isPastLock(result: OpResult<T>): boolean {
    if (this.home === undefined || this.lockPast === undefined) return false
    // A preview without the dragged element counts as far from home.
    const pos = result.grabPos ?? getElementPosition(this.ctx, result.preview())
    return pos === null || pos.dist(this.home) > this.lockPast
  }

  frame(frame: DragFrame): OpResult<T> {
    if (this.options.length === 0) {
      // TODO: Weird special case: just stay on the starting state.
      // This is actually useful – it lets you do things like
      // d.closest(specs).whenFar(specFar) and not worry about the
      // 0-specs case. But it's not especially principled.
      return {
        preview: () => renderStateReadOnly(this.ctx, this.ctx.startState),
        dropState: this.ctx.startState,
        gap: Infinity,
        activePath: 'none',
      }
    }
    // Options run lazily, so a locked frame only runs the locked one.
    const results: (OpResult<T> | undefined)[] = []
    const resultAt = (i: number) => (results[i] ??= this.options[i].run(frame))

    if (
      this.lockedIndex !== null &&
      !this.isPastLock(resultAt(this.lockedIndex))
    ) {
      this.lockedIndex = null
    }
    let best = this.lockedIndex
    if (best === null) {
      best = _.minBy(
        _.range(this.options.length),
        (i) => resultAt(i).gap - (i === this.lastBest ? this.stickiness : 0),
      )!
      if (this.isPastLock(resultAt(best))) this.lockedIndex = best
    }
    this.lastBest = best
    this.ran = this.options.map((_o, i) => results[i] !== undefined)
    return resultAt(best)
  }

  override overlayVis({ active }: OpOverlayVisProps) {
    if (this.frames === 0) return null
    return (
      <g>
        {this.options.map(
          (option, i) =>
            this.ran[i] && OverlayVis({ op: option.op, active: active && i === this.lastBest }),
        )}
      </g>
    )
  }
}
