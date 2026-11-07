import type { DragFrame, DragInitContext } from '../DragBehavior.tsx'
import { type DragSpec, type DragSpecData, operator } from '../DragSpec.tsx'
import { Modifier, type OpResult } from '../op/index.tsx'
import { resolveTransitionLike, type Transition, type TransitionLike } from '../transition.ts'

/**
 * Set a transition to be used when dropping an element. You don't
 * need to call this to get a drop transition – by default you get
 * a 200ms cubic-out. This is for customization.
 */
export function withDropTransition<T extends object>(
  this: DragSpec<T>,
  transition: TransitionLike,
): DragSpec<T> {
  return operator(WithDropTransitionOp)(
    this,
    resolveTransitionLike(transition),
  )
}

/** `spec.withDropTransition`. */
class WithDropTransitionOp<T extends object> extends Modifier<T> {
  readonly name = 'withDropTransition'

  constructor(
    ctx: DragInitContext<T>,
    inner: DragSpecData<T>,
    readonly transition: Transition | false,
  ) {
    super(ctx, inner)
  }

  frame(frame: DragFrame): OpResult<T> {
    return { ...this.inner.run(frame), dropTransition: this.transition }
  }
}
