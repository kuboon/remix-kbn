# apple-ui

Apple-style UI pieces for [`@remix-run/component`](https://www.npmjs.com/package/@remix-run/component)
apps.

```sh
deno add jsr:@remix-kbn/apple-ui
```

Try it on the [demo page](https://kuboon.github.io/remix-kbn/#apple-ui)
([source](../../demo/apple-ui.tsx)).

## `/tabview`

A tab bar after SwiftUI's `TabView`. Where SwiftUI writes

```swift
TabView {
    Tab("Received", systemImage: "tray.and.arrow.down.fill") { ReceivedView() }
        .badge(2)
    Tab("Sent", systemImage: "tray.and.arrow.up.fill") { SentView() }
    Tab("Account", systemImage: "person.crop.circle.fill") { AccountView() }
        .badge("!")
}
```

this is

```tsx
import { TabView } from '@remix-kbn/apple-ui/tabview'

<TabView
  tabs={[
    { label: 'Received', icon: <InboxIcon />, href: '/received', badge: 2 },
    { label: 'Sent', icon: <SentIcon />, href: '/sent' },
    { label: 'Account', icon: <PersonIcon />, href: '/account', badge: '!' },
  ]}
>
  {page}
</TabView>
```

- **Tabs are links.** Each has an `href`, and the tab matching the current URL is selected: its own
  path and everything under it, so `/received` stays selected on `/received/42`, and the longest
  match wins. A `#hash` tab matches its hash, for tabs within one page. Pass `selected` (an `href`)
  to choose it yourself. It follows `popstate`, `hashchange` and the Navigation API, so Remix's
  client-side navigation keeps it current.
- **The children are the selected tab's content.** The tab view fills its container
  (`height: 100%`), so give that a height — `100dvh` for a whole app. The content scrolls; the bar
  doesn't.
- **Icons are yours.** SF Symbols aren't available on the web, so `icon` is any node: an inline
  `<svg>`, an `<img>`, an emoji. It is drawn at `1.5rem` in the tab's colour, so an SVG using
  `currentColor` follows the selection.
- **Badges** take a number or a short string. `0`, `''` and no badge show nothing, like SwiftUI.
- **Where the bar goes** follows the window (see below): along the bottom of a tall window, down the
  left or right edge of a wide one. Pass `layout` to fix it.
- **It looks like Liquid Glass**, as far as CSS reaches: a capsule floating over the content,
  frosted and saturated (`backdrop-filter`), lit along its top edge, with a lens behind the selected
  tab and a slight give when pressed. Switching tabs slides the lens to the new one with a
  little overshoot, stretching it along the bar as it goes, and brings the new content in from the
  side the selection moved towards. Nothing animates under `prefers-reduced-motion: reduce`. The content fills the whole view and scrolls under the bar,
  with padding on the bar's side so its end stays reachable. It follows `prefers-color-scheme`, and
  falls back to an opaque bar where `backdrop-filter` isn't supported. Real Liquid Glass also bends
  what is behind it; that refraction has no portable CSS equivalent and isn't attempted.
- **Colours** are custom properties with light and dark defaults: `--tabview-tint`,
  `--tabview-inactive`, `--tabview-glass`, `--tabview-glass-edge`, `--tabview-glass-shadow`,
  `--tabview-glass-fallback`, `--tabview-selection`, `--tabview-badge-bg`, `--tabview-badge-fg`.
  Set them on any ancestor.

## `/` — where the window is

The decision the tab view makes, on its own: is the window tall or wide, and which half of the
screen is it on.

```ts
import { screenLayout, watchScreenLayout } from '@remix-kbn/apple-ui'

screenLayout() // { orientation: 'landscape', side: 'left' }

watchScreenLayout((layout) => render(layout), { signal })
```

- `orientation` is `'portrait'` when the viewport is taller than it is wide, `'landscape'` otherwise
  (a square counts as landscape).
- `side` is `'left'` when the window's left edge (`screenX`) is left of the middle of the physical
  display (`screen.width / 2`), `'right'` otherwise. Two windows side by side therefore get their
  bars at the outer edges.
- `watchScreenLayout(callback, { signal, pollInterval })` calls back on every change. A resize is an
  event, so orientation changes arrive at once; moving a window to the other half of the screen
  fires nothing, so it is checked every `pollInterval` ms (default `1000`, `0` to turn it off).
- `layoutOf(metrics)` is the pure decision over `{ width, height, screenWidth, screenX }`, and
  `screenLayout()` returns portrait / left where there is no window, on the server.

## License

See [LICENSE](./LICENSE)
