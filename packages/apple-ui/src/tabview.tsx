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

import { css, type Handle, ref, type RemixNode } from '@remix-run/component'
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
  transition: 'color 0.3s ease, transform 0.2s ease',
  // Glass gives under the finger.
  '&:active': { transform: 'scale(0.94)' },
  '&[aria-current="page"]': {
    '--tabview-tab-color': 'var(--tabview-tint, #007aff)',
  },
  '@media (prefers-color-scheme: dark)': {
    '--tabview-tab-color': 'var(--tabview-inactive, rgba(255, 255, 255, 0.82))',
    '&[aria-current="page"]': {
      '--tabview-tab-color': 'var(--tabview-tint, #0a84ff)',
    },
  },
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
})

// The lens behind the selected tab. There is one, and it slides from tab to tab: the springy curve
// overshoots a little and settles, the way the glass does.
const LENS = css({
  position: 'absolute',
  top: '4px',
  left: '4px',
  zIndex: '0',
  borderRadius: '999px',
  pointerEvents: 'none',
  background: 'var(--tabview-selection, rgba(255, 255, 255, 0.6))',
  boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.08)',
  transition: 'transform 0.5s cubic-bezier(0.34, 1.32, 0.5, 1), opacity 0.2s ease',
  '@media (prefers-color-scheme: dark)': {
    background: 'var(--tabview-selection, rgba(255, 255, 255, 0.14))',
    boxShadow: 'inset 0 0 0 0.5px rgba(255, 255, 255, 0.12)',
  },
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
})

/**
 * A tab's size, fixed so the lens can be placed without measuring.
 *
 * The lens and the bar are both capsules, and the lens sits inside the bar by its padding and
 * border (5px), so its ends run parallel to the bar's only if they are concentric: the lens's radius
 * (half its narrow side) must be the bar's less that inset. A tab's size across the bar is what
 * makes the bar's thickness, so that holds by construction once the lens is as wide across as the
 * tab. Along a landscape rail, a tab is as tall as it is wide, so its lens is a circle that fits
 * the rail's round ends; a 64×54 lens there had corners tighter than the ends around it.
 */
const TAB_SIZE = {
  portrait: { width: 72, height: 54 },
  landscape: { width: 64, height: 64 },
}
/** The space between tabs. */
const TAB_GAP = 2

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

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

  // What the last render showed, so a change of tab can be animated from it.
  let shownIndex: number | undefined
  let shownEdge: string | undefined
  let lens: HTMLElement | null = null
  let content: HTMLElement | null = null
  const lensRef = ref((node) => void (lens = node as HTMLElement))
  const contentRef = ref((node) => void (content = node as HTMLElement))

  /** Animates a move from tab `from` to tab `to`. Runs after the DOM shows `to`. */
  const animateSwitch = (from: number, to: number, portrait: boolean) => {
    if (reducedMotion()) return
    const direction = Math.sign(to - from)
    // The lens stretches along the bar as it goes, and settles back.
    lens?.animate(
      [
        { scale: '1 1' },
        { scale: portrait ? '1.18 0.9' : '0.9 1.14', offset: 0.35 },
        { scale: '1 1' },
      ],
      { duration: 500, easing: 'ease-out' },
    )
    // The new content comes in from the side the selection moved towards.
    const offset = `${direction * 24}px`
    content?.animate(
      [
        { opacity: 0, translate: portrait ? `${offset} 0` : `0 ${offset}` },
        { opacity: 1, translate: '0 0' },
      ],
      { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    )
  }

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

    const { width: tabWidth, height: tabHeight } = TAB_SIZE[portrait ? 'portrait' : 'landscape']
    const step = (portrait ? tabWidth : tabHeight) + TAB_GAP
    const lensIndex = Math.max(current, 0)
    // Moving the bar to another edge isn't a change of tab: put the lens straight in place.
    const jump = shownEdge !== undefined && shownEdge !== edge
    if (
      shownIndex !== undefined && shownIndex !== current && shownIndex >= 0 && current >= 0 && !jump
    ) {
      const from = shownIndex
      handle.queueTask(() => animateSwitch(from, current, portrait))
    }
    shownIndex = current
    shownEdge = edge

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
          gap: `${TAB_GAP}px`,
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
        <span
          aria-hidden='true'
          data-tabview-lens
          mix={[LENS, lensRef]}
          style={{
            width: `${tabWidth}px`,
            height: `${tabHeight}px`,
            transform: portrait
              ? `translateX(${lensIndex * step}px)`
              : `translateY(${lensIndex * step}px)`,
            opacity: current < 0 ? '0' : '1',
            ...(jump ? { transition: 'none' } : {}),
          }}
        />
        {tabs.map((tab, index) => {
          const active = index === current
          return (
            <a
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              mix={[TAB]}
              style={{
                width: `${tabWidth}px`,
                height: `${tabHeight}px`,
                justifyContent: 'center',
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
          mix={[contentRef]}
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
