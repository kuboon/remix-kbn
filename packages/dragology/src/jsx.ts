import type {} from '@remix-run/component'
import type { DragSpecBrand } from './DragSpec.tsx'

declare module '@remix-run/component' {
  // Every intrinsic element's props extend HostProps.
  interface HostProps<eventTarget extends EventTarget> {
    /**
     * Custom attribute for attaching drag specifications to SVG elements.
     * Set to a function returning a DragSpec.
     *
     * @example
     * <circle dragologyOnDrag={() => d.vary(state, [["x"], ["y"]])} />
     *
     * @example
     * <rect dragologyOnDrag={() => d.between([state1, state2])} />
     */
    dragologyOnDrag?: (() => DragSpecBrand) | false | null | undefined

    dragologyZIndex?: number | string | false | null
    dragologyTransition?: boolean
    dragologyEmergeFrom?: string
    dragologyEmergeMode?: 'clone' | 'scale'
    dragologyOpaque?: boolean
    dragologyKey?: string
  }
}

declare global {
  namespace JSX {
    // The one prop Dragology reads off component elements like
    // <NoteWidget /> (intrinsic elements don't get it). Everything else
    // on a component, `id` included, is the component's own.
    interface IntrinsicAttributes {
      /**
       * On a component element: props to interpolate when Dragology
       * blends two renders (e.g. mid-`d.between`, or a drop animation).
       * Numbers, colors, and same-shaped arrays/objects of them blend;
       * anything else isn't. `true` means all props. Props that aren't
       * blended come from the render being animated toward (mid-
       * `d.between`, from the nearest state).
       */
      dragologyLerpProps?: readonly string[] | boolean
    }
  }
}
