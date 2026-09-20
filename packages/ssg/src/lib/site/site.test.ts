import * as assert from '@remix-run/assert'
import * as path from 'node:path'
import { describe, it } from '@std/testing/bdd'

import { buildSite } from './build.ts'
import { loadRouter } from './load.ts'
import type { SiteRouter } from './load.ts'

let siteDir = new URL('./__fixtures__/site/', import.meta.url).pathname
let routerUrl = new URL('./__fixtures__/site/router.ts', import.meta.url).href

/**
 * Imports the fixture router under a given deploy prefix.
 *
 * The prefix is baked into the routes when the router module evaluates, so a second prefix needs a
 * second evaluation — hence the query. That is the real constraint, not a test artifact: a site is
 * built for one deploy target per process.
 */
async function load(base?: string): Promise<SiteRouter> {
  if (base === undefined) Deno.env.delete('BASE_URL')
  else Deno.env.set('BASE_URL', base)

  try {
    return await import(`${routerUrl}?base=${encodeURIComponent(base ?? '')}`) as SiteRouter
  } finally {
    Deno.env.delete('BASE_URL')
  }
}

async function build(base?: string) {
  let router = await load(base)
  let outDir = await Deno.makeTempDir({ prefix: 'remix-ssg-site-' })
  let stats = await buildSite(router, { outDir })
  let files = new Set<string>()

  for await (let entry of walk(outDir, outDir)) files.add(entry)

  return {
    stats,
    outDir,
    files,
    read: (relativePath: string) => Deno.readTextFile(path.join(outDir, relativePath)),
    cleanup: () => Deno.remove(outDir, { recursive: true }),
  }
}

async function* walk(directory: string, root: string): AsyncIterableIterator<string> {
  for await (let entry of Deno.readDir(directory)) {
    let full = path.join(directory, entry.name)
    if (entry.isDirectory) yield* walk(full, root)
    else yield path.relative(root, full)
  }
}

describe('buildSite', () => {
  it('writes the pages reachable from the entry points', async () => {
    let { files, cleanup } = await build()

    try {
      // `about.html`, not `about/index.html`: GitHub Pages reaches for the former first, so a
      // site whose links say `/about` costs no redirect.
      assert.ok(files.has('index.html'), 'the entry point itself')
      assert.ok(files.has('about.html'), 'a page linked from it')
      assert.ok(files.has('blog/hello.html'), 'a nested page linked from it')
      assert.ok(files.has('orphan.html'), 'a page linked from nowhere but named an entry')
    } finally {
      await cleanup()
    }
  })

  it('names an output file after the path, not after its escapes', async () => {
    let { files, cleanup } = await build()

    try {
      // The home page links to `/release%20notes%20%232`. A host decodes before it looks, so the
      // file has to carry the decoded name — `release%20notes%20%232.html` would never be found.
      assert.ok(files.has('release notes #2.html'), `decoded file name, got ${[...files]}`)
    } finally {
      await cleanup()
    }
  })

  it('leaves out a page nothing links to and nothing names', async () => {
    let { files, cleanup } = await build()

    try {
      assert.ok(!files.has('hidden.html'), `hidden is not part of the site, got ${[...files]}`)
    } finally {
      await cleanup()
    }
  })

  it('serves static files verbatim under their own prefix', async () => {
    let { files, cleanup } = await build()

    try {
      assert.ok(files.has('static/styles.css'), 'the stylesheet every page links')
    } finally {
      await cleanup()
    }
  })

  it('follows an import, so a module only another module names is written too', async () => {
    let { files, read, cleanup } = await build()

    try {
      assert.ok(files.has('static/app.js'), 'the script a page loads')
      assert.ok(files.has('static/shared.js'), `reached by import alone, got ${[...files]}`)
      assert.ok((await read('static/shared.js')).includes('fixture-shared-module'))
    } finally {
      await cleanup()
    }
  })

  it('counts exactly the pages it reached, and no more', async () => {
    let { stats, cleanup } = await build()

    try {
      assert.equal(stats.pages, 5, 'home, about, hello, release notes, orphan')
    } finally {
      await cleanup()
    }
  })

  it('prefixes every URL under a base path but writes files at the root', async () => {
    let { files, read, cleanup } = await build('/repo')

    try {
      assert.ok(files.has('index.html'), 'output still lands at the root')
      assert.ok(files.has('orphan.html'), 'a prefixed entry point too')
      assert.ok(files.has('static/app.js'), 'assets too')

      let html = await read('index.html')
      assert.ok(html.includes('href="/repo/static/styles.css"'), 'the stylesheet carries it')
      assert.ok(html.includes('src="/repo/static/app.js"'), 'the script URL carries it')
      assert.ok(html.includes('href="/repo"'), 'the root link drops the trailing slash')
    } finally {
      await cleanup()
    }
  })

  it('accepts a full deploy URL, not just a path prefix', async () => {
    let { read, cleanup } = await build('https://example.github.io/repo/')

    try {
      assert.ok((await read('index.html')).includes('href="/repo/static/styles.css"'))
    } finally {
      await cleanup()
    }
  })

  it('reports the prefix and the output directory it built for', async () => {
    let { stats, outDir, cleanup } = await build('/repo')

    try {
      assert.equal(stats.base, '/repo')
      assert.equal(stats.outDir, outDir)
      assert.ok(stats.assets > 0, 'the stylesheet and the two scripts')
    } finally {
      await cleanup()
    }
  })
})

describe('the router itself', () => {
  it('serves pages and static files from one handler', async () => {
    let router = await load()

    let page = await router.default.fetch(new Request('http://localhost/about'))
    assert.equal(page.status, 200)
    assert.ok(page.headers.get('content-type')?.startsWith('text/html'))

    let css = await router.default.fetch(new Request('http://localhost/static/styles.css'))
    assert.equal(css.status, 200)

    let script = await router.default.fetch(new Request('http://localhost/static/app.js'))
    assert.equal(script.status, 200)
    assert.ok(script.headers.get('content-type')?.includes('javascript'))

    assert.equal((await router.default.fetch(new Request('http://localhost/nope'))).status, 404)
  })

  it('answers for a page the build leaves out — it is unreachable, not unserved', async () => {
    let router = await load()

    assert.equal((await router.default.fetch(new Request('http://localhost/hidden'))).status, 200)
  })
})

describe('loadRouter', () => {
  it('explains itself when there is no router', async () => {
    let empty = await Deno.makeTempDir({ prefix: 'remix-ssg-empty-' })

    try {
      await assert.rejects(
        () => loadRouter(empty),
        (error: Error) => error.message.includes('No router'),
      )
    } finally {
      await Deno.remove(empty, { recursive: true })
    }
  })

  it('finds the router a site wrote', async () => {
    let { router, rootDir } = await loadRouter(siteDir)

    assert.equal(typeof router.default.fetch, 'function')
    assert.equal(rootDir, siteDir.replace(/\/$/, ''))
  })
})
