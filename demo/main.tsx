/// <reference lib="dom" />

// Live demos of the browser-side packages in this repo. Each package gets a
// section in index.html; this module mounts into it.
import './dragology-jsx.ts'
import { createRoot, type Handle, on } from '@remix-run/component'
import {
  type Draggable,
  DraggableRenderer,
  inOrder,
  param,
  rotateDeg,
  translate,
} from '@remix-kbn/dragology'

// --- @remix-kbn/dragology ---

type ToggleState = { status: 'on' | 'off' }

// d.between: drag the knob between two states; it snaps on release.
const toggle: Draggable<ToggleState> = ({ state, d }) => (
  <g transform={translate(20, 20)}>
    <rect width={120} height={60} rx={30} fill={state.status === 'on' ? '#22c55e' : '#d1d5db'} />
    <circle
      id='knob'
      transform={state.status === 'on' ? translate(90, 30) : translate(30, 30)}
      r={26}
      fill='white'
      stroke='#9ca3af'
      dragologyOnDrag={() => d.between([{ status: 'off' }, { status: 'on' }])}
    />
  </g>
)

type SliderState = { value: number }

// d.vary: drag the thumb anywhere; the value follows, kept in range by a constraint.
const slider: Draggable<SliderState> = ({ state, d }) => (
  <g transform={translate(20, 40)}>
    <line x1={0} y1={0} x2={240} y2={0} stroke='#9ca3af' strokeWidth={4} strokeLinecap='round' />
    <circle
      id='thumb'
      transform={translate(state.value, 0)}
      r={14}
      fill='#3b82f6'
      dragologyOnDrag={() =>
        d.vary(state, param('value'), {
          constraint: (s) => inOrder([0, s.value, 240]),
        })}
    />
    <text transform={translate(0, 40)} fontSize={14} fill='currentColor'>
      {`value: ${Math.round(state.value)}`}
    </text>
  </g>
)

type DialState = { angle: number }

// d.vary over an angle: the handle moves on a circle, because that's all the
// state can describe.
const dial: Draggable<DialState> = ({ state, d }) => (
  <g transform={translate(90, 90)}>
    <circle r={60} fill='none' stroke='#9ca3af' strokeWidth={2} strokeDasharray='6 4' />
    <line
      x1={0}
      y1={0}
      x2={60}
      y2={0}
      stroke='#f59e0b'
      strokeWidth={3}
      transform={rotateDeg(state.angle)}
    />
    <circle
      id='handle'
      transform={rotateDeg(state.angle) + translate(60, 0)}
      r={12}
      fill='#f59e0b'
      dragologyOnDrag={() => d.vary(state, param('angle'))}
    />
    <text y={90} textAnchor='middle' fontSize={16} fill='currentColor'>
      {`${Math.round(((state.angle % 360) + 360) % 360)}°`}
    </text>
  </g>
)

type ListState = { items: string[] }

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const result = [...items]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

// d.closest + withFloating: the dragged item floats under the pointer while
// the rest of the list shows the closest reordering.
const list: Draggable<ListState> = ({ state, d, draggedId }) => (
  <g transform={translate(20, 20)}>
    {state.items.map((item, i) => (
      <g
        id={`item-${item}`}
        transform={translate(0, i * 50)}
        dragologyZIndex={draggedId === `item-${item}` ? '/1' : false}
        dragologyOnDrag={() =>
          d.closest(state.items.map((_, j) => ({ items: moveItem(state.items, i, j) })))
            .withFloating()}
      >
        <rect width={180} height={40} rx={6} fill='#e0e7ff' stroke='#6366f1' />
        <text transform={translate(12, 26)} fontSize={16} fill='#1f2328'>{item}</text>
      </g>
    ))}
  </g>
)

// A component element: Dragology mounts it once and keeps it mounted, so its
// count survives reordering.
function Counter(handle: Handle<{ name: string }>) {
  let count = 0
  return () => (
    <div class='counter'>
      <b>{handle.props.name}</b>
      <button
        type='button'
        data-counter={handle.props.name}
        mix={[
          // A control, not a grab.
          on('pointerdown', (e) => e.stopPropagation()),
          on('click', () => {
            count++
            void handle.update()
          }),
        ]}
      >
        +1
      </button>
      <span data-count={handle.props.name}>{count}</span>
    </div>
  )
}

const cards: Draggable<ListState> = ({ state, d, draggedId }) => (
  <g>
    {state.items.map((name, i) => (
      <g
        id={`card-${name}`}
        transform={translate(10, 10 + i * 50)}
        dragologyZIndex={draggedId === `card-${name}` ? '/1' : false}
        dragologyOnDrag={() =>
          d.closest(state.items.map((_, j) => ({ items: moveItem(state.items, i, j) })))
            .withFloating()}
      >
        <rect width={240} height={40} rx={6} fill='white' stroke='#d1d5db' />
        <text transform={translate(12, 25)} fontSize={18} fill='#9ca3af'>⠿</text>
        <foreignObject x={32} y={0} width={200} height={40}>
          <Counter name={name} />
        </foreignObject>
      </g>
    ))}
  </g>
)

function mount(id: string, node: JSX.Element) {
  createRoot(document.getElementById(id)!).render(node)
}

mount(
  'dragology-toggle',
  <DraggableRenderer
    draggable={toggle}
    initialState={{ status: 'off' }}
    width={160}
    height={100}
  />,
)
mount(
  'dragology-slider',
  <DraggableRenderer draggable={slider} initialState={{ value: 60 }} width={280} height={100} />,
)
mount(
  'dragology-dial',
  <DraggableRenderer draggable={dial} initialState={{ angle: -45 }} width={180} height={190} />,
)
mount(
  'dragology-list',
  <DraggableRenderer
    draggable={list}
    initialState={{ items: ['apple', 'banana', 'cherry', 'date'] }}
    width={220}
    height={220}
  />,
)
mount(
  'dragology-cards',
  <DraggableRenderer
    draggable={cards}
    initialState={{ items: ['alpha', 'beta', 'gamma'] }}
    width={260}
    height={170}
  />,
)
