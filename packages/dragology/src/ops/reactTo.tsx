import type { DragFrame, DragInitContext } from '../DragBehavior.tsx'
import { type DragSpec, operator } from '../DragSpec.tsx'
import { OverlayVis } from '../OverlayVis.tsx'
import { type Child, Operator, type OpOverlayVisProps, type OpResult } from '../op/index.tsx'

// `reactTo` has a type parameter of its own (`V`), on top of the
// builder's `T`, so it's a method of a class of its own, which
// `DragSpecBuilder` borrows.
export class ReactToMethod<T extends object> {
  /**
   * This drag behavior calls an getter on every frame. When the
   * getter's value changes, a child behavior is re-initialized with
   * the new value.
   */
  reactTo<V>(
    getter: () => V,
    callback: (value: V) => DragSpec<T>,
  ): DragSpec<T> {
    return operator(ReactToOp<T>)(
      getter,
      callback as (value: unknown) => DragSpec<T>,
    )
  }
}

/** `d.reactTo`. */
class ReactToOp<T extends object> extends Operator<T> {
  readonly name = 'reactTo'
  /** The getter's last value. (A fresh object at first, so it's invalidated.) */
  currentValue: unknown = {}
  changeCount = 0
  /** The child for the current value. */
  current: Child<T> | undefined

  constructor(
    ctx: DragInitContext<T>,
    readonly getter: () => unknown,
    readonly callback: (value: unknown) => DragSpec<T>,
  ) {
    super(ctx)
  }

  frame(frame: DragFrame): OpResult<T> {
    const value = this.getter()
    if (value !== this.currentValue) {
      this.currentValue = value
      this.changeCount++
      this.current = this.child(null, this.callback(value))
    }
    return this.current!.run(frame)
  }

  override overlayVis({ active }: OpOverlayVisProps) {
    return this.current ? OverlayVis({ op: this.current.op, active: active }) : null
  }
}
