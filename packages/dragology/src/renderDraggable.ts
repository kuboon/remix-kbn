import { type Draggable, makeDraggableProps } from './draggable.tsx'
import type { Svgx } from './svgx/index.ts'
import { type LayeredSvgx, layerSvg } from './svgx/layers.tsx'
import { assignPaths } from './svgx/path.ts'
import { pipe } from './utils/pipe.ts'

/** Render a state through assignPaths, but stop before layering. */
export function renderDraggableInertUnlayered<T extends object>(
  draggable: Draggable<T>,
  state: T,
  draggedId: string | null,
  isTracking: boolean,
): Svgx {
  return pipe(
    draggable(
      makeDraggableProps({
        state,
        draggedId,
        setState: () => {
          throw new Error('This function should not have been called')
        },
        isTracking,
      }),
    ),
    assignPaths,
  )
}

export function renderDraggableInert<T extends object>(
  draggable: Draggable<T>,
  state: T,
  draggedId: string | null,
  isTracking: boolean,
): LayeredSvgx {
  return layerSvg(
    renderDraggableInertUnlayered(draggable, state, draggedId, isTracking),
  )
}
