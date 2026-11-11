/// <reference lib="dom" />

import { createRoot, on, ref } from '@remix-run/component'
import { pinchPan, type PinchPanControls, zoomAt } from '@remix-kbn/ui-pinch-pan'

const LIMITS = { minScale: 0.5, maxScale: 8 }

// A map-like picture, with labels small enough that zooming in is worth it.
function picture() {
  const cells = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 12; x++) {
      cells.push(
        <rect
          x={x * 50 + 2}
          y={y * 50 + 2}
          width={46}
          height={46}
          rx={6}
          fill={`hsl(${(x * 30 + y * 12) % 360} 70% 60%)`}
        />,
        <text
          x={x * 50 + 25}
          y={y * 50 + 29}
          textAnchor='middle'
          fontSize={11}
          fill='#1f2328'
        >
          {`${String.fromCharCode(65 + y)}${x + 1}`}
        </text>,
      )
    }
  }
  return (
    <svg width={600} height={400} viewBox='0 0 600 400' style={{ display: 'block' }}>
      {cells}
    </svg>
  )
}

function PinchPanDemo() {
  let view: PinchPanControls | null = null
  let host: Element | null = null
  let readout: Element | null = null

  const show = (scale: number) => {
    if (readout) readout.textContent = `${Math.round(scale * 100)}%`
  }

  // The buttons zoom about the middle of the viewport, as a pinch there would. Points are in the
  // content's untransformed box, whose corner is the host's.
  const zoomBy = (factor: number) => {
    if (!view || !host) return
    const middle = { x: host.clientWidth / 2, y: host.clientHeight / 2 }
    view.set(zoomAt(view.transform, middle, factor, LIMITS))
  }

  return () => (
    <div>
      <div
        class='pinch-pan-viewport'
        mix={[
          ref((node) => {
            host = node
          }),
          pinchPan({
            ...LIMITS,
            onChange: (transform) => show(transform.scale),
            controls: (api) => {
              view = api
            },
          }),
        ]}
      >
        <div>{picture()}</div>
      </div>
      <div class='row'>
        <button type='button' mix={[on('click', () => zoomBy(1.5))]}>Zoom in</button>
        <button type='button' mix={[on('click', () => zoomBy(1 / 1.5))]}>Zoom out</button>
        <button
          type='button'
          mix={[on('click', () => {
            view?.reset()
            show(1)
          })]}
        >
          Reset
        </button>
        <span
          class='status'
          id='pinch-pan-scale'
          mix={[ref((node) => {
            readout = node
          })]}
        >
          100%
        </span>
      </div>
    </div>
  )
}

export function setupPinchPanDemo(): void {
  createRoot(document.getElementById('pinch-pan-demo')!).render(<PinchPanDemo />)
}
