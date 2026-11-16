/// <reference lib="dom" />

import { createRoot, type Handle, on } from '@remix-run/component'
import { type ScreenLayout, watchScreenLayout } from '@remix-kbn/apple-ui'
import { type Tab, TabView } from '@remix-kbn/apple-ui/tabview'

// Outline icons drawn with currentColor, so they follow the tab's selection colour.
const icon = (d: string) => (
  <svg
    width='1em'
    height='1em'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={1.8}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <path d={d} />
  </svg>
)

const tabs: Tab[] = [
  {
    label: 'Received',
    icon: icon('M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4zM12 4v7m-3-3 3 3 3-3'),
    href: '#apple-ui-received',
    badge: 2,
  },
  {
    label: 'Sent',
    icon: icon('M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4zM12 11V4M9 7l3-3 3 3'),
    href: '#apple-ui-sent',
  },
  {
    label: 'Account',
    icon: icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6'),
    href: '#apple-ui-account',
    badge: '!',
  },
]

const pages: Record<string, string> = {
  '#apple-ui-received': 'Two new messages.',
  '#apple-ui-sent': 'Nothing sent yet.',
  '#apple-ui-account': 'Your account needs attention.',
}

type Choice = 'auto' | 'portrait' | 'left' | 'right'

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'auto', label: 'Follow the window' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'left', label: 'Landscape, left half' },
  { value: 'right', label: 'Landscape, right half' },
]

function layoutFor(choice: Choice): ScreenLayout | undefined {
  if (choice === 'auto') return undefined
  if (choice === 'portrait') return { orientation: 'portrait', side: 'left' }
  return { orientation: 'landscape', side: choice }
}

function AppleUiDemo(handle: Handle) {
  let choice: Choice = 'auto'
  // Shown for 'auto', so the reader can see what the window was measured as.
  let measured = watchScreenLayout((layout) => {
    measured = layout
    void handle.update()
  }, { signal: handle.signal })
  let hash = location.hash
  addEventListener('hashchange', () => {
    hash = location.hash
    void handle.update()
  }, { signal: handle.signal })

  return () => {
    const layout = layoutFor(choice)
    const portrait = (layout ?? measured).orientation === 'portrait'
    return (
      <div>
        <div class='row' role='group' aria-label='Layout'>
          {CHOICES.map(({ value, label }) => (
            <button
              type='button'
              aria-pressed={choice === value ? 'true' : 'false'}
              mix={[on('click', () => {
                choice = value
                void handle.update()
              })]}
            >
              {label}
            </button>
          ))}
        </div>
        <p class='status'>
          {`This window measures as ${measured.orientation}, ${measured.side} half.`}
        </p>
        <div class={portrait ? 'apple-ui-frame portrait' : 'apple-ui-frame'}>
          <TabView tabs={tabs} layout={layout}>
            <div class='apple-ui-page'>
              <h3>{tabs.find((tab) => tab.href === hash)?.label ?? 'Pick a tab'}</h3>
              <p>{pages[hash] ?? 'The tabs are links; the one matching the URL is selected.'}</p>
            </div>
          </TabView>
        </div>
      </div>
    )
  }
}

export function setupAppleUiDemo(): void {
  createRoot(document.getElementById('apple-ui-demo')!).render(<AppleUiDemo />)
}
