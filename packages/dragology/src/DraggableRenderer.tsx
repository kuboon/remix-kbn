// @ts-types="npm:@types/lodash-es@^4.17.12"
import * as _ from 'lodash-es'
import { type Handle, on, ref, type RemixNode } from '@remix-run/component'
import {
  type DragBehavior,
  type DragFrame,
  type DragInitContext,
  type DragResult,
  dragSpecToBehavior,
} from './DragBehavior.tsx'
import type { DragSpec } from './DragSpec.tsx'
import { OverlayVis } from './OverlayVis.tsx'
import {
  type Draggable,
  getOnDragCallbackOnElement,
  makeDraggableProps,
  type SetStateAction,
} from './draggable.tsx'
import { Vec2, type Vec2able } from './math/vec2.ts'
import { renderDraggableInert, renderDraggableInertUnlayered } from './renderDraggable.ts'
import { findElement, type Svgx, updatePropsDownTree } from './svgx/index.ts'
import { boundsCenter, getLocalBounds } from './svgx/bounds.ts'
import { ComponentHost } from './svgx/componentHost.tsx'
import { drawLayered, type LayeredSvgx, layerSvg } from './svgx/layers.tsx'
import { lerpLayered } from './svgx/lerp.tsx'
import { assignPaths, findByPath, getPath } from './svgx/path.ts'
import { globalToLocal, localToGlobal } from './svgx/transform.ts'
import {
  applyEasing,
  resolveTransitionLike,
  type Transition,
  type TransitionLike,
} from './transition.ts'
import { assert } from './utils/assert.ts'
import { pipe } from './utils/pipe.ts'

// # Engine state machine

type SpringOrigin = {
  layered: LayeredSvgx
  time: number
  transition: Transition
}

function makeSpringOrigin(
  transitionLike: TransitionLike,
  /**
   * We provide this lazily cuz if the transition says "no
   * transition" then we can skip it.
   */
  layeredLazy: () => LayeredSvgx,
): SpringOrigin | null {
  const transition = resolveTransitionLike(transitionLike)
  if (transition === false) return null
  return {
    layered: layeredLazy(),
    time: performance.now(),
    transition,
  }
}

/**
 * Tracks a pointer-down that hasn't yet exceeded the movement
 * threshold to become a full drag.
 */
type PendingDrag<T extends object> = {
  startClientPos: Vec2
  threshold: number
  status: DragStatusDragging<T>
}

/*
A bit of terminology about the lifetimes of drags:

- A "drag" is the user-facing pointer-down/pointer-move/pointer-up
  thing we all know and love.

- A "drag span" is the portion of a drag running under a fixed drag
  behavior. A drag can consist of multiple drag spans due to
  chaining: When we chain, we move into a new state and re-initialize
  the drag from that new state, starting a new, chained span.

  A drag span is initialized in a few steps:

  - Get ahold of a OnDragCallback – extract from rendered SVGX or use
    a saved one.
  - Evaluate the OnDragCallback to get a DragSpec.
  - Turn the DragSpec into a DragBehavior using dragSpecToBehavior,
    providing some DragInitContext.

*/

export type DragStatus<T extends object> =
  & {
    springOrigin: SpringOrigin | null
  }
  & (
    | { type: 'idle'; state: T; pendingDrag?: PendingDrag<T> }
    | {
      type: 'dragging'
      startState: T // TODO: this is of suspect utility
      behavior: DragBehavior<T>
      behaviorCtx: DragInitContext<T>
      result: DragResult<T>
      /**
       * We save the drag spec so we can generate fresh behaviors for
       * the drop-zone visualization. It's named in a scary way to
       * remind you that it's a niche use case.
       */
      specForDropZoneVis: DragSpec<T>
    }
  )
type DragStatusDragging<T extends object> = DragStatus<T> & {
  type: 'dragging'
}

// # Component

export interface DraggableRendererBaseProps<T extends object> {
  draggable: Draggable<T>
  width?: number
  height?: number
  onDropState?: (state: T) => void
  onDragState?: (state: T) => void
  onDragStatus?: (dragStatus: DragStatus<T>) => void
  showDebugOverlay?: boolean
  showVaryVisualizer?: boolean
  /**
   * Minimum pointer movement (in px) before a pointerdown becomes a drag.
   * Below this threshold the gesture is treated as a click — the state
   * machine stays idle, so click handlers on the element fire normally.
   * Set to 0 to start drags immediately. Default: 2.
   */
  dragThreshold?: number
  /**
   * Simulate a drag on the element with this ID. The pointer is faked
   * at the element's center (plus optional offset). The draggable
   * won't be interactive.
   */
  simulateDrag?: { id: string; offset?: Vec2able }
}

export type DraggableRendererProps<T extends object> =
  & DraggableRendererBaseProps<T>
  // States are often provided with more specific types than the
  // true T, so we use NoInfer to make DraggableRenderer use T from
  // the Draggable.
  & (
    | { state: NoInfer<T>; initialState?: undefined }
    | { state?: undefined; initialState: NoInfer<T> }
  )

type CatchToRenderError = <TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
) => (...args: TArgs) => TReturn

/**
 * Renders a draggable into an `<svg>` and runs its drags.
 *
 * Pass `state` to control it (and follow `onDropState`), or
 * `initialState` to let it keep its own state.
 */
export function DraggableRenderer<T extends object>(
  handle: Handle<DraggableRendererProps<T>>,
): () => RemixNode {
  const { props } = handle
  assert(
    !(props.state !== undefined && props.initialState !== undefined),
    "DraggableRenderer: provide either 'state' or 'initialState', not both",
  )

  // In uncontrolled mode, the state a drop or setState last settled on.
  let ownState: T = (props.state ?? props.initialState) as T
  const currentPropState = (): T => (props.state !== undefined ? props.state : ownState)

  let status: DragStatus<T> = {
    type: 'idle',
    state: currentPropState(),
    springOrigin: null,
  }
  let reportedStatus: DragStatus<T> | undefined
  let prevDropState: T | undefined
  let prevStatusType: DragStatus<T>['type'] | undefined

  let renderError: { error: unknown } | undefined
  const catchToRenderError: CatchToRenderError = (fn) => (...args) => {
    try {
      return fn(...args)
    } catch (error) {
      renderError ??= { error }
      void handle.update()
      throw error
    }
  }

  /** Notify listeners of whatever changed since they last heard. */
  const reportStatus = () => {
    if (status === reportedStatus) return
    reportedStatus = status
    props.onDragStatus?.(status)
    // Fire onDragState when dropState changes during drag.
    // Drop-time firing is handled imperatively in onPointerUp.
    const dropState = status.type === 'dragging' ? status.result.dropState : undefined
    if (dropState !== undefined && dropState !== prevDropState) {
      props.onDragState?.(dropState)
    }
    prevDropState = dropState
    if (status.type !== prevStatusType) {
      prevStatusType = status.type
      document.body.style.cursor = status.type === 'dragging' ? 'grabbing' : ''
    }
  }

  /** Set the status from outside render, and render it. */
  const setStatus = (newStatus: DragStatus<T>) => {
    status = newStatus
    reportStatus()
    void handle.update()
  }

  const dropState = (newState: T) => {
    if (props.state === undefined) ownState = newState
    props.onDropState?.(newState)
  }

  let pointer: Vec2 | undefined
  let pointerOverride: Vec2 | undefined
  const getPointer = () => pointerOverride ?? pointer

  // A drag that ends on the element it started on would also fire a
  // click there (the element stays in the DOM through the drag), so
  // the click that follows a drop is swallowed, default action and all
  // (so a dragged link isn't followed). Cleared on the next pointerdown
  // in case that click never comes.
  let suppressClick = false

  let svgElem: SVGSVGElement | null = null

  const setPointerFromEvent = (e: PointerEvent) => {
    assert(!!svgElem)
    const rect = svgElem.getBoundingClientRect()
    const scale = svgElem.width.baseVal.value !== 0 ? rect.width / svgElem.width.baseVal.value : 1
    pointer = Vec2((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale)
    return pointer
  }

  // Animation loop: update dragging states and spring decay each frame.
  let rafId = requestAnimationFrame(function loop() {
    if (renderError) return
    catchToRenderError(() => {
      const result = advanceFrame(status, getPointer(), performance.now())
      if (result) setStatus(result)
    })()
    rafId = requestAnimationFrame(loop)
  })

  // Document-level pointer listeners. They only act during a drag or
  // a pending drag.
  const onPointerMove = catchToRenderError((e: PointerEvent) => {
    if (props.simulateDrag) return
    if (status.type === 'idle' && status.pendingDrag) {
      // Pending: check threshold
      const { pendingDrag: pending } = status
      const clientPos = Vec2(e.clientX, e.clientY)
      const d = clientPos.sub(pending.startClientPos)
      if (d.len2() > pending.threshold * pending.threshold) {
        setPointerFromEvent(e)
        setStatus(pending.status)
      }
    } else if (status.type === 'dragging') {
      // Dragging: track pointer
      setPointerFromEvent(e)
    }
  })

  const onPointerUp = catchToRenderError((e: PointerEvent) => {
    if (props.simulateDrag) return
    if (status.type === 'idle' && status.pendingDrag) {
      // Released before threshold — clear pending, stay idle.
      setStatus({
        type: 'idle',
        state: status.state,
        springOrigin: status.springOrigin,
      })
      return
    }

    if (status.type !== 'dragging') return
    suppressClick = true
    const frame: DragFrame = { pointer: setPointerFromEvent(e) }
    const result = status.behavior(frame)
    const dropped = result.dropState
    const prevSpring = status.springOrigin

    setStatus({
      type: 'idle',
      state: dropped,
      springOrigin: makeSpringOrigin(
        result.dropTransition,
        () => runSpring(prevSpring, result.preview()),
      ),
    })
    dropState(dropped)
    props.onDragState?.(dropped)
  })

  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)

  // Both modes draw into the same place with the same structure, so
  // Remix keeps each layer (keyed by id) mounted when a drag starts or
  // ends.
  const componentHost = new ComponentHost()

  handle.signal.addEventListener('abort', () => {
    cancelAnimationFrame(rafId)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    if (status.type === 'dragging') document.body.style.cursor = ''
    componentHost.dispose()
  })

  const svgRef = (node: Element) => {
    svgElem = node as SVGSVGElement
  }
  const onPointerDownCapture = () => {
    suppressClick = false
  }
  const onClickCapture = (e: Event) => {
    if (!suppressClick) return
    suppressClick = false
    e.stopPropagation()
    e.preventDefault()
  }

  return () => {
    if (renderError) throw renderError.error

    const {
      draggable,
      width,
      height,
      showDebugOverlay,
      showVaryVisualizer,
      dragThreshold = 2,
      simulateDrag,
    } = props
    const state = currentPropState()

    // Sync internal idle state from props.state (with spring animation).
    // This covers both prop changes and post-drop corrections (where the
    // idle state reverts to startState but the prop already reflects the
    // drop target, e.g. because onDragState updated the parent mid-drag).
    if (status.type === 'idle' && status.state !== state) {
      const currentRendered = renderDraggableInert(draggable, status.state, null, false)
      const currentVisual = runSpring(status.springOrigin, currentRendered)
      status = {
        ...status,
        state,
        springOrigin: makeSpringOrigin(true, () => currentVisual),
      }
    }

    // Simulated drag: initialize a drag on the target element (assumed
    // constant). THIS IS IMPLEMENTED AS A HACK FOR DEVELOPMENT --
    // maybe there should be a beefier version of it someday.
    if (simulateDrag && status.type === 'idle' && !status.pendingDrag) {
      const simulated = startSimulatedDrag(draggable, state, simulateDrag)
      if (simulated) {
        pointerOverride = simulated.pointer
        status = simulated.status
      }
    }

    const renderCtx: RenderContext<T> = {
      draggable,
      catchToRenderError,
      setPointerFromEvent,
      setStatus,
      dropState,
      dragThreshold,
      showVaryVisualizer: showVaryVisualizer ?? false,
    }

    const layered = componentHost.frame(
      status.type === 'idle'
        ? renderIdleMode(status, renderCtx)
        : runSpring(status.springOrigin, status.result.preview()),
      status.type === 'dragging',
    )
    handle.queueTask(() => {
      componentHost.commit()
      reportStatus()
    })
    const currentPointer = getPointer()

    return (
      <svg
        width={width}
        height={height}
        xmlns='http://www.w3.org/2000/svg'
        style={{
          overflow: 'visible',
          userSelect: 'none',
          touchAction: 'none',
          ...(simulateDrag ? { pointerEvents: 'none' } : {}),
        }}
        mix={[
          ref(svgRef),
          on<SVGSVGElement, 'pointerdown'>('pointerdown', onPointerDownCapture, true),
          on<SVGSVGElement, 'click'>('click', onClickCapture, true),
        ]}
      >
        {drawLayered(layered)}
        {status.type === 'dragging' && showDebugOverlay && currentPointer &&
          OverlayVis({ op: status.result.op })}
        {simulateDrag && pointerOverride && (
          <circle
            cx={pointerOverride.x}
            cy={pointerOverride.y}
            r={4}
            fill='red'
            stroke='white'
            strokeWidth={1.5}
            opacity={0.8}
          />
        )}
      </svg>
    )
  }
}

function startSimulatedDrag<T extends object>(
  draggable: Draggable<T>,
  state: T,
  simulateDrag: { id: string; offset?: Vec2able },
): { pointer: Vec2; status: DragStatusDragging<T> } | undefined {
  const simId = simulateDrag.id
  const simOffset = simulateDrag.offset ? Vec2(simulateDrag.offset) : Vec2(0, 0)
  const content = renderDraggableInertUnlayered(draggable, state, simId, true)
  const found = findElement(content, (el) => el.props.id === simId)
  if (!found) return
  const localBounds = getLocalBounds(found.element)
  if (localBounds.empty) return
  const center = boundsCenter(localBounds)
  const pointer = localToGlobal(found.accumulatedTransform, center).add(simOffset)

  const dragSpec = getOnDragCallbackOnElement<T>(found.element)?.()
  const draggedPath = getPath(found.element)
  if (!dragSpec || !draggedPath) return
  const behaviorCtx: DragInitContext<T> = {
    draggable,
    draggedPath,
    draggedId: simId,
    anchorPos: center,
    startState: state,
    debug: { varyVisualizer: false },
  }
  const frame: DragFrame = { pointer }
  return { pointer, status: initDrag(dragSpec, behaviorCtx, state, frame, null) }
}

// # Helpers

/**
 * Blends a target render with a spring's startLayered.
 * The target is used as the base (first arg to lerpLayered) so its
 * non-interpolatable props (like event handlers) are preserved.
 * Layers with dragologyTransition={false} are never sprung — they
 * always show the target's version so they track the cursor.
 */
function runSpring(
  springOrigin: SpringOrigin | null,
  target: LayeredSvgx,
): LayeredSvgx {
  if (!springOrigin) return target
  const elapsed = performance.now() - springOrigin.time
  const t = applyEasing(springOrigin.transition, elapsed)
  // What can't be blended comes from the target.
  const lerped = lerpLayered(target, springOrigin.layered, 1 - t, 'a')
  // Replace non-transitioning layers with the target's version so they
  // track the cursor without spring lag.
  for (const [key, layer] of lerped.byId.entries()) {
    if (layer.element.props['dragologyTransition'] === false) {
      const targetVal = target.byId.get(key)
      if (targetVal) {
        lerped.byId.set(key, targetVal)
      }
    }
  }
  return lerped
}

function advanceFrame<T extends object>(
  status: DragStatus<T>,
  pointer: Vec2 | undefined,
  now: number,
): DragStatus<T> | null {
  if (status.type === 'dragging') {
    if (!pointer) return null
    const frame: DragFrame = { pointer }
    const result = status.behavior(frame)

    // Handle chaining: restart drag from new state
    const chained = resolveChainNows(status, frame, result)
    if (chained !== status) return chained

    let springOrigin = status.springOrigin

    // Detect activePath change → start new spring from current display
    if (result.activePath !== status.result.activePath) {
      springOrigin = makeSpringOrigin(
        result.activePathTransition,
        () => runSpring(springOrigin, status.result.preview()),
      )
    }

    // Clear expired spring
    if (
      springOrigin &&
      now - springOrigin.time >= springOrigin.transition?.duration!
    ) {
      springOrigin = null
    }

    return { ...status, result, springOrigin }
  }

  if (status.type === 'idle' && status.springOrigin) {
    if (
      now - status.springOrigin.time >=
        status.springOrigin.transition.duration
    ) {
      return { ...status, springOrigin: null }
    }
    // Force re-render so spring progress advances
    return { ...status }
  }

  return null
}

/**
 * If a drag result has chainNow set (e.g. from switchToStateAndFollow),
 * process it immediately: find the new element, set up a new drag from it,
 * and return the new drag state. Returns the original status if no chaining needed.
 */
function resolveChainNows<T extends object>(
  status: DragStatusDragging<T>,
  frame: DragFrame,
  result: DragResult<T>,
): DragStatusDragging<T> {
  if (!result.chainNow || _.isEqual(result.dropState, status.startState)) {
    return status
  }

  const newState = result.dropState
  const newDraggedId = result.chainNow.draggedId ?? status.behaviorCtx.draggedId
  const content = renderDraggableInertUnlayered(
    status.behaviorCtx.draggable,
    newState,
    newDraggedId,
    true,
  )
  const found = newDraggedId
    ? findElement(content, (el) => el.props.id === newDraggedId)
    : findByPath(status.behaviorCtx.draggedPath, content)

  assert(
    !!found,
    `Chained drag must have a valid dragged element; couldn't find element with id ${newDraggedId}`,
  )

  const newDragSpec = result.chainNow.followSpec ??
    getOnDragCallbackOnElement<T>(found.element)?.()
  if (!newDragSpec) return status

  // We construct a spring origin to emulate what was rendered here
  // before. That means: no references to the new `result`!
  const chainTransition = result.chainNow.transition
  const newSpringOrigin = makeSpringOrigin(
    chainTransition,
    () => runSpring(status.springOrigin, status.result.preview()),
  )

  const newDraggedPath = getPath(found.element)
  assert(!!newDraggedPath, 'Chained element must have a path')

  const anchorPos = status.behaviorCtx.anchorPos

  return initDrag(
    newDragSpec,
    {
      ...status.behaviorCtx,
      draggedPath: newDraggedPath,
      draggedId: newDraggedId,
      anchorPos,
      startState: newState,
    },
    newState,
    frame,
    newSpringOrigin,
  )
}

function initDrag<T extends object>(
  spec: DragSpec<T>,
  behaviorCtx: DragInitContext<T>,
  state: T,
  frame: DragFrame,
  springOrigin: SpringOrigin | null,
): DragStatusDragging<T> {
  const behavior = dragSpecToBehavior(spec, behaviorCtx)
  const result = behavior(frame)

  const status: DragStatusDragging<T> = {
    type: 'dragging',
    startState: state,
    behavior,
    specForDropZoneVis: spec,
    behaviorCtx,
    result,
    springOrigin,
  }

  // This code used to check for chaining, via:
  //
  // return resolveChainNows(status, frame, result);
  //
  // That was (maybe?) important because `switchToStateAndFollow`
  // used chaining, and we wanted the switch to occur without delay.
  // But now switchToStateAndFollow does its own thing. And we want
  // to support "chain on every frame" for things like
  // chain-of-links, which suggests that you only chain once per
  // frame. So:

  return status
}

// # Render context

type RenderContext<T extends object> = {
  draggable: Draggable<T>
  catchToRenderError: CatchToRenderError
  setPointerFromEvent: (e: PointerEvent) => Vec2
  setStatus: (ds: DragStatus<T>) => void
  dropState: (state: T) => void
  dragThreshold: number
  showVaryVisualizer: boolean
}

const onMixinType = on<HTMLElement, 'click'>('click', () => {}).type

/** Does this element have a click or double-click handler in its `mix`? */
function hasClickHandler(el: Svgx): boolean {
  const mix: unknown[] = Array.isArray(el.props.mix)
    ? el.props.mix
    : el.props.mix
    ? [el.props.mix]
    : []
  return mix.flat(Infinity).some((descriptor) => {
    if (!descriptor || typeof descriptor !== 'object') return false
    const { type, args } = descriptor as { type?: unknown; args?: unknown[] }
    return type === onMixinType && (args?.[0] === 'click' || args?.[0] === 'dblclick')
  })
}

/**
 * Checks whether the element at `targetPath` or any of its ancestors
 * in the JSX tree has a click or double-click handler.
 */
function ancestorOrSelfHasClickHandler(root: Svgx, targetPath: string): boolean {
  const found = findByPath(targetPath, root)
  if (!found) return false
  return [...found.ancestors, found.element].some(hasClickHandler)
}

/** Put a grab cursor under the author's style, object or string. */
function withGrabCursor(style: unknown): unknown {
  if (typeof style === 'string') return `cursor: grab; ${style}`
  return { cursor: 'grab', ...((style as object | undefined) ?? {}) }
}

function postProcessForInteraction<T extends object>(
  content: Svgx,
  state: T,
  ctx: RenderContext<T>,
): LayeredSvgx {
  const withPaths = assignPaths(content)
  return pipe(
    withPaths,
    (el) =>
      updatePropsDownTree(el, (el) => {
        const onDragCallback = getOnDragCallbackOnElement<T>(el)
        if (!onDragCallback) return
        const onPointerDown = ctx.catchToRenderError((e: PointerEvent) => {
          e.stopPropagation()
          const pointer = ctx.setPointerFromEvent(e)

          const dragSpec: DragSpec<T> = onDragCallback()
          const draggedId = el.props.id ?? null
          const draggedPath = getPath(el)
          assert(!!draggedPath, 'Dragged element must have a path')

          // TODO: could instead provide the accumulatedTransform
          // via updatePropsDownTree?
          const found = findByPath(draggedPath, withPaths)
          assert(!!found, 'Dragged element must be findable by path')
          const anchorPos = globalToLocal(found.accumulatedTransform, pointer)

          const behaviorCtx: DragInitContext<T> = {
            draggable: ctx.draggable,
            draggedPath,
            draggedId,
            anchorPos,
            startState: state,
            debug: { varyVisualizer: ctx.showVaryVisualizer },
          }

          const frame: DragFrame = { pointer }
          const draggingStatus = initDrag(dragSpec, behaviorCtx, state, frame, null)

          if (ctx.dragThreshold <= 0 || !ancestorOrSelfHasClickHandler(withPaths, draggedPath)) {
            ctx.setStatus(draggingStatus)
          } else {
            // Stay idle with pending — DOM is preserved, clicks still work.
            ctx.setStatus({
              type: 'idle',
              state,
              springOrigin: null,
              pendingDrag: {
                startClientPos: Vec2(e.clientX, e.clientY),
                threshold: ctx.dragThreshold,
                status: draggingStatus,
              },
            })
          }
        })
        const mix = el.props.mix === undefined ? [] : [el.props.mix].flat(Infinity)
        return {
          // put cursor first, so it's overriden by author-defined cursor
          style: withGrabCursor(el.props.style),
          mix: [...mix, on<SVGElement, 'pointerdown'>('pointerdown', onPointerDown)],
        }
      }),
    layerSvg,
  )
}

// # Render modes

function renderIdleMode<T extends object>(
  status: DragStatus<T> & { type: 'idle' },
  ctx: RenderContext<T>,
): LayeredSvgx {
  const content = ctx.draggable(
    makeDraggableProps({
      state: status.state,
      draggedId: null,
      setState: ctx.catchToRenderError(
        (
          newState: SetStateAction<T>,
          { transition }: { transition?: TransitionLike } = {},
        ) => {
          const resolved = typeof newState === 'function'
            ? (newState as (prev: T) => T)(status.state)
            : newState
          const newStatus: DragStatus<T> = {
            type: 'idle',
            state: resolved,
            springOrigin: makeSpringOrigin(
              transition,
              () => renderDraggableInert(ctx.draggable, status.state, null, false),
            ),
          }
          ctx.setStatus(newStatus)
          ctx.dropState(resolved)
        },
      ),
      isTracking: false,
    }),
  )

  const layered = postProcessForInteraction(content, status.state, ctx)
  return runSpring(status.springOrigin, layered)
}
