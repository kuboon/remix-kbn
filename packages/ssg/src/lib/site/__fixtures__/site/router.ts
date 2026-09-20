/**
 * The fixture site, wired the way a real one is.
 *
 * This is the shape `build.ts` reads: a module that default-exports something with `fetch`, plus
 * the three optional exports that say where the site deploys, where the crawl starts, and which
 * file the host answers a URL from. Nothing here is a convention this package imposes — the routes,
 * the renderer and the directory names are all stated right here, which is the point.
 *
 * A real site writes `rootDir: 'static'` and lets it resolve against the directory it is run from;
 * this one is a fixture inside a package, so it says where it lives.
 */

import { createRouter } from '@remix-run/fetch-router'

import { createFileTree } from '../../file-tree.ts'
import { githubPages } from '../../host.ts'
import type { FileServerBehavior } from '../../host.ts'
import { normalizeBase } from '../../base.ts'
import * as pages from './pages.ts'

let here = import.meta.dirname!

/** Deploy path prefix. The build strips it back off when writing, so output lands at the root. */
export const base: string = normalizeBase(Deno.env.get('BASE_URL'))

/** `/orphan` is linked from nowhere, so it is only built because it is named here. */
export const entryPoints: readonly string[] = ['/', '/orphan']

/** Where this site deploys. The build writes the file this rule would serve. */
export const fileServer: FileServerBehavior = githubPages()

const staticFiles = await createFileTree({
  rootDir: `${here}/static`,
  basePath: `${base}/static`,
})

const router = createRouter()

router.get(base === '' ? '/' : base, () => pages.html(pages.home(base)))
router.get(`${base}/about`, () => pages.html(pages.about(base)))
router.get(`${base}/blog/hello`, () => pages.html(pages.hello(base)))
router.get(`${base}/release notes #2`, () => pages.html(pages.releaseNotes(base)))
router.get(`${base}/orphan`, () => pages.html(pages.orphan(base)))
// Served, but nothing links to it and nothing names it an entry point — so it is not built.
router.get(`${base}/hidden`, () => pages.html(pages.hidden(base)))

router.map(`${base}/static/*path`, ({ request }) => staticFiles.fetch(request))

export default router
