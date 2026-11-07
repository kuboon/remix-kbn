import { createRoot, ref, type VirtualRoot } from '@remix-run/component'
import { jsx } from '@remix-run/component/jsx-runtime'
import {
  isComponentElement,
  isValidSvgx,
  shouldRecurseIntoChildren,
  type Svgx,
  updateElement,
} from './index.ts'
import type { LayeredSvgx } from './layers.tsx'
import { getPath } from './path.ts'

// Dragology never calls the component elements in a draggable's tree
// (<NoteWidget />, as opposed to <g>); Remix mounts each one once.
// Dragology rebuilds and rearranges the SVG it draws freely (layers
// re-stack, drags float, idle and dragging trees differ), so a
// component rendered in place would be remounted all the time.
// Instead, each one gets a container element that we own and keep for
// as long as the component lives, rendered by a virtual root of its
// own, and the container is moved into a placeholder wherever the
// component currently appears. Moving a DOM node doesn't disturb the
// root. Events bubble through the DOM, so a pointerdown inside a
// component reaches the drag it sits inside without help.
//
// A <foreignObject> is ours to draw too: Remix creates the element
// itself in the HTML namespace (it switches to HTML at the
// foreignObject rather than below it), where it draws nothing. So it
// becomes a placeholder <g>, and we keep a real SVG foreignObject in
// it, holding the containers of the components inside.
// https://github.com/remix-run/remix/issues/12231: once that's fixed,
// a foreignObject can be left to Remix like any other element.

type HostedComponent = {
  key: string
  element: Svgx
  /** Path of the foreignObject it's in, if it's in one. */
  foreignObject: string | undefined
}

type HostedForeignObject = {
  key: string
  props: Record<string, unknown>
}

type Container = {
  el: Element
  html: boolean
  root: VirtualRoot | undefined
}

const SVG_NS = 'http://www.w3.org/2000/svg'

export class ComponentHost {
  private containers = new Map<string, Container>()
  private foreignObjectEls = new Map<string, SVGForeignObjectElement>()
  private placeholders = new Map<string, Element>()
  private refCallbacks = new Map<string, (node: Element, signal: AbortSignal) => void>()
  private retained = new Map<string, HostedComponent>()
  private retainedForeignObjects = new Map<string, HostedForeignObject>()

  /**
   * Replaces component elements and foreignObjects in each layer with
   * placeholders. Call `commit` once the result is in the DOM, to
   * render the components into them. With `keepAbsent`, components
   * missing from this frame stay mounted (off-screen), so a drag
   * preview that omits one doesn't destroy its state.
   */
  frame(layered: LayeredSvgx, keepAbsent: boolean): LayeredSvgx {
    const current = new Map<string, HostedComponent>()
    const currentForeignObjects = new Map<string, HostedForeignObject>()
    const byId = new Map(
      [...layered.byId].map(([id, layer]) => [
        id,
        {
          ...layer,
          element: this.walk(layer.element, undefined, current, currentForeignObjects),
        },
      ]),
    )
    if (keepAbsent) {
      this.retained = new Map([...this.retained, ...current])
      this.retainedForeignObjects = new Map([
        ...this.retainedForeignObjects,
        ...currentForeignObjects,
      ])
    } else {
      this.retained = current
      this.retainedForeignObjects = currentForeignObjects
    }
    return { ...layered, byId }
  }

  /** Render the components of the last frame into their containers. */
  commit(): void {
    for (const [key, el] of [...this.foreignObjectEls]) {
      if (!this.retainedForeignObjects.has(key)) {
        el.remove()
        this.foreignObjectEls.delete(key)
        this.forget(key)
      }
    }
    for (const [key, container] of [...this.containers]) {
      if (!this.retained.has(key)) {
        container.root?.dispose()
        container.el.remove()
        this.containers.delete(key)
        this.forget(key)
      }
    }

    for (const fo of this.retainedForeignObjects.values()) {
      const el = this.foreignObjectEl(fo.key)
      setAttributes(el, fo.props)
      const placeholder = this.placeholders.get(fo.key)
      if (placeholder && el.parentNode !== placeholder) placeholder.appendChild(el)
    }

    for (const component of this.retained.values()) {
      const html = component.foreignObject !== undefined
      const container = this.container(component.key, html)
      const parent = html
        ? this.foreignObjectEls.get(component.foreignObject!)
        : this.placeholders.get(component.key)
      if (parent && container.el.parentNode !== parent) parent.appendChild(container.el)
      container.root ??= createRoot(container.el as HTMLElement)
      const element = stripDragologyProps(component.element)
      // A root starts outside SVG, so SVG content needs an <svg> of its
      // own to be created in the SVG namespace. It's unsized and
      // overflows, so it draws in its placeholder's coordinates.
      container.root.render(
        html
          ? element
          : jsx('svg', { overflow: 'visible', style: { overflow: 'visible' }, children: element }),
      )
      container.root.flush()
    }
  }

  /** Unmount every hosted component. */
  dispose(): void {
    this.retained = new Map()
    this.retainedForeignObjects = new Map()
    this.commit()
  }

  private forget(key: string) {
    this.refCallbacks.delete(key)
    this.placeholders.delete(key)
  }

  private foreignObjectEl(key: string): SVGForeignObjectElement {
    let el = this.foreignObjectEls.get(key)
    if (!el) {
      el = document.createElementNS(SVG_NS, 'foreignObject') as SVGForeignObjectElement
      this.foreignObjectEls.set(key, el)
    }
    return el
  }

  private container(key: string, html: boolean): Container {
    const existing = this.containers.get(key)
    if (existing && existing.html === html) return existing
    if (existing) {
      existing.root?.dispose()
      existing.el.remove()
    }
    let el: Element
    if (html) {
      el = document.createElement('div')
      ;(el as HTMLElement).style.display = 'contents'
    } else {
      el = document.createElementNS(SVG_NS, 'g')
    }
    const container: Container = { el, html, root: undefined }
    this.containers.set(key, container)
    return container
  }

  /** Stable per key, so the placeholder's mixin doesn't churn. */
  private refCallback(key: string): (node: Element, signal: AbortSignal) => void {
    let cb = this.refCallbacks.get(key)
    if (!cb) {
      cb = (node, signal) => {
        this.placeholders.set(key, node)
        const child = this.foreignObjectEls.get(key) ?? this.containers.get(key)?.el
        if (child && child.parentNode !== node) node.appendChild(child)
        signal.addEventListener('abort', () => {
          if (this.placeholders.get(key) === node) this.placeholders.delete(key)
        })
      }
      this.refCallbacks.set(key, cb)
    }
    return cb
  }

  private placeholder(key: string, node: Svgx): Svgx {
    return jsx('g', { mix: [ref(this.refCallback(key))] }, node.key) as Svgx
  }

  private walk(
    node: Svgx,
    foreignObject: string | undefined,
    out: Map<string, HostedComponent>,
    outForeignObjects: Map<string, HostedForeignObject>,
  ): Svgx {
    if (isComponentElement(node)) {
      // Inside defs or dragologyOpaque, assignPaths never assigned a
      // path, so there's no identity to keep; render it in place.
      const key = getPath(node)
      if (key === undefined) return node
      out.set(key, { key, element: node, foreignObject })
      // In a foreignObject, the container goes straight into our
      // foreignObject element; nothing is drawn in its place.
      return foreignObject === undefined ? this.placeholder(key, node) : node
    }

    if (node.type === 'foreignObject') {
      const key = getPath(node)
      if (key !== undefined) {
        const { children: _children, ...props } = node.props
        outForeignObjects.set(key, { key, props })
        // Only component elements are allowed inside (see
        // assertForeignObjectHoldsComponents).
        updateElement(
          node,
          (child) => isValidSvgx(child) ? this.walk(child, key, out, outForeignObjects) : child,
        )
        return this.placeholder(key, node)
      }
    }

    if (node.props.children === undefined || !shouldRecurseIntoChildren(node)) {
      return node
    }
    return updateElement(
      node,
      (child) =>
        isValidSvgx(child) ? this.walk(child, foreignObject, out, outForeignObjects) : child,
    )
  }
}

/** Mirror a foreignObject's props onto the element we keep for it. */
function setAttributes(el: Element, props: Record<string, unknown>) {
  const wanted = new Map<string, string>()
  let style = ''
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false || k === 'mix' || k === 'key' || k.startsWith('dragology')) {
      continue
    }
    if (k === 'style') {
      style = typeof v === 'string' ? v : Object.entries(v as Record<string, unknown>)
        .map(([p, val]) => `${p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${val}`)
        .join('; ')
      continue
    }
    if (typeof v === 'function' || typeof v === 'object') continue
    wanted.set(k === 'className' ? 'class' : k, String(v))
  }
  if (style) wanted.set('style', style)
  for (const attr of [...el.attributes]) {
    if (!wanted.has(attr.name)) el.removeAttribute(attr.name)
  }
  for (const [k, v] of wanted) {
    if (el.getAttribute(k) !== v) el.setAttribute(k, v)
  }
}

function stripDragologyProps(element: Svgx): Svgx {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(element.props)) {
    if (k === 'data-path' || k.startsWith('dragology')) continue
    props[k] = v
  }
  return jsx(element.type, props) as Svgx
}
