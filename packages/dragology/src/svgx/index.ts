import { Fragment, type RemixElement, type RemixNode } from '@remix-run/component'
import { jsx } from '@remix-run/component/jsx-runtime'
import { combineTransforms } from './transform.ts'

// SVGX is our slang for "messing around with SVG represented as
// Remix elements, generally provided by an author as JSX".

// deno-lint-ignore no-explicit-any
export type SvgxProps = Record<string, any>
export type Svgx = RemixElement & { props: SvgxProps }

/** Remix's counterpart of React.isValidElement. */
export function isValidElement(node: unknown): node is Svgx {
  if (typeof node !== 'object' || node === null) return false
  const { $rmx, type, props } = node as Partial<RemixElement>
  return (
    $rmx === true &&
    (typeof type === 'string' || typeof type === 'function') &&
    typeof props === 'object' &&
    props !== null
  )
}

/**
 * Rebuild an element with new props, keeping its key unless `key` is
 * given. The counterpart of React.createElement / cloneElement.
 */
export function createSvgx(
  type: RemixElement['type'],
  props: SvgxProps,
  key?: unknown,
): Svgx {
  return jsx(type, props, key) as Svgx
}

/** Like React.cloneElement: shallow-merge `props` over the element's. */
export function cloneSvgx(element: Svgx, props: SvgxProps = {}): Svgx {
  const { key, ...rest } = props
  return createSvgx(
    element.type,
    { ...element.props, ...rest },
    key !== undefined ? key : element.key,
  )
}

/**
 * Like React.Children.toArray, without the keying: flattens nested
 * arrays and drops nullish and boolean children.
 */
export function flattenChildren(
  children: RemixNode,
): Exclude<RemixNode, boolean | null | undefined | RemixNode[]>[] {
  const out: Exclude<RemixNode, boolean | null | undefined | RemixNode[]>[] = []
  const visit = (node: RemixNode) => {
    if (Array.isArray(node)) node.forEach(visit)
    else if (node == null || typeof node === 'boolean') return
    else out.push(node)
  }
  visit(children)
  return out
}

/**
 * This doesn't actually check if it's SVG; it's just
 * isValidElement for situations where you know you're in a
 * SVGX tree but don't know if this is an element.
 */
export function isValidSvgx(element: unknown): element is Svgx {
  return isValidElement(element)
}

/**
 * Is this a component element (`<NoteWidget />`) rather than an
 * intrinsic one (`<g>`, `<div>`)? Dragology never calls components:
 * Remix mounts them once and DraggableRenderer keeps them mounted
 * (see svgx/componentHost.tsx).
 */
export function isComponentElement(element: Svgx): boolean {
  return typeof element.type !== 'string' && element.type !== Fragment
}

/**
 * On a component element, only `dragologyLerpProps` is Dragology's;
 * every other prop, `id` included, is the component's own. To give a
 * component an id or dragologyKey, wrap it in a <g>.
 */
export function assertNoDragologyKeyOnComponent(element: Svgx): void {
  if (isComponentElement(element) && element.props.dragologyKey !== undefined) {
    throw new Error(
      `<${elementName(element)}> has a dragologyKey, which only works on ` +
        `intrinsic elements. Wrap it in a <g dragologyKey=…> instead.`,
    )
  }
}

/**
 * Dragology owns SVG; HTML belongs to components. So a foreignObject may
 * only hold component elements, which render their HTML themselves.
 */
export function assertForeignObjectHoldsComponents(element: Svgx): void {
  if (element.type !== 'foreignObject') return
  for (const child of flattenChildren(element.props.children)) {
    if (isValidElement(child) && isComponentElement(child)) {
      continue
    }
    const what = isValidElement(child) ? `<${elementName(child as Svgx)}>` : JSON.stringify(child)
    throw new Error(
      `<foreignObject> contains ${what}, but it may only contain ` +
        `component elements. Move the HTML into a component.`,
    )
  }
}

/** "NoteWidget" for <NoteWidget />, "g" for <g>; for error messages. */
export function elementName(element: Svgx): string {
  const type = element.type as any
  return typeof type === 'string' ? type : (type.displayName ?? type.name)
}

/**
 * Determines if we should recurse into an element's children when
 * walking the tree. Returns false for stuff that shouldn't get
 * processed or layered.
 */
export function shouldRecurseIntoChildren(element: Svgx): boolean {
  return (
    !isComponentElement(element) &&
    element.type !== 'defs' &&
    !element.props.dragologyOpaque
  )
}

type ChildNode = Exclude<RemixNode, boolean | null | undefined | RemixNode[]>

/**
 * Flattens nested arrays, drops nullish and boolean children, and keys
 * elements by position, keeping a key from an earlier call unchanged,
 * so a tree rebuilt twice gets the same keys as one rebuilt once and
 * Remix doesn't remount anything.
 *
 * Keys we assign start with "."; any other key came from the author,
 * which isn't allowed.
 */
export function childrenToArray(children: RemixNode): ChildNode[] {
  const out: ChildNode[] = []
  const visit = (node: RemixNode, prefix: string) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, prefix === '' ? `.${i}` : `${prefix}:${i}`))
    } else if (node == null || typeof node === 'boolean') {
      return
    } else if (isValidElement(node) && node.key == null) {
      out.push(createSvgx(node.type, node.props, prefix || '.0'))
    } else if (isValidElement(node) && !String(node.key).startsWith('.')) {
      throw new Error(
        `<${elementName(node)}> has a key prop (${node.key}). ` +
          `Draggables match elements by id or dragologyKey, not key.`,
      )
    } else {
      out.push(node as ChildNode)
    }
  }
  visit(children, '')
  return out
}

/**
 * A helpful utility to map over an element's children and/or update
 * its props. Not inherently recursive – feel free to recurse in
 * childFn.
 *
 * One special feature: If any newProps values are undefined, the
 * keys will be entirely removed from the element's props.
 * (A plain spread wouldn't do this.)
 */
export function updateElement(
  element: Svgx,
  childFn?: (el: Svgx, idx: number) => Svgx | null,
  newProps?: SvgxProps,
): Svgx {
  const { children } = element.props

  if (childFn && children && shouldRecurseIntoChildren(element)) {
    const childrenArray = childrenToArray(children)
    let someChildChanged = false
    const newChildren = childrenArray.map((child, index) => {
      if (isValidElement(child)) {
        const updated = childFn(child, index)
        if (updated !== child) someChildChanged = true
        return updated
      } else {
        // Preserve non-element children (like text nodes)
        return child
      }
    })
    if (someChildChanged) {
      newProps = { ...newProps, children: newChildren }
    }
  }

  if (!newProps) return element

  // Drop undefined values so that they actually remove props.
  const merged = { ...element.props, ...newProps }
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) cleaned[k] = v
  }

  return createSvgx(element.type, cleaned, element.key ?? undefined)
}

export type FindElementResult = {
  element: Svgx
  accumulatedTransform: string
  /** Does not include element itself */
  ancestors: Svgx[]
}

export function findElement(
  element: Svgx,
  predicate: (el: Svgx) => boolean,
  accumulatedTransform: string = '',
  ancestors: Svgx[] = [],
): FindElementResult | null {
  const elementTransform = (element.props as any).transform || ''
  const newAccumulatedTransform = combineTransforms(
    accumulatedTransform,
    elementTransform,
  )

  if (predicate(element)) {
    return {
      element,
      accumulatedTransform: newAccumulatedTransform,
      ancestors,
    }
  }

  const childAncestors = [...ancestors, element]

  if (shouldRecurseIntoChildren(element)) {
    const children = flattenChildren(element.props.children)
    for (const child of children) {
      if (isValidElement(child)) {
        const found = findElement(
          child,
          predicate,
          newAccumulatedTransform,
          childAncestors,
        )
        if (found) return found
      }
    }
  }

  return null
}

export function updatePropsDownTree(
  element: Svgx,
  mapFn: (el: Svgx) => SvgxProps | undefined,
): Svgx {
  return updateElement(
    element,
    (child) => updatePropsDownTree(child, mapFn),
    mapFn(element),
  )
}
