/**
 * A tab bar after SwiftUI's `TabView`, as a `@remix-run/component` component.
 *
 * ```tsx
 * import { TabView } from '@remix-kbn/apple-ui/tabview'
 *
 * <TabView
 *   tabs={[
 *     { label: 'Received', icon: <InboxIcon />, href: '/received', badge: 2 },
 *     { label: 'Sent', icon: <SentIcon />, href: '/sent' },
 *     { label: 'Account', icon: <PersonIcon />, href: '/account', badge: '!' },
 *   ]}
 * >
 *   {page}
 * </TabView>
 * ```
 *
 * Tabs are links: each has an `href`, and the one matching the current URL is selected. Its
 * children are the selected tab's content. In a tall window the bar runs along the bottom; in a
 * wide one it runs down the side of the screen the window is on (see `screenLayout`).
 *
 * @module
 */

import { css, type Handle, type RemixNode } from '@remix-run/component'
import { DEFAULT_LAYOUT, type ScreenLayout, watchScreenLayout } from './mod.ts'

/** One tab. */
export interface Tab {
  /** The tab's name, shown under its icon. */
  readonly label: string
  /**
   * What to draw above the label: an inline `<svg>`, an `<img>`, an emoji. It is drawn at
   * `1.5rem` in the tab's colour (`currentColor`), so an SVG that strokes or fills with
   * `currentColor` follows the selection.
   */
  readonly icon?: RemixNode
  /** Where the tab goes. */
  readonly href: string
  /**
   * A count or a short mark on the icon, like SwiftUI's `.badge()`. `0`, `''` and `undefined` show
   * nothing.
   */
  readonly badge?: number | string
}

/** Props for {@link TabView}. */
export interface TabViewProps {
  /** The tabs, in order. */
  readonly tabs: readonly Tab[]
  /**
   * The `href` of the selected tab. Leave it out to select the tab matching the current URL (see
   * {@link currentTabIndex}).
   */
  readonly selected?: string
  /**
   * Where to put the bar. Leave it out to follow the window (see `watchScreenLayout`).
   */
  readonly layout?: ScreenLayout
  /** The bar's accessible name. Defaults to `'Tabs'`. */
  readonly label?: string
  /** The selected tab's content. */
  readonly children?: RemixNode
}

/**
 * Which of `hrefs` the URL is on, or `-1` if none.
 *
 * A tab matches its own path and everything under it, so `/received` stays selected on
 * `/received/42`; the longest match wins. `/` matches only itself. A tab with a `#hash` matches
 * only that hash, which is how a single page can have tabs.
 *
 * @param hrefs The tabs' `href`s, resolved against `url`
 * @param url The current URL
 * @returns The index of the selected tab
 */
export function currentTabIndex(hrefs: readonly string[], url: string | URL): number {
  const here = new URL(url)
  let best = -1
  let bestLength = -1
  hrefs.forEach((href, index) => {
    const target = new URL(href, here)
    if (target.origin !== here.origin) return
    if (target.hash) {
      if (target.pathname !== here.pathname || target.hash !== here.hash) return
    } else if (!pathContains(target.pathname, here.pathname)) {
      return
    }
    const length = target.pathname.length + target.hash.length
    if (length > bestLength) {
      best = index
      bestLength = length
    }
  })
  return best
}

function pathContains(tabPath: string, path: string): boolean {
  if (tabPath === path) return true
  if (tabPath === '/') return false
  const prefix = tabPath.endsWith('/') ? tabPath : `${tabPath}/`
  return path.startsWith(prefix)
}

/** Whether a badge has anything to show. */
function showBadge(badge: Tab['badge']): badge is number | string {
  return badge !== undefined && badge !== '' && badge !== 0
}

// Liquid Glass, as far as CSS reaches: a floating capsule of frosted, saturated glass that the
// content scrolls under, lit along its top edge, with a lens behind the selected tab. Every colour
// is a custom property with light and dark defaults, so a stylesheet can retint it.

const GLASS = css({
  background: 'var(--tabview-glass, rgba(255, 255, 255, 0.4))',
  backdropFilter: 'blur(14px) saturate(190%) brightness(1.06)',
  WebkitBackdropFilter: 'blur(14px) saturate(190%) brightness(1.06)',
  border: '1px solid var(--tabview-glass-edge, rgba(255, 255, 255, 0.7))',
  boxShadow: 'var(--tabview-glass-shadow, 0 12px 32px rgba(0, 0, 0, 0.14), ' +
    '0 2px 6px rgba(0, 0, 0, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.9), ' +
    'inset 0 -1px 1px rgba(255, 255, 255, 0.3))',
  borderRadius: '999px',
  boxSizing: 'border-box',
  // The sheen: light caught by the upper half of the glass.
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: '0',
    borderRadius: 'inherit',
    background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0) 55%)',
    pointerEvents: 'none',
  },
  '@media (prefers-color-scheme: dark)': {
    background: 'var(--tabview-glass, rgba(44, 44, 48, 0.45))',
    border: '1px solid var(--tabview-glass-edge, rgba(255, 255, 255, 0.18))',
    boxShadow: 'var(--tabview-glass-shadow, 0 12px 32px rgba(0, 0, 0, 0.45), ' +
      'inset 0 1px 1px rgba(255, 255, 255, 0.25))',
    '&::before': {
      background:
        'linear-gradient(to bottom, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 55%)',
    },
  },
  // Without a backdrop filter the glass would be see-through rather than frosted.
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))': {
    background: 'var(--tabview-glass-fallback, rgba(245, 245, 247, 0.94))',
  },
})

// Remix puts these rules in a cascade layer, and an unlayered page rule beats any layered one: a site's
// `a { color: … }` would recolour every tab. So the tab's colour is applied inline, from a custom
// property these rules set (nothing else sets it), and the same goes for its underline.
const TAB = css({
  position: 'relative',
  zIndex: '1',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '1px',
  boxSizing: 'border-box',
  minWidth: '0',
  padding: '6px 4px',
  borderRadius: '999px',
  '--tabview-tab-color': 'var(--tabview-inactive, rgba(0, 0, 0, 0.78))',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: '10px',
  fontWeight: '600',
  lineHeight: '1.2',
  WebkitTapHighlightColor: 'transparent',
  transition: 'background-color 0.25s ease, box-shadow 0.25s ease, transform 0.2s ease',
  // Glass gives under the finger.
  '&:active': { transform: 'scale(0.94)' },
  // The lens behind the selected tab.
  '&[aria-current="page"]': {
    '--tabview-tab-color': 'var(--tabview-tint, #007aff)',
    background: 'var(--tabview-selection, rgba(255, 255, 255, 0.6))',
    boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.08)',
  },
  '@media (prefers-color-scheme: dark)': {
    '--tabview-tab-color': 'var(--tabview-inactive, rgba(255, 255, 255, 0.82))',
    '&[aria-current="page"]': {
      '--tabview-tab-color': 'var(--tabview-tint, #0a84ff)',
      background: 'var(--tabview-selection, rgba(255, 255, 255, 0.14))',
      boxShadow: 'inset 0 0 0 0.5px rgba(255, 255, 255, 0.12)',
    },
  },
})

const BADGE_BG = 'var(--tabview-badge-bg, #ff3b30)'
const BADGE_FG = 'var(--tabview-badge-fg, #fff)'

/** How far the floating bar sits from the edge it is on. */
const GAP = '12px'
/** What the content keeps clear for the bar, so its last line can scroll out from under it. */
const CLEARANCE = '84px'

/**
 * A tab bar with the selected tab's content above it, or beside it in a wide window.
 *
 * It fills its container (`height: 100%`), so give that a height: `100dvh` for a whole app.
 */
export function TabView(handle: Handle<TabViewProps>): () => RemixNode {
  let layout: ScreenLayout = DEFAULT_LAYOUT
  let url: string | undefined

  if (typeof window !== 'undefined') {
    const update = () => void handle.update()
    layout = watchScreenLayout((next) => {
      layout = next
      update()
    }, { signal: handle.signal })

    // A tab is selected by URL, so follow navigation however it happens.
    url = location.href
    const onNavigate = () => {
      if (location.href === url) return
      url = location.href
      update()
    }
    const options = { signal: handle.signal }
    addEventListener('popstate', onNavigate, options)
    addEventListener('hashchange', onNavigate, options)
    const navigation = (globalThis as { navigation?: EventTarget }).navigation
    navigation?.addEventListener('currententrychange', onNavigate, options)
  }

  return () => {
    const { tabs, selected, label = 'Tabs', children } = handle.props
    const { orientation, side } = handle.props.layout ?? layout
    const portrait = orientation === 'portrait'
    const hrefs = tabs.map((tab) => tab.href)
    const current = selected !== undefined
      ? hrefs.indexOf(selected)
      : url
      ? currentTabIndex(hrefs, url)
      : -1

    const edge = portrait ? 'bottom' : side
    const safe = `env(safe-area-inset-${edge})`

    const bar = (
      <nav
        aria-label={label}
        data-tabview-bar={edge}
        mix={[GLASS]}
        style={{
          position: 'absolute',
          zIndex: '1',
          display: 'flex',
          flexDirection: portrait ? 'row' : 'column',
          gap: '2px',
          padding: '4px',
          overflow: 'visible',
          ...(portrait
            ? {
              bottom: `calc(${GAP} + ${safe})`,
              left: '50%',
              transform: 'translateX(-50%)',
              maxWidth: `calc(100% - 2 * ${GAP})`,
            }
            : {
              top: '50%',
              transform: 'translateY(-50%)',
              [side]: `calc(${GAP} + ${safe})`,
              maxHeight: `calc(100% - 2 * ${GAP})`,
            }),
        }}
      >
        {tabs.map((tab, index) => {
          const active = index === current
          return (
            <a
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              mix={[TAB]}
              style={{
                width: portrait ? '72px' : '64px',
                flex: 'none',
                color: 'var(--tabview-tab-color)',
                textDecoration: 'none',
              }}
            >
              <span
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '1.75rem',
                  height: '1.75rem',
                  fontSize: '1.5rem',
                  lineHeight: '1',
                }}
              >
                {tab.icon}
                {showBadge(tab.badge) && (
                  <span
                    data-tabview-badge
                    style={{
                      position: 'absolute',
                      top: '-3px',
                      left: '60%',
                      boxSizing: 'border-box',
                      minWidth: '18px',
                      height: '18px',
                      padding: '0 5px',
                      borderRadius: '9px',
                      background: BADGE_BG,
                      color: BADGE_FG,
                      fontSize: '12px',
                      fontWeight: '600',
                      lineHeight: '18px',
                      textAlign: 'center',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {String(tab.badge)}
                  </span>
                )}
              </span>
              <span
                style={{
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </span>
            </a>
          )
        })}
      </nav>
    )

    // The content fills the whole view and scrolls under the bar; that is what the glass is for. Its
    // padding keeps the end of it reachable.
    const clearance = `calc(${CLEARANCE} + ${safe})`
    return (
      <div
        data-tabview={portrait ? 'portrait' : `landscape-${side}`}
        style={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '0',
            overflow: 'auto',
            boxSizing: 'border-box',
            [`padding${edge[0].toUpperCase()}${edge.slice(1)}`]: clearance,
          }}
        >
          {children}
        </div>
        {bar}
      </div>
    )
  }
}
