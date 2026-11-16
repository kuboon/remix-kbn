import * as assert from '@remix-run/assert'
import { renderToString } from '@remix-run/component/server'
import { describe, it } from '@std/testing/bdd'

import { currentTabIndex, type Tab, TabView } from './tabview.tsx'

describe('currentTabIndex', () => {
  const hrefs = ['/', '/received', '/received/archive', '/account']

  it('matches a tab and everything under it, longest first', () => {
    assert.equal(currentTabIndex(hrefs, 'https://x.test/'), 0)
    assert.equal(currentTabIndex(hrefs, 'https://x.test/received'), 1)
    assert.equal(currentTabIndex(hrefs, 'https://x.test/received/42?q=1'), 1)
    assert.equal(currentTabIndex(hrefs, 'https://x.test/received/archive/7'), 2)
  })

  it('does not let / or a shared prefix match everything', () => {
    assert.equal(currentTabIndex(hrefs, 'https://x.test/settings'), -1)
    assert.equal(currentTabIndex(hrefs, 'https://x.test/accounting'), -1)
  })

  it('matches #hash tabs by hash', () => {
    const tabs = ['#a', '#b']
    assert.equal(currentTabIndex(tabs, 'https://x.test/page#b'), 1)
    assert.equal(currentTabIndex(tabs, 'https://x.test/page'), -1)
    // A bare #hash resolves against the current page, so pin the path to test another page.
    assert.equal(currentTabIndex(['/page#a', '/page#b'], 'https://x.test/other#a'), -1)
  })

  it('ignores other origins', () => {
    assert.equal(currentTabIndex(['https://elsewhere.test/'], 'https://x.test/'), -1)
  })
})

const tabs: Tab[] = [
  { label: 'Received', icon: '📥', href: '/received', badge: 2 },
  { label: 'Sent', icon: '📤', href: '/sent', badge: 0 },
  { label: 'Account', icon: '👤', href: '/account', badge: '!' },
]

describe('TabView', () => {
  it('renders the bar after the content, along the bottom when portrait', async () => {
    const html = await renderToString(
      <TabView tabs={tabs} selected='/sent'>
        <p>content</p>
      </TabView>,
    )
    assert.match(html, /data-tabview="portrait"/)
    assert.match(html, /data-tabview-bar="bottom"/)
    assert.ok(html.indexOf('<p>content</p>') < html.indexOf('<nav'))
    assert.equal((html.match(/<a /g) ?? []).length, 3)
  })

  it('marks the selected tab, and shows only badges with something to show', async () => {
    const html = await renderToString(<TabView tabs={tabs} selected='/sent' />)
    const links = html.split('<a ').slice(1)
    assert.ok(!links[0].includes('aria-current'))
    assert.match(links[1], /aria-current="page"/)
    assert.match(links[0], /data-tabview-badge[^>]*>2</)
    assert.ok(!links[1].includes('data-tabview-badge'))
    assert.match(links[2], /data-tabview-badge[^>]*>!</)
  })

  it('puts the bar on the side of a landscape layout', async () => {
    const left = await renderToString(
      <TabView tabs={tabs} layout={{ orientation: 'landscape', side: 'left' }} />,
    )
    assert.match(left, /data-tabview-bar="left"/)
    assert.match(left, /left: ?calc\(12px \+ env\(safe-area-inset-left\)\)/)
    // The content keeps clear of the bar on that side.
    assert.match(left, /padding-left: ?calc\(84px \+ env\(safe-area-inset-left\)\)/)

    const right = await renderToString(
      <TabView tabs={tabs} layout={{ orientation: 'landscape', side: 'right' }} />,
    )
    assert.match(right, /data-tabview-bar="right"/)
    assert.match(right, /right: ?calc\(12px \+ env\(safe-area-inset-right\)\)/)
  })
})
