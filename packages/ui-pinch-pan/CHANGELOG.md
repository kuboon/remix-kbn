# `ui-pinch-pan` CHANGELOG

This is the changelog for [`ui-pinch-pan`](https://github.com/kuboon/remix-kbn/tree/main/packages/ui-pinch-pan). It follows [semantic versioning](https://semver.org/).

## 0.4.0

Follows Remix v3 `3.0.0` (stable).

- `@remix-run/ui` `^0.11.0` → `@remix-run/component` `^1.0.0`. The component runtime moved back out of `@remix-run/ui` in Remix 3.0.0, so the imports and `jsxImportSource` follow. No other code changed; the symbols this package uses are the same in `component@1.0.0`.
- The other `@remix-run/*` ranges move to `^1.0.0`.

## 0.3.0

Follows Remix v3 `rc.4`.

- `@remix-run/ui` `^0.10.0` → `^0.11.0`. No code in this package changed: `ui@0.11.0` is additive
  (it adds `diffElementAttributes` and tightens `clientEntry`'s props typing, neither of which this
  package touches) and the mixin authoring API is byte-identical. The range moves anyway, because
  `^0.11.0` does not include 0.10 — a consumer on rc.4 with this package left at `^0.10.0` would
  resolve **two copies of the UI runtime**, and module-level state would then exist twice with no
  error.

## 0.2.0

Moved to the `@remix-kbn` scope, split into the two halves it always was, and taught the wheel.

- Moved to the `@remix-kbn` scope: this package is **`@remix-kbn/ui-pinch-pan`** from 0.2.0 on. The
  `remix-` prefix went with the move, because the scope says it now.

  ```diff
  - "@kuboon/remix-ui-pinch-pan": "jsr:@kuboon/remix-ui-pinch-pan@^0.1.0"
  + "@remix-kbn/ui-pinch-pan": "jsr:@remix-kbn/ui-pinch-pan@^0.2.0"
  ```

  Unlike the other packages in this repository, there is nothing to forward from. `@kuboon/remix-ui-pinch-pan` is archived on JSR and its only version, 0.1.0, was yanked — so no release under the old name carries the usual "this is moving" notice, and none can be made. Nothing resolves to the old name today, so nothing breaks. 0.2.0 under the new name is the first version anyone can install, and the minor bump keeps 0.1.0 from naming two different things.

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
