# @remix-kbn/dragology

[Dragology](https://github.com/declarative-dragging/dragology) — declarative, model-driven
dragging for SVG — ported from React to Remix v3 (`@remix-run/component`).

You describe a UI as a pure function from state to SVG and attach a _drag spec_ to the elements
that can be dragged: which states the element can be dragged between, or which parts of the state
it varies. Dragology does the rest: interpolating mid-drag, snapping on drop, and animating
transitions. The ideas are explained at
[Declarative Dragging](https://declarative-dragging.github.io/).

```tsx
import { createRoot } from '@remix-run/component'
import { type Draggable, DraggableRenderer, translate } from '@remix-kbn/dragology'

type State = { status: 'on' | 'off' }

const toggle: Draggable<State> = ({ state, d }) => (
  <g transform={translate(20, 20)}>
    <rect width={120} height={60} rx={30} fill={state.status === 'on' ? '#22c55e' : '#d1d5db'} />
    <circle
      id='knob'
      transform={state.status === 'on' ? translate(90, 30) : translate(30, 30)}
      r={26}
      fill='white'
      dragologyOnDrag={() => d.between([{ status: 'off' }, { status: 'on' }])}
    />
  </g>
)

createRoot(document.getElementById('root')!).render(
  <DraggableRenderer
    draggable={toggle}
    initialState={{ status: 'off' }}
    width={160}
    height={100}
  />,
)
```

Set `"jsx": "react-jsx"` and `"jsxImportSource": "@remix-run/component"` in your `compilerOptions`,
as for any Remix v3 UI code.

[`AGENTS.md`](./AGENTS.md) is upstream's usage guide (the `Draggable` model, every drag spec, ids
and layers, gotchas), adapted to this port. [`example/main.tsx`](./example/main.tsx) has a toggle,
a slider, a reorderable list and cards holding stateful components; run it with
`deno task example` and open <http://localhost:8000>.

## What differs from upstream

The engine — drag specs, operators, interpolation, layering, the math — is upstream's code. What
changed is everything that touched React:

- **`DraggableRenderer` is a Remix component.** Same props: `draggable`, `state` + `onDropState`
  (controlled) or `initialState` (uncontrolled), `onDragState`, `onDragStatus`, `width`,
  `height`, `dragThreshold`, `showDebugOverlay`, `showVaryVisualizer`, `simulateDrag`.
- **Events are mixins.** Write `mix={[on('click', …)]}` where upstream writes `onClick`. A drag's
  `pointerdown` is added to the element's `mix`, and a pointerdown threshold still lets click
  handlers fire on draggable elements (Dragology looks for `on('click')` / `on('dblclick')` in
  the element's or an ancestor's `mix`).
- **Component elements are Remix components** (`(handle) => () => …`). Each one is mounted once,
  in a root of its own, and kept mounted through drags and reorders. Because it has its own root,
  `handle.context` from outside the renderer doesn't reach it; pass what it needs as props.
  Events bubble through the DOM, so a `pointerdown` inside one starts the enclosing drag unless the
  component stops it.
- **`<foreignObject>` is drawn by Dragology, not Remix.** `@remix-run/component` creates the
  foreignObject element itself in the HTML namespace, where it renders nothing
  ([remix-run/remix#12231](https://github.com/remix-run/remix/issues/12231)); Dragology keeps a
  real SVG `foreignObject` in its place. As upstream, it may only contain component elements.
- **Debug views:** the SVG overlay (`showDebugOverlay`) is ported, and `OverlayVis` /
  `DistanceLine` are plain functions you call rather than components. Upstream's HTML spec-tree
  view (`treeView`, `Box`, `OutputThumbnail`, `StateThumbnails`), `ValueView`, `ErrorBoundary`
  and the demo site are not part of this port. Errors that upstream renders as JSX are plain
  `Error` messages here.

## License

MIT, as upstream. See [LICENSE](./LICENSE).
