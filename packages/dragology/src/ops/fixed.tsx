import {
  type DragFrame,
  type DragInitContext,
  getElementPositionCheap,
  renderStateReadOnly,
} from '../DragBehavior.tsx'
import { type DragSpec, type DragSpecData, operator } from '../DragSpec.tsx'
import type { Vec2 } from '../math/vec2.ts'
import { Operator, type OpOverlayVisProps, type OpResult } from '../op/index.tsx'
import { DistanceLine } from '../OverlayVis.tsx'
import type { LayeredSvgx } from '../svgx/layers.tsx'

/**
 * This drag behavior simply shows a static view of the given
 * state.
 */
export function fixed<T extends object>(state: T): DragSpec<T> {
  return operator(FixedOp)(state)
}

/** The state a spec shows, if it's a `fixed` spec. */
export function fixedState<T extends object>(
  spec: DragSpecData<T>,
): T | undefined {
  return (spec.opClass as unknown) === FixedOp ? (spec.args[0] as T) : undefined
}

/** `d.fixed`. */
class FixedOp<T extends object> extends Operator<T> {
  readonly name = 'fixed'
  /** Where the dragged element is in this state (null if it's missing). */
  readonly position: Vec2 | null
  private rendered: LayeredSvgx | undefined

  constructor(
    ctx: DragInitContext<T>,
    readonly state: T,
  ) {
    super(ctx)
    this.position = getElementPositionCheap(ctx, state)
  }

  /** The rendered state, rendered on first use. */
  get outputPreview(): LayeredSvgx {
    return (this.rendered ??= renderStateReadOnly(this.ctx, this.state))
  }

  override fuzzDropPositions() {
    return this.position ? [this.position] : []
  }

  frame(frame: DragFrame): OpResult<T> {
    return {
      preview: () => this.outputPreview,
      dropState: this.state,
      gap: this.position ? frame.pointer.dist(this.position) : Infinity,
      grabPos: this.position ?? undefined,
    }
  }

  override overlayVis({ opacity }: OpOverlayVisProps) {
    const pos = this.position
    if (!this.lastFrame || !pos) return null
    const { pointer } = this.lastFrame
    return (
      <g opacity={opacity}>
        <circle
          cx={pos.x}
          cy={pos.y}
          r={4}
          fill='none'
          stroke='magenta'
          strokeWidth={1.5}
        />
        {DistanceLine({ from: pos, to: pointer, distance: pointer.dist(pos) })}
      </g>
    )
  }
}
