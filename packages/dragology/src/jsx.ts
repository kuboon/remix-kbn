import type { DragSpecBrand } from './DragSpec.tsx'

// The props Dragology reads off JSX elements. JSR doesn't allow a
// package to change global or another package's types, so they aren't
// added to the JSX types here: an app adds them with an augmentation
// of its own (see `dragology-jsx.ts` and the README).

/** Dragology's props on intrinsic SVG elements (`<g>`, `<circle>`, ...). */
export interface DragologyHostProps {
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

/**
 * The one prop Dragology reads off component elements like
 * <NoteWidget /> (intrinsic elements don't get it). Everything else on
 * a component, `id` included, is the component's own.
 */
export interface DragologyComponentProps {
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
