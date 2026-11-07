/**
 * Dragology for Remix v3: declarative dragging for SVG, rendered with
 * `@remix-run/component`.
 *
 * @module
 */

// The `dragology*` JSX props, for the app's own type augmentation.
export type { DragologyComponentProps, DragologyHostProps } from './jsx.ts'

// Core component
export { DraggableRenderer } from './DraggableRenderer.tsx'
export type {
  DraggableRendererBaseProps,
  DraggableRendererProps,
  DragStatus,
} from './DraggableRenderer.tsx'

// Draggable type & helpers
export type { Draggable, DraggableProps, SetState } from './draggable.tsx'

// DragSpec & builder
export { and, inOrder, lessThan, moreThan, param } from './DragSpec.tsx'
export type { DragSpec, DragSpecBrand, DragSpecBuilder, DragSpecMethods } from './DragSpec.tsx'

// Transitions
export type { Transition, TransitionLike } from './transition.ts'

// SVG helpers
export type { Svgx } from './svgx/index.ts'
export { draggableLine, path, rotateDeg, rotateRad, scale, translate } from './svgx/helpers.ts'

// Math
export { Vec2 } from './math/vec2.ts'
export type { Vec2able } from './math/vec2.ts'

// Amb (nondeterministic computation)
export { amb, fail, produceAmb, require, runAmb } from './amb.ts'

// Paths (for vary, substate, etc.)
export type { PathIn } from './paths.ts'

// Utility types
export type { Many } from './utils/flexible-types.ts'

// Drag behavior (for d.custom and benchmarking)
export { dragSpecToBehavior } from './DragBehavior.tsx'
export type { DragBehavior, DragFrame, DragInitContext, DragResult } from './DragBehavior.tsx'

// Writing your own operators and modifiers
export {
  getElementPosition,
  getElementPositionCheap,
  renderStateReadOnly,
} from './DragBehavior.tsx'
export { modifier, operator, resolveDragSpecLike } from './DragSpec.tsx'
export type { DragSpecData, DragSpecLike } from './DragSpec.tsx'
export { Modifier, Operator } from './op/index.tsx'
export type { Child, OpOverlayVisProps, OpResult } from './op/index.tsx'
export type { LayeredSvgx } from './svgx/layers.tsx'
// Building blocks for their debug overlays
export { DistanceLine, OverlayVis } from './OverlayVis.tsx'
