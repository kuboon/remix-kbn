/**
 * The pieces a site's `router.ts` reaches for.
 *
 * This package does not supply a site's shape. A site writes an ordinary
 * [`@remix-run/fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router)
 * router — its own routes, its own renderer, its own document shell — and exports it. `deno serve
 * router.ts` runs that object as the dev server, and `jsr:@remix-kbn/ssg/build.ts` crawls the same
 * object into static files. What is here is the two things that are awkward to write by hand:
 * serving a directory, and knowing which file a static host answers a URL from.
 *
 * ```ts
 * // router.ts
 * import { createRouter } from '@remix-run/fetch-router'
 * import { createFileTree, githubPages } from '@remix-kbn/ssg/site'
 * import type { FileServerBehavior } from '@remix-kbn/ssg/site'
 * import { normalizeBase } from '@remix-kbn/ssg/base'
 *
 * export const base = normalizeBase(Deno.env.get('BASE_URL'))
 * export const entryPoints: readonly string[] = ['/']
 * export const fileServer: FileServerBehavior = githubPages()
 *
 * let staticFiles = await createFileTree({ rootDir: 'static', basePath: `${base}/static` })
 *
 * const router = createRouter()
 * router.get(`${base}/`, () => new Response('…', { headers: { 'content-type': 'text/html' } }))
 * router.map(`${base}/static/*path`, ({ request }) => staticFiles.fetch(request))
 *
 * export default router
 * ```
 *
 * ```sh
 * deno serve -P=dev --watch router.ts
 * deno run -c deno.json -P=build jsr:@remix-kbn/ssg/build.ts
 * ```
 *
 * The four exports `router.ts` is read for — `default`, `base`, `entryPoints`, `fileServer` — are
 * documented on `SiteRouter` in the build's own module; nothing but the build reads them.
 *
 * @module
 */

export { createFileTree } from './lib/site/file-tree.ts'
export type { FileTransform, FileTree, FileTreeOptions, SourceFile } from './lib/site/file-tree.ts'
export { githubPages } from './lib/site/host.ts'
export type { FileServerBehavior, Redirect } from './lib/site/host.ts'
export { joinBase, normalizeBase, stripBase } from './lib/site/base.ts'
