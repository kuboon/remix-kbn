import * as assert from '@remix-run/assert'
import { describe, it } from '@std/testing/bdd'

import { DEFAULT_LAYOUT, layoutOf, screenLayout, watchScreenLayout } from './mod.ts'

const metrics = { width: 400, height: 800, screenWidth: 1920, screenX: 0 }

describe('layoutOf', () => {
  it('is portrait when taller than wide, landscape otherwise', () => {
    assert.equal(layoutOf(metrics).orientation, 'portrait')
    assert.equal(layoutOf({ ...metrics, width: 1200 }).orientation, 'landscape')
    assert.equal(layoutOf({ ...metrics, width: 800 }).orientation, 'landscape')
  })

  it('is left when the window starts on the left half of the screen', () => {
    assert.equal(layoutOf({ ...metrics, screenX: 0 }).side, 'left')
    assert.equal(layoutOf({ ...metrics, screenX: 959 }).side, 'left')
    assert.equal(layoutOf({ ...metrics, screenX: 960 }).side, 'right')
    assert.equal(layoutOf({ ...metrics, screenX: 1500 }).side, 'right')
  })
})

/** Just enough of a window for the layout functions. */
function fakeWindow(init: { innerWidth: number; innerHeight: number; screenX: number }) {
  const win = Object.assign(new EventTarget(), {
    ...init,
    screenLeft: init.screenX,
    screen: { width: 1920 },
  })
  return win as typeof win & Window
}

describe('screenLayout', () => {
  it('measures the window it is given', () => {
    const win = fakeWindow({ innerWidth: 1000, innerHeight: 700, screenX: 1200 })
    assert.deepEqual(screenLayout(win), { orientation: 'landscape', side: 'right' })
  })

  it('falls back to portrait without a window', () => {
    assert.deepEqual(screenLayout(undefined), DEFAULT_LAYOUT)
  })
})

describe('watchScreenLayout', () => {
  it('reports changes on resize, and only changes', () => {
    const win = fakeWindow({ innerWidth: 400, innerHeight: 800, screenX: 0 })
    const seen: string[] = []
    const controller = new AbortController()
    const now = watchScreenLayout((layout) => seen.push(`${layout.orientation}-${layout.side}`), {
      window: win,
      signal: controller.signal,
      pollInterval: 0,
    })
    assert.deepEqual(now, { orientation: 'portrait', side: 'left' })

    win.dispatchEvent(new Event('resize'))
    win.innerWidth = 1000
    win.dispatchEvent(new Event('resize'))
    win.dispatchEvent(new Event('resize'))
    assert.deepEqual(seen, ['landscape-left'])

    controller.abort()
    win.innerHeight = 2000
    win.dispatchEvent(new Event('resize'))
    assert.deepEqual(seen, ['landscape-left'])
  })

  it('notices a moved window by polling', async () => {
    const win = fakeWindow({ innerWidth: 1000, innerHeight: 700, screenX: 0 })
    const seen: string[] = []
    const controller = new AbortController()
    watchScreenLayout((layout) => seen.push(layout.side), {
      window: win,
      signal: controller.signal,
      pollInterval: 5,
    })
    win.screenX = 1500
    await new Promise((resolve) => setTimeout(resolve, 30))
    controller.abort()
    assert.deepEqual(seen, ['right'])
  })
})
