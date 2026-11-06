import type { RemixNode } from '@remix-run/component'
import type { Vec2 } from './math/vec2.ts'
import type { Operator } from './op/index.tsx'

/**
 * Debug overlay for a running op tree. Each op draws from its last
 * frame, so against the pointer it was given. A plain function
 * returning SVG nodes, not a component: call it, don't mount it.
 */
export function OverlayVis<T extends object>({
  op,
  active = true,
}: {
  op: Operator<T>
  active?: boolean
}): RemixNode {
  const opacity = active ? 0.8 : 0.2
  return op.overlayVis({ active, opacity })
}

/** A dashed line labeled with a distance, for showing gaps. A plain function, like `OverlayVis`. */
export function DistanceLine({
  from,
  to,
  distance,
}: {
  from: Vec2
  to: Vec2
  distance: number
}): RemixNode {
  const [label, fontSize] = distance === Infinity ? ['∞', 24] : [`${Math.round(distance)}px`, 11]
  return (
    <g>
      <line
        {...from.xy1()}
        {...to.xy2()}
        stroke='white'
        strokeWidth={5}
        strokeLinecap='round'
      />
      <line
        {...from.xy1()}
        {...to.xy2()}
        stroke='magenta'
        strokeWidth={1.5}
        strokeDasharray='4 3'
      />
      {
        <text
          {...from.lerp(to, 0.5).xy()}
          fill='magenta'
          stroke='white'
          strokeWidth={3}
          paintOrder='stroke'
          fontSize={fontSize}
          fontFamily='monospace'
          textAnchor='middle'
          dominantBaseline='central'
        >
          {label}
        </text>
      }
    </g>
  )
}
