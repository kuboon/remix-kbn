// Adds Dragology's props to the JSX types, as an app using
// @remix-kbn/dragology does (see packages/dragology/README.md).
import type {} from '@remix-run/component'
import type { DragologyComponentProps, DragologyHostProps } from '@remix-kbn/dragology'

declare module '@remix-run/component' {
  // Every intrinsic element's props extend HostProps.
  interface HostProps<eventTarget extends EventTarget> extends DragologyHostProps {}
}

declare global {
  namespace JSX {
    interface IntrinsicAttributes extends DragologyComponentProps {}
  }
}
