# @kuboon/remix-ui-pinch-pan

## 0.2.0

Split into the two halves it always was, and taught the wheel.

- **Reading and running are separate.** `createGestureRecognizer()` takes pointers and wheels as
  plain numbers and answers with transforms — no element, no painting, no clock. `pinchPan()` is
  now the DOM between it and an applier.
- **The execution is swappable.** A `TransformApplier` is `(transform, target) => void`;
  `cssTransform()` is the default and `cssVariables()` hands the numbers to the stylesheet. This
  replaces the `apply` boolean: `apply: false` becomes `applier: null`.
- **The wheel is handled.** `'auto'` by default, where `Ctrl` / `⌘` zooms about the cursor and
  anything else pans — which makes a trackpad behave like a touchscreen, since the browser reports
  a trackpad pinch as exactly that. `'zoom'`, `'pan'` and `false` are the other settings, with
  `zoomSpeed` and `wheelSettleMs` beside them. Line and page deltas are read as pixels, so Firefox
  behaves like the rest.
- **Touch and wheel share one transform**, so a gesture of either kind continues from where the
  other left the view.
- `zoomAt()` and `panBy()` are exported, and `advanceGesture()` is written in terms of them: a
  pinch is a zoom about the fingers' centroid plus a pan by how far it travelled, and a wheel is
  the same two calls about the cursor.
- `onEnd` now also fires for the wheel, once it has been still for `wheelSettleMs`.

## 0.1.0

Initial release.

- `pinchPan()` — a `@remix-run/ui` mixin for two-finger pinch and pan on touch and pen input. The
  host listens, its content is transformed, and the content point under the fingers' centroid stays
  under their centroid.
- The scale is clamped before the translation is solved, so reaching `minScale` / `maxScale` stops
  the zoom without sliding the content out from under the fingers.
- Adding or lifting a finger re-anchors against the transform the content already has, so the view
  does not jump mid-gesture.
- `controls` hands the rest of the component `set()` / `reset()` and the current transform.
- `anchorGesture()` / `advanceGesture()` are exported on their own for components that paint the
  view themselves.
