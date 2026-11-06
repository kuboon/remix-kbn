import { emptyBounds, getGlobalBounds, unionBounds } from './bounds.ts'
import type { LayeredSvgx } from './layers.tsx'

export function getLayeredBounds(layered: LayeredSvgx) {
  return [...layered.byId.values()].reduce(
    (bounds, { element }) =>
      unionBounds(
        bounds,
        getGlobalBounds(element, element.props.transform ?? ''),
      ),
    emptyBounds,
  )
}
