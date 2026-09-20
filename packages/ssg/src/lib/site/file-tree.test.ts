import * as assert from '@remix-run/assert'
import * as path from 'node:path'
import { describe, it } from '@std/testing/bdd'

import { createFileTree } from './file-tree.ts'
import type { FileTransform } from './file-tree.ts'

/** Stands in for a site's Markdown handling: claims `.md`, renders it, decides its route. */
let markdown: FileTransform = {
  match: (relativePath) => relativePath.endsWith('.md'),
  path: (relativePath) =>
    `/${relativePath.replace(/\.md$/, '').replace(/(^|\/)index$/, '')}`.replace(/\/$/, '') || '/',
  render: async (file) =>
    new Response(`<html><body>${await Deno.readTextFile(file.url)}</body></html>`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
}

async function makeTree(
  files: Record<string, string>,
): Promise<{ rootDir: string; cleanup: () => Promise<void> }> {
  let rootDir = await Deno.makeTempDir({ prefix: 'remix-ssg-tree-' })

  for (let [relativePath, contents] of Object.entries(files)) {
    let filePath = path.join(rootDir, relativePath)
    await Deno.mkdir(path.dirname(filePath), { recursive: true })
    await Deno.writeTextFile(filePath, contents)
  }

  return { rootDir, cleanup: () => Deno.remove(rootDir, { recursive: true }) }
}

describe('createFileTree', () => {
  it('routes transformed files by the transform and serves the rest verbatim', async () => {
    let { rootDir, cleanup } = await makeTree({
      'index.md': 'home',
      'about.md': 'about',
      'blog/hello.md': 'hello',
      'robots.txt': 'User-agent: *',
    })

    try {
      let tree = await createFileTree({ rootDir, transforms: [markdown] })

      assert.equal(
        [...tree.paths()].sort().join(' '),
        '/ /about /blog/hello /robots.txt',
        'every file is routed',
      )

      let page = await tree.fetch(new Request('http://localhost/about'))
      assert.equal(page.status, 200)
      assert.ok(page.headers.get('content-type')?.startsWith('text/html'))
      assert.ok((await page.text()).includes('about'))

      let text = await tree.fetch(new Request('http://localhost/robots.txt'))
      assert.ok(text.headers.get('content-type')?.startsWith('text/plain'), 'guesses a media type')
    } finally {
      await cleanup()
    }
  })

  it('mounts under a base path, with the root losing its trailing slash', async () => {
    let { rootDir, cleanup } = await makeTree({ 'index.md': 'home', 'about.md': 'about' })

    try {
      let tree = await createFileTree({ rootDir, basePath: '/repo', transforms: [markdown] })

      assert.equal(
        [...tree.paths()].sort().join(' '),
        '/repo /repo/about',
        'paths carry the prefix',
      )
      assert.equal((await tree.fetch(new Request('http://localhost/repo'))).status, 200)
      assert.equal((await tree.fetch(new Request('http://localhost/about'))).status, 404)
    } finally {
      await cleanup()
    }
  })

  it('hands a transform a URL that survives an awkward file name', async () => {
    // `file://${absolutePath}` would break here, which is why a transform is given a URL and not
    // asked to build one.
    let pages = await makeTree({ 'release notes #2.md': 'notes' })

    try {
      let tree = await createFileTree({ rootDir: pages.rootDir, transforms: [markdown] })
      let response = await tree.fetch(
        new Request(`http://localhost${encodeURI('/release notes #2').replace('#', '%23')}`),
      )

      assert.equal(response.status, 200)
      assert.ok((await response.text()).includes('notes'))
    } finally {
      await pages.cleanup()
    }
  })

  it('404s for a path it does not serve', async () => {
    let { rootDir, cleanup } = await makeTree({ 'index.md': 'home' })

    try {
      let tree = await createFileTree({ rootDir, transforms: [markdown] })

      assert.equal((await tree.fetch(new Request('http://localhost/nope'))).status, 404)
    } finally {
      await cleanup()
    }
  })

  it('answers 304 for a conditional request', async () => {
    let { rootDir, cleanup } = await makeTree({ 'about.md': 'about' })

    try {
      let tree = await createFileTree({ rootDir, transforms: [markdown] })

      let first = await tree.fetch(new Request('http://localhost/about'))
      let etag = first.headers.get('etag')
      assert.ok(etag !== null, 'sends an ETag')

      let second = await tree.fetch(
        new Request('http://localhost/about', { headers: { 'if-none-match': etag } }),
      )
      assert.equal(second.status, 304)
    } finally {
      await cleanup()
    }
  })

  it('refuses two files that would answer at the same path', async () => {
    let { rootDir, cleanup } = await makeTree({ 'about.md': 'md', 'about': 'verbatim' })

    try {
      await assert.rejects(
        () => createFileTree({ rootDir, transforms: [markdown] }),
        (error: Error) => error.message.includes('served at "/about"'),
      )
    } finally {
      await cleanup()
    }
  })

  it('picks up a file added since startup on reload', async () => {
    let { rootDir, cleanup } = await makeTree({ 'index.md': 'home' })

    try {
      let tree = await createFileTree({ rootDir, transforms: [markdown] })
      await Deno.writeTextFile(path.join(rootDir, 'later.md'), 'later')

      assert.equal((await tree.fetch(new Request('http://localhost/later'))).status, 404)
      await tree.reload()
      assert.equal((await tree.fetch(new Request('http://localhost/later'))).status, 200)
    } finally {
      await cleanup()
    }
  })
})
