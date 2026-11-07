// Adds Dragology's props (`dragologyOnDrag`, `dragologyZIndex`, ...) to
// the JSX types. A JSR package may not change another package's or
// global types, so @remix-kbn/dragology can't do this itself: copy this
// file into your app (importing from '@remix-kbn/dragology') and import
// it once, e.g. `import './dragology-jsx.ts'` in your entry module.
import type {} from '@remix-run/component'
import type { DragologyComponentProps, DragologyHostProps } from './src/mod.ts'

declare module '@remix-run/component' {
  // Every intrinsic element's props extend HostProps.
  // deno-lint-ignore no-empty-interface no-unused-vars
  interface HostProps<eventTarget extends EventTarget> extends DragologyHostProps {}
}

declare global {
  // deno-lint-ignore no-namespace
  namespace JSX {
    // deno-lint-ignore no-empty-interface
    interface IntrinsicAttributes extends DragologyComponentProps {}
  }
}
