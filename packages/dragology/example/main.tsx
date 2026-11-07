// A small app using @remix-kbn/dragology: a toggle (d.between), a
// slider (d.vary), a reorderable list (d.closest + withFloating), and
// cards holding stateful Remix components that survive reordering.
import { createRoot, type Handle, on } from '@remix-run/component'
import { type Draggable, DraggableRenderer, inOrder, param, translate } from '../src/mod.ts'

type ToggleState = { status: 'on' | 'off' }

const toggle: Draggable<ToggleState> = ({ state, d }) => (
  <g transform={translate(20, 20)}>
    <rect width={120} height={60} rx={30} fill={state.status === 'on' ? '#22c55e' : '#d1d5db'} />
    <circle
      id='knob'
      transform={state.status === 'on' ? translate(90, 30) : translate(30, 30)}
      r={26}
      fill='white'
      dragologyOnDrag={() => d.between([{ status: 'off' }, { status: 'on' }])}
    />
  </g>
)

type SliderState = { value: number }

const slider: Draggable<SliderState> = ({ state, d }) => (
  <g transform={translate(20, 50)}>
    <line x1={0} y1={0} x2={240} y2={0} stroke='#9ca3af' strokeWidth={4} />
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
  </g>
)

type ListState = { items: string[] }

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const result = [...items]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

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
        <rect width={160} height={40} rx={6} fill='#e0e7ff' stroke='#6366f1' />
        <text transform={translate(12, 26)} fontSize={16}>{item}</text>
      </g>
    ))}
  </g>
)

// A component element: Dragology mounts it once and keeps it mounted,
// so its count survives reordering.
function Counter(handle: Handle<{ name: string }>) {
  let count = 0
  return () => (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', height: '100%' }}>
      <b>{handle.props.name}</b>
      <button
        type='button'
        data-counter={handle.props.name}
        mix={[
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
        <foreignObject x={10} y={0} width={220} height={40}>
          <Counter name={name} />
        </foreignObject>
      </g>
    ))}
  </g>
)

function App() {
  return () => (
    <div style={{ fontFamily: 'sans-serif', padding: '16px' }}>
      <h1>@remix-kbn/dragology</h1>
      <h2>Toggle</h2>
      <DraggableRenderer
        draggable={toggle}
        initialState={{ status: 'off' }}
        width={160}
        height={100}
      />
      <h2>Slider</h2>
      <DraggableRenderer
        draggable={slider}
        initialState={{ value: 60 }}
        width={280}
        height={100}
      />
      <h2>List</h2>
      <DraggableRenderer
        draggable={list}
        initialState={{ items: ['apple', 'banana', 'cherry', 'date'] }}
        width={200}
        height={220}
      />
      <h2>Component elements</h2>
      <DraggableRenderer
        draggable={cards}
        initialState={{ items: ['alpha', 'beta', 'gamma'] }}
        width={260}
        height={170}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
