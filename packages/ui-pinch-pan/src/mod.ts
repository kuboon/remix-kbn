/**
 * Pinch, pan and wheel as a `@remix-run/ui` mixin — in two halves that can be taken apart.
 *
 * {@link pinchPan} is the whole public surface for normal use: put it on the element that should
 * listen and its content moves. Behind it the package is split where the two hard parts are, and
 * both are exported because either is useful without the other.
 *
 * - **Reading the gesture.** {@link createGestureRecognizer} takes pointers and wheels as plain
 *   numbers and answers with transforms. No element, no painting, no clock. Touch and wheel go
 *   through the same arithmetic, so they can be mixed within one view.
 * - **Running it.** A {@link TransformApplier} is what puts a transform on screen, and which one
 *   runs is an option. {@link cssTransform} is the default; {@link cssVariables} hands the numbers
 *   to the stylesheet; anything else is a function of the same shape.
 *
 * The arithmetic underneath both — {@link zoomAt}, {@link panBy}, {@link advanceGesture} — is
 * exported too, for a component that owns its own input handling and only wants the part that
 * decides where the content lands.
 *
 * @module
 */

export { pinchPan } from './pinch-pan.ts'
export type { PinchPanContent, PinchPanControls, PinchPanOptions } from './pinch-pan.ts'

export { createGestureRecognizer } from './recognizer.ts'
export type {
  GesturePhase,
  GestureRecognizer,
  GestureRecognizerOptions,
  GestureUpdate,
  WheelInput,
  WheelMode,
} from './recognizer.ts'

export { cssTransform, cssVariables } from './apply.ts'
export type {
  CssTransformOptions,
  CssVariablesOptions,
  TransformApplier,
  TransformTarget,
} from './apply.ts'

export {
  advanceGesture,
  anchorGesture,
  anchorMatches,
  centroidOf,
  panBy,
  spreadOf,
  zoomAt,
} from './gesture.ts'
export type { GestureAnchor, GesturePointer, Point } from './gesture.ts'

export { clampScale, IDENTITY_TRANSFORM, transformsEqual, transformToCss } from './transform.ts'
export type { ScaleLimits, Transform } from './transform.ts'
