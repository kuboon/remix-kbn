import * as assert from '@remix-run/assert'
import { describe, it } from '@std/testing/bdd'

import { githubPages, outputPathFor } from './host.ts'
import type { FileServerBehavior } from './host.ts'

describe('githubPages', () => {
  it('serves a directory URL from its index', () => {
    assert.deepEqual(githubPages().toLocalPaths('/blog/'), ['/blog/index.html'])
  })

  it('serves anything with an extension as it is', () => {
    assert.deepEqual(githubPages().toLocalPaths('/assets/chunk.js'), ['/assets/chunk.js'])
  })

  it('tries the .html file first, then redirects to the directory form', () => {
    assert.deepEqual(githubPages().toLocalPaths('/about'), [
      '/about.html',
      { target: '/about/', path: '/about/index.html' },
    ])
  })
})

describe('outputPathFor', () => {
  it('picks the file the host would reach for first', () => {
    let behavior = githubPages()

    assert.equal(outputPathFor(behavior, '/'), '/index.html')
    assert.equal(outputPathFor(behavior, '/about'), '/about.html')
    assert.equal(outputPathFor(behavior, '/blog/hello'), '/blog/hello.html')
    assert.equal(outputPathFor(behavior, '/assets/chunk.js'), '/assets/chunk.js')
  })

  it('follows a host whose rule is not GitHub Pages', () => {
    // A host that serves directory indexes only. This is the reason the rule is an object a site
    // passes in: where each page is written follows from it, and it is not this package's to
    // decide.
    let indexes: FileServerBehavior = {
      toLocalPaths: (urlPath) =>
        urlPath.endsWith('/')
          ? [`${urlPath}index.html`]
          : [urlPath.includes('.') ? urlPath : `${urlPath}/index.html`],
    }

    assert.equal(outputPathFor(indexes, '/about'), '/about/index.html')
    assert.equal(outputPathFor(indexes, '/assets/chunk.js'), '/assets/chunk.js')
  })

  it('falls back to the URL when a host would only ever redirect', () => {
    let redirects: FileServerBehavior = {
      toLocalPaths: (urlPath) => [{ target: `${urlPath}/` }],
    }

    assert.equal(outputPathFor(redirects, '/about'), '/about')
  })
})
