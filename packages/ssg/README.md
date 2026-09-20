# ssg

> Renamed from `@kuboon/remix-ssg` at 0.10.0. The old name stops at 0.9.1 and stays on
> JSR; nothing was unpublished.

Static site generation for [`@remix-run/fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router).

You write an ordinary Remix v3 router — your routes, your renderer, your document shell — and
export it from `router.ts`. `deno serve router.ts` runs that object as the dev server. The build
drives the very same object with `fetch()`, follows the links in what it renders, and writes each
response to disk. Going from a static deploy to a live server is a change of deploy target rather
than of code.

## What this package is, and is not

It is three things:

- **A crawler-driven build.** Seed it with entry points; what is reachable is what gets generated —
  including the shared chunks a code-split bundle reaches only through `import`.
- **A host's URL-to-file rule.** GitHub Pages serves `/about` from `about.html`; Vercel, Netlify and
  S3 each answer differently. The rule is a swappable object, so the build writes the file the
  deploy would actually reach for.
- **A directory, served.** `createFileTree` answers for the files in a directory, with optional
  transforms for the ones that are not served verbatim.

It is deliberately **not** a framework. There is no content model, no document shell, no route
table, no island convention, no dev-server command. Your `router.ts` states all of that, in one
readable file, using whatever you like — and `deno serve` already is the dev server.

## Installation

```sh
deno add jsr:@remix-kbn/ssg
```

## The router

The build reads four exports from `router.ts`, and only `default` is required:

```ts
import { createRouter } from '@remix-run/fetch-router'
import { render } from '@remix-run/render-middleware'
import { createFileTree, githubPages } from '@remix-kbn/ssg/site'
import type { FileServerBehavior } from '@remix-kbn/ssg/site'
import { normalizeBase } from '@remix-kbn/ssg/base'

/** Deploy path prefix. The build strips it back off when writing, so output lands at the root. */
export const base = normalizeBase(Deno.env.get('BASE_URL'))

/** Where the crawl starts. Everything else is reached by following links. */
export const entryPoints: readonly string[] = ['/']

/** Where this deploys. The build writes the file this rule would serve. */
export const fileServer: FileServerBehavior = githubPages()

const staticFiles = await createFileTree({
  rootDir: `${import.meta.dirname}/static`,
  basePath: `${base}/static`,
})

const router = createRouter({ middleware: [render({ assets })] })

router.get(`${base}/`, (context) => context.render(<Home />))
router.map(`${base}/static/*path`, ({ request }) => staticFiles.fetch(request))

export default router
```

```sh
deno serve -P=dev --watch router.ts
deno run -c deno.json -P=build jsr:@remix-kbn/ssg/build.ts --out dist
```

> [!IMPORTANT]
> `-c deno.json` is not optional for the build. A remote main module picks up a project's config
> only when it is named, and the permission set comes from there. That is also what lets it run
> without `-A`. `deno serve` runs a local module, so it finds the config on its own.

A page nothing links to is not part of the site. Name it in `entryPoints` or it is not generated —
which also means the crawler reads HTML and never runs it, so a route reachable only through client
code needs naming here too.

## API

### `@remix-kbn/ssg/site`

#### `createFileTree(options): Promise<FileTree>`

Serves a directory. Options:

- `rootDir` — directory to serve (required)
- `basePath` — public mount point, without a trailing slash (default `''`)
- `transforms` — `FileTransform[]`, in priority order; files no transform claims are served verbatim
- `cacheControl` — `Cache-Control` for served files (default `'no-cache'`)

Returns `{ basePath, fetch(request), paths(), reload() }`. Hand `fetch` a wildcard route and the
directory is served:

```ts
router.map(`${base}/static/*path`, ({ request }) => staticFiles.fetch(request))
```

A `FileTransform` claims the files it renders (`match`), says where each is served from (`path`,
derived from the name alone and without reading the file), and renders one on demand (`render`,
returning a `Response`). That is what keeps a content format — Markdown, say — and its dependencies
out of this package.

#### `githubPages(): FileServerBehavior`

GitHub Pages' rule, and the build's default:

- `/dir/` serves `/dir/index.html`
- `/file.html`, or anything with an extension, is served as it is
- `/file` serves `/file.html`, or redirects to `/file/` when `/file/index.html` exists instead

The last line is why the build writes `about.html` rather than `about/index.html`: a site whose
links say `/about` then costs no redirect.

`FileServerBehavior` is one method — `toLocalPaths(urlPath)`, returning the files the host would try
in order — so any other host's rule is a small object you write yourself. The shape follows
[`@kuboon/file-server-behavior`](https://jsr.io/@kuboon/file-server-behavior), a structural match,
so that package's implementations can be passed in directly.

#### `joinBase`, `normalizeBase`, `stripBase`

Re-exported here for convenience; see below.

### `@remix-kbn/ssg/base`

`normalizeBase`, `joinBase` and `stripBase` — the deploy-prefix helpers, and nothing else.

`normalizeBase` turns what a GitHub Pages workflow hands out — a full URL — into the path prefix a
project site or a per-PR preview needs; a bare `/repo` is accepted too. Links and asset URLs carry
the prefix; the build strips it back off when writing, so output always lands at the root of
`dist/`. The prefix is baked in when `router.ts` evaluates, so a process builds for one deploy
target.

This is the import to reach for **from anything the browser is given**:

```ts
import { normalizeBase } from '@remix-kbn/ssg/base'
```

`/site` is the Deno half of this package — the file trees, the loader, `node:path` — so importing
from it in a browser entrypoint pulls Node built-ins into the bundle, and the bundle then fails to
load. That is easy to miss, because it only bites once a browser module imports the file a site's
routes are built from, which is what client-side routing is. `/base` has no imports at all.

### `@remix-kbn/ssg/build.ts`

The build, as a CLI:

```sh
deno run -c deno.json -P=build jsr:@remix-kbn/ssg/build.ts [--out dist] [--root .]
```

`--root` is where `router.ts` is looked for (default: the current directory); `--out` is where the
site is written (default: `dist` under the root). The deploy prefix and the entry points come from
`router.ts`, not from the command line.

## Related Packages

- [`fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router) - The router you prerender
- [`ui`](https://github.com/remix-run/remix/tree/main/packages/ui) - `renderToStream`, the SSR engine your routes render with
- [`@remix-kbn/assets-deno`](https://jsr.io/@remix-kbn/assets-deno) - Compiles the client JS the crawler then follows and writes

## License

See [LICENSE](https://github.com/remix-run/remix/blob/main/LICENSE)
