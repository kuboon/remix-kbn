# `dragology` CHANGELOG

This is the changelog for [`dragology`](https://github.com/kuboon/remix-kbn/tree/main/packages/dragology). It follows [semantic versioning](https://semver.org/).

## 0.1.0

First release: [Dragology](https://github.com/declarative-dragging/dragology) 0.1.7 ported from React to Remix v3 (`@remix-run/component` `^1.1.0`). See the README for what differs from upstream.

The `dragology*` JSX props are exported as `DragologyHostProps` / `DragologyComponentProps` rather than added to Remix's JSX types by the package, which JSR doesn't allow; an app adds them with a short augmentation (see the README).
