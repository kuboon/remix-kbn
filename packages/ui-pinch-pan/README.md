# @kuboon/remix-ui-pinch-pan

Pinch, pan and wheel as a [`@remix-run/ui`](https://www.npmjs.com/package/@remix-run/ui) mixin.

```sh
deno add jsr:@kuboon/remix-ui-pinch-pan
```

```tsx
import { pinchPan } from '@kuboon/remix-ui-pinch-pan'
<div class='viewport' mix={[pinchPan({ maxScale: 6 })]}>
  <img src='/map.png' alt='' />
</div>
```

The host element listens; its content is transformed. Nothing else is required — the mixin sets
`touch-action: none` on the host and `transform-origin: 0 0` on the content itself, because both are
load-bearing and both are easy to forget.

## How the gesture behaves

A gesture runs while two or more accepted pointers are down. One rule produces all of it: **the
content point under the fingers' centroid stays under their centroid.** Moving both fingers pans,
spreading them zooms about the point between them, and doing both does both.

The wheel is the same rule with the cursor in place of the centroid, and by default the modifier
decides which half of it applies:

| Input                              | What happens          |
| ---------------------------------- | --------------------- |
| Two fingers on a touchscreen       | Pinch and pan         |
| Two-finger scroll on a trackpad    | Pan                   |
| Two-finger **pinch** on a trackpad | Zoom about the cursor |
| Mouse wheel                        | Pan                   |
| `Ctrl` / `⌘` + wheel               | Zoom about the cursor |

A trackpad pinch is not a special case anyone has to detect: the browser reports it as a wheel
event with `ctrlKey` set, which is exactly the same thing the keyboard modifier sends. So a laptop
behaves like a phone without the mixin knowing what it is running on. Pass `wheel: 'zoom'` for the
map-like variant where every wheel zooms, or `wheel: false` to leave the wheel to the page.

Touch and wheel share one transform rather than each keeping their own, so they can be mixed
freely — pinch the trackpad, scroll, then grab the touchscreen, and the view carries on from where
it was.

Three consequences are worth knowing, because they are what a hand-rolled version usually gets
wrong:

- **Reaching a scale limit does not slide the content.** The scale is clamped before the translation
  is solved, so a pinch that hits `maxScale` simply stops growing. Clamping the finished transform
  instead lets the content drift out from under the fingers at the limit.
- **Changing fingers mid-gesture does not jump.** Adding or lifting a finger re-anchors against the
  transform the content already has, rather than continuing to measure against a set that is no
  longer down.
- **Zooming in and back out returns to the same scale.** The wheel's factor is exponential in the
  delta, so the two cancel. A linear factor does not, and the drift is visible within a few flicks.

Mouse _drags_ are ignored by default. One mouse pointer cannot pinch, and claiming its drags would
take them away from text selection and from the page; pass `pointerTypes` if the host has no other
use for them. The wheel is handled either way.

## The two halves

The package is split where the two hard parts are, and both halves are exported, because either is
useful without the other.

```
pointers, wheel ──▶ GestureRecognizer ──▶ Transform ──▶ TransformApplier ──▶ the screen
                    (reading it)                        (running it)
```

`pinchPan()` is the DOM between them: listening, pointer capture, `touch-action`, and measuring
where the content's corner is.

### Reading the gesture

`createGestureRecognizer()` takes input as plain numbers and answers with transforms. No element,
no painting, no clock — so a component that gets its input from somewhere else can drive it
directly, and its behaviour is testable without a browser.

```ts
import { createGestureRecognizer } from '@kuboon/remix-ui-pinch-pan'

let view = createGestureRecognizer({ maxScale: 8 })

view.pointerDown({ id: 1, x: 0, y: 0 })
view.pointerDown({ id: 2, x: 100, y: 0 })
let { transform, phase, consumed } = view.pointerMove({ id: 2, x: 200, y: 0 })
// transform.scale === 2, phase === 'move'

view.wheel({ at: { x: 50, y: 50 }, deltaX: 0, deltaY: -120, ctrlKey: true })
```

Every method answers with the same record: the `transform` reached, whether it `changed`, the
`phase` (`idle` / `start` / `move` / `end`), and whether the input was `consumed` — the caller's
cue to call `preventDefault()`. `consumed` is separate from `changed` because an input can be
claimed and move nothing: a pinch held at `maxScale` is still the gesture's, and letting the page
scroll under it would be worse than doing nothing.

A wheel has no "up" event, so whoever owns the clock decides when a burst is over and calls
`settle()`. That is the mixin's job, and it is why the recognizer has no timer of its own.

Points are in the content's own coordinate space: its untransformed box, origin at the top-left.
The mixin converts from client coordinates by measuring that corner once per interaction.

### Running it

An applier is what puts a transform on screen, and which one runs is an option:

| Applier                      | What it does                                                |
| ---------------------------- | ----------------------------------------------------------- |
| `cssTransform()` _(default)_ | Writes `style.transform` on the content                     |
| `cssVariables()`             | Writes `--pinch-pan-x` / `-y` / `-scale` for the stylesheet |
| your own function            | `(transform, { host, content, signal }) => void`            |
| `null`                       | Nothing is painted; drive it from `onChange`                |

It is a plain function called on every change, with no attach or dispose step — writing another is
writing a function, and two of them compose by being called one after the other:

```ts
let both: TransformApplier = (transform, target) => {
  cssTransform()(transform, target)
  report(transform)
}
```

`cssVariables()` is the one worth knowing about, because it moves the decision out of JavaScript
entirely:

```tsx
<div mix={[pinchPan({ applier: cssVariables() })]}>
  <div class='paper'>…</div>
</div>
```

```css
.paper {
  transform-origin: 0 0;
  transform: translate(var(--pinch-pan-x), var(--pinch-pan-y)) scale(var(--pinch-pan-scale));
}
```

### The arithmetic

Underneath both halves are three pure functions, exported for a component that owns its own input
handling and only wants the part that decides where the content lands:

- `zoomAt(transform, at, factor, limits?)` — scale about a point that must not move
- `panBy(transform, dx, dy)` — move without scaling
- `advanceGesture(anchor, pointers, limits?)` — the two of them, driven by a set of fingers

A pinch _is_ `zoomAt` about the anchor centroid followed by `panBy` the distance the centroid
travelled, and `advanceGesture` is written that way rather than as its own algebra. The wheel is
the same two calls with the cursor in place of the centroid, which is why the two kinds of input
need no reconciliation.

## Options

All optional.

| Option                           | Default                            |                                                                                                              |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `content`                        | first element child, else the host | Selector or `(host) => Element` for the element that receives the transform                                  |
| `minScale` / `maxScale`          | `0` / `Infinity`                   | Scale bounds                                                                                                 |
| `initial`                        | identity                           | Where the view starts, and where `reset()` returns to                                                        |
| `applier`                        | `cssTransform()`                   | What puts the transform on screen. `null` to paint it yourself from `onChange`                               |
| `wheel`                          | `'auto'`                           | `'auto'` \| `'zoom'` \| `'pan'` \| `false`                                                                   |
| `zoomSpeed`                      | `0.0025`                           | How fast the wheel zooms, per pixel of delta                                                                 |
| `wheelSettleMs`                  | `120`                              | How long after the last wheel event `onEnd` fires                                                            |
| `touchAction`                    | `true`                             | Set `touch-action: none` on the host. Without it the browser claims the gesture and no `pointermove` arrives |
| `pointerTypes`                   | `['touch', 'pen']`                 | Pointer types that take part. The wheel is handled regardless                                                |
| `onStart` / `onChange` / `onEnd` | —                                  | `(transform) => void`                                                                                        |
| `controls`                       | —                                  | `(controls, signal) => void`, called once the host is inserted                                               |

Any `wheel` setting but `false` takes the wheel over the host away from the page, the same way
`touchAction` takes the touch. For a viewer inside a scrolling article that is usually not what you
want; `'auto'` at least leaves the zoom on the modifier people already use.

`controls` is how the rest of the component drives the view — a reset button, a zoom control, a
"fit" action:

```tsx
let view: PinchPanControls | null = null
<div mix={[pinchPan({ maxScale: 8, controls: (api) => (view = api) })]}>
  <img src='/map.png' alt='' />
</div>
<button mix={[on('click', () => view?.reset())]}>Reset</button>
```

`signal` is aborted when the host leaves the document, so anything you hang off `controls` can be
torn down with it.

## Testing a gesture

The recognizer is plain arithmetic over plain numbers, and that is where the behaviour is tested
here — including the wheel, whose delta modes and modifiers are ordinary function arguments. What a
unit test cannot tell you is whether the browser ever delivers the events: that depends on
`touch-action`, on pointer capture, and on the host actually being the element under the fingers.
Exercise it on a real touch device, or synthesize input through CDP (`Input.dispatchTouchEvent`,
`Input.dispatchMouseEvent` with `type: 'mouseWheel'`); DevTools' device emulation gives you one
finger, which is not a pinch.

## License

MIT
