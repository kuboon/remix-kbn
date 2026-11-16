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

import type { Handle, RemixNode } from '@remix-run/component'
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

// Colours come from custom properties, so a stylesheet (or a dark-mode media query) can restyle the
// bar without touching it. The defaults are iOS's light appearance.
const TINT = 'var(--tabview-tint, #007aff)'
const INACTIVE = 'var(--tabview-inactive, #8e8e93)'
const BAR_BG = 'var(--tabview-bg, rgba(249, 249, 249, 0.94))'
const SEPARATOR = 'var(--tabview-separator, rgba(60, 60, 67, 0.29))'
const BADGE_BG = 'var(--tabview-badge-bg, #ff3b30)'
const BADGE_FG = 'var(--tabview-badge-fg, #fff)'

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

    const bar = (
      <nav
        aria-label={label}
        data-tabview-bar={portrait ? 'bottom' : side}
        style={{
          display: 'flex',
          flexDirection: portrait ? 'row' : 'column',
          justifyContent: portrait ? 'space-around' : 'flex-start',
          gap: portrait ? '0' : '12px',
          flex: 'none',
          boxSizing: 'border-box',
          padding: portrait
            ? '6px 4px calc(6px + env(safe-area-inset-bottom))'
            : side === 'left'
            ? '16px 4px 16px calc(4px + env(safe-area-inset-left))'
            : '16px calc(4px + env(safe-area-inset-right)) 16px 4px',
          width: portrait ? '100%' : '84px',
          background: BAR_BG,
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          [portrait ? 'borderTop' : side === 'left' ? 'borderRight' : 'borderLeft']:
            `0.5px solid ${SEPARATOR}`,
          overflow: 'auto',
        }}
      >
        {tabs.map((tab, index) => {
          const active = index === current
          return (
            <a
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                flex: portrait ? '1 1 0' : 'none',
                minWidth: '0',
                padding: '2px 0',
                color: active ? TINT : INACTIVE,
                textDecoration: 'none',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: '10px',
                fontWeight: '500',
                lineHeight: '1.2',
                WebkitTapHighlightColor: 'transparent',
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

    return (
      <div
        data-tabview={portrait ? 'portrait' : `landscape-${side}`}
        style={{
          display: 'flex',
          // The bar comes second in the tree, so the content is read first. Reversing the row puts
          // it on the left.
          flexDirection: portrait ? 'column' : side === 'left' ? 'row-reverse' : 'row',
          height: '100%',
          width: '100%',
        }}
      >
        <div style={{ flex: '1 1 auto', minWidth: '0', minHeight: '0', overflow: 'auto' }}>
          {children}
        </div>
        {bar}
      </div>
    )
  }
}
