# remix-ssg

> Renamed from `@kuboon/remix-ssg` at 0.10.0. The old name stops at 0.9.1 and stays on
> JSR; nothing was unpublished.

Static site generation (SSG) for [`remix/fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router). Pre-render a Remix router to static HTML files at build time.

`remix-ssg` drives your router in-process with `router.fetch()`, spiders the links and asset references in the rendered HTML, and writes every response to disk as a static site. Rendering happens inside your router (via `@remix-run/ui/server`), so this package adds the crawl-and-write layer, not a renderer. It is a generalized extraction of the prerenderer that builds the Remix docs site.

## Features

- **Router-driven** — works with any `remix/fetch-router` router (or any `fetch`-shaped object); no framework lock-in
- **Link-crawling** — seed a few paths and it discovers the rest by following rendered `<a>`/asset links (honoring `nofollow`)
- **Hydration-safe** — preserves Remix UI hydration comment markers and rewrites TS/JSX asset extensions to `.js` for static hosting
- **Runtime-agnostic core** — the main entry (`crawl`, `toOutput`, `rewriteExtensionsToJs`) depends only on web standards (`Request`/`Response`/`URL`); all filesystem writing lives in the optional `@remix-kbn/ssg/node` subpath

## Installation

This package is published to [JSR](https://jsr.io/@remix-kbn/ssg):

```sh
npx jsr add @remix-kbn/ssg
```

For Deno:

```sh
deno add jsr:@remix-kbn/ssg
```

## Usage

Batteries-included, writing to disk with Node's `fs` — import it from the `/node` subpath:

```ts
import { createRouter } from 'remix/fetch-router'
import { prerender } from '@remix-kbn/ssg/node'

let router = createRouter()
// ...map your routes (which render HTML via @remix-run/ui/server)...

let stats = await prerender({
  router,
  outDir: 'build/site',
  paths: ['/'], // seed paths; linked pages are discovered by crawling
})

console.log(`Wrote ${stats.pages} pages and ${stats.assets} assets`)
```

Output: each HTML page is written as `<pathname>/index.html` (clean URLs), and assets are written under their URL path with TS/JSX extensions rewritten to `.js`.

### Runtime-agnostic (no Node)

The main entry has no `node:*` imports. Crawl the router and transform each response into an
`OutputFile` (`{ path, content }`) yourself, then write it with whatever your runtime provides:

```ts
import { crawl, toOutput } from '@remix-kbn/ssg'

for await (let result of crawl(router, { paths: ['/'] })) {
  let file = await toOutput(result)
  if (!file) continue // 204 No Content
  // `file.path` is relative to the site root; `file.content` is a string or Uint8Array.
  await myWriteFile(`build/site/${file.path}`, file.content)
}
```

## API

### Main entry (`@remix-kbn/ssg`) — no Node

### `crawl(router, options): AsyncIterableIterator<CrawlResult>`

The low-level spider. Drives `router.fetch()` from the seed paths, follows rendered links/assets, and yields `{ pathname, filepath, response }`.

By default a page that responds non-OK aborts the crawl with a `CrawlError`. The error carries structured `failures` — `{ pathname, status, statusText, referrer }`, where `referrer` is the page whose HTML linked to the broken path — so you can see _which page_ produced the bad link instead of parsing a message string. Pass `onError` to keep crawling past broken links:

```ts
import { crawl, CrawlError } from '@remix-kbn/ssg'

let broken: CrawlFailure[] = []
for await (
  let result of crawl(router, {
    paths: ['/'],
    onError: (failure) => {
      broken.push(failure) // { pathname, status, referrer }
      return 'skip' // keep crawling; or 'throw' to abort here
    },
  })
) {
  // …write result…
}
if (broken.length) console.warn(`${broken.length} broken link(s)`, broken)
```

`onError` accepts `'throw'` (default), `'skip'`, or a function returning either.

### `toOutput(result): Promise<OutputFile | null>`

Transforms one `CrawlResult` into the `{ path, content }` to write (extensions rewritten, HTML/script/raw handled), or `null` for a `204`. The pure, filesystem-free half of writing a page.

### `rewriteExtensionsToJs(html): string`

Rewrites TS/JSX source extensions to `.js` in a rendered HTML document's asset references and inline hydration module URLs.

### Node subpath (`@remix-kbn/ssg/node`)

### `prerender(options): Promise<PrerenderStats>`

Batteries-included, writes to disk. Options:

- `router` — the router (or `fetch`-shaped object) to render (required)
- `outDir` — directory to write the static site into (required)
- `paths` — seed pathnames to crawl from (default `['/']`)
- `publicDir` — static files copied into `outDir` before crawling (favicons, images, …)
- `spider` — follow links found in rendered HTML (default `true`)
- `concurrency` — concurrent in-flight requests (default `1`)
- `ignorePageNofollow(pathname)` — crawl a page's links even when it is marked `nofollow`
- `onError` — how to handle a non-OK page: `'throw'` (default), `'skip'`, or a function returning either (see `crawl` above)
- `onResult(result, outputPath)` — called after each result is written

Returns `{ pages, assets, files }`.

### `writeResult(outDir, result): Promise<string | null>`

Writes one `CrawlResult` to disk under `outDir` (the Node-specific half of `toOutput`), returning the absolute path written or `null` when skipped.

## The site framework

`crawl` and `toOutput` are the primitives. `@remix-kbn/ssg/site` is the assembly around them, so
a project holds its content and nothing else.

```
my-site/
  deno.json            # imports, tasks, permission sets
  router.ts            # yours — the wiring, in one readable file
  layout.tsx           # yours — the framework has no document shell
  transforms/
    markdown.tsx       # yours — the framework never sees Markdown
    page.tsx           # yours — .tsx pages, for the ones that need islands
  pages/
    index.tsx  blog/hello.tsx     # pages that place islands
    about.md                      # pages that are text
  islands/
    counter.tsx        # a hydrated island
    store.ts           # a helper the islands share — not an entrypoint
  static/
    styles.css  favicon.svg
```

```sh
deno serve -P=dev --watch router.ts
deno run -c deno.json -P=build jsr:@remix-kbn/ssg/build.ts
```

There is no dev-server command in this package, because there is nothing left for one to do:
`router.ts` is an ordinary module that default-exports a `fetch`, so `deno serve` already is the
dev server.

> [!IMPORTANT]
> `-c deno.json` is not optional for the build. A remote main module picks up a project's config
> only when it is named, and both the permission set and `"unstable": ["bundle"]` come from there.
> That is also what lets it run without `-A`. `deno serve` runs a local module, so it finds the
> config on its own.

### The router

Nothing here is a convention — the site says what it wants served, in order:

```ts
import {
  compose,
  createFileTree,
  createIslands,
  githubPages,
  normalizeBase,
  serveAsHost,
} from '@remix-kbn/ssg/site'
import { markdown } from './transforms/markdown.tsx'
import { page } from './transforms/page.tsx'

export const base = normalizeBase(Deno.env.get('BASE_URL'))
export const entryPoints = ['/']
export const fileServer = githubPages()

let islands = await createIslands({ rootDir: 'islands', basePath: `${base}/assets` })

export default serveAsHost(
  compose(
    await createFileTree({
      rootDir: 'pages',
      basePath: base,
      transforms: [markdown({ base }), page({ base, islandUrls: islands.urls })],
    }),
    await createFileTree({ rootDir: 'static', basePath: `${base}/static` }),
    islands,
  ),
  { behavior: fileServer, base },
)
```

Islands are compiled first because the layout needs `islandUrls` — the map from an island's name to
the chunk the bundler emitted, which comes from the bundler rather than a convention because output
names shift with the set of entrypoints. In a config file that ordering had to be expressed as "the
config is a function so it can be handed the URLs". Here it is just the order of two statements.

`base`, `entryPoints` and `fileServer` are what the build reads; the default export is what
`deno serve` serves.
The build crawls that same object, so moving from a static deploy to a live server is a change of
deploy target rather than of code.

Everything composed satisfies the same contract, so a site can add its own:

```ts
interface SiteMiddleware {
  readonly basePath: string
  fetch(request: Request): Promise<Response>
  paths(): Iterable<string>
  reload(): Promise<void>
}
```

### Transforms

A transform claims the files it renders and says where they are served. This is where Markdown —
or any other format — is handled, which is what keeps it and its dependencies out of this package.

```tsx
export function markdown(context: { base: string }): FileTransform {
  return {
    match: (path) => path.endsWith('.md'),
    path: (path) =>
      `/${path.replace(/\.md$/, '').replace(/(^|\/)index$/, '')}`.replace(/\/$/, '') || '/',
    render: async (file) =>
      htmlDocument(
        <html lang='en'>
          <head>
            <title>…</title>
          </head>
          <body>{parse(await Deno.readTextFile(file.url))}</body>
        </html>,
      ),
  }
}
```

`match` and `path` are handed the file's path under the tree's root, because they answer questions
about the name. `render` is the only one that opens anything, so it gets the file itself —
`{ path, url }`, the same name plus a `file:` URL. Both things a transform does with that URL take
one (`Deno.readTextFile(url)`, `import(url.href)`), so no transform has to get the escaping right
on its own.

`render` returns a `Response`, so a transform answers in the vocabulary it is already holding
rather than unwrapping one into a body and a content type for the tree to wrap up again. Status and
headers are carried through. The tree reads the body once and keeps the bytes — an etag has to hash
them, and every later request for that path is answered from them — so the response may stream, but
it is buffered on the way through and a transform should not hand back something it cannot afford
to have read.

### `htmlDocument(node, options?): Response`

A Remix node tree as a complete HTML document response — `renderToStream` piped into
[`createHtmlResponse`](https://github.com/remix-run/remix/tree/main/packages/response#html-responses),
which supplies the doctype (prepended lazily, reading only the first chunk to see whether one is
already there) and `content-type: text/html; charset=UTF-8`.

What this adds is the choice of renderer, and it is the part that is easy to get wrong and does not
fail loudly. `renderToString` is `renderToStream` with `stripFlushMarkers()` over the result, and
the marker it strips, `<!-- rmx:flush document -->`, is how the client runtime recognises a whole
document rather than a fragment. Serve pages without it and, on any page carrying an island, an
internal link changes the URL and leaves the page alone: no error, no console warning, and the
fetch returning 200 the whole time. So a page rendered for serving streams, always.

Anything `renderToStream` takes is passed through; `response` sets the status and headers.

Transforms are tried in order, so a site can have more than one format. The fixture has two: `.md`
for text, and `.tsx` for pages that need an island. A page that wants interactivity is a component
that imports the island and places it —

```tsx
export const islands = ['counter']

export default function Hello() {
  return (
    <>
      <p>A nested page.</p>
      <Counter />
    </>
  )
}
```

— and its transform hands the layout only the chunks that page names, so `about.md` ships no
JavaScript and `blog/hello.tsx` ships the counter but not the total. Markdown needs no hydration
and gets none.

A transform decides a route from the file's path alone. The tree needs every route before rendering
anything, and a route that depended on a file's contents would make what a site serves impossible
to see by looking at it.

### Islands

```tsx
import { island } from '@remix-kbn/ssg/client'

export const Counter = island('counter', 'Counter', function Counter(handle) {
  return () => <button>…</button>
})
```

Every island goes into a **single** `Deno.bundle({ codeSplitting: true })` call, so a module more
than one of them imports — the Remix UI runtime, a store they share — is emitted once into a chunk
they all load. Compiling each entry on its own is what turns a module-level singleton into one
instance per island; this never does that.

The client runtime starts from that shared chunk, so a site declares no runtime entrypoint. An
island's id is a logical name (`island:counter#Counter`) rather than a URL, because an id is
evaluated in the browser too; the layout embeds the name-to-chunk map under
`ISLAND_MAP_ELEMENT_ID` and the runtime resolves against it.

### What gets generated

The crawl starts at `entryPoints` and follows links — including `import` inside JavaScript, which
is how a code-split bundle's shared chunks are reached. **What is reachable is what gets
generated**: a page nothing links to belongs in `entryPoints`, or it is not part of the site.

### The host

A static host is the last piece of routing in the stack, and the one this package does not control.
GitHub Pages serves `/about` from `about.html`, falls back to `about/index.html` with a redirect,
and 404s `/about/` when only the former exists; Vercel, Netlify and S3 each answer differently. Two
things depend on it — where the build writes each page, and whether the dev server behaves like the
deploy — so it is one swappable object:

```ts
interface FileServerBehavior {
  toLocalPaths(urlPath: string): (string | { target: string; path?: string })[]
}
```

The array is the files the host would try, in order: a string is served if it exists, a
`{ target, path }` is a redirect issued if `path` exists, and nothing matching is a 404. The shape
follows [`@kuboon/file-server-behavior`](https://jsr.io/@kuboon/file-server-behavior), which derives
these rules from [trailing-slash-guide](https://github.com/slorber/trailing-slash-guide) — small
enough to state here rather than depend on, and a structural match, so that package's
implementations can be passed straight in.

`githubPages()` is the default, and it is why the build writes `about.html` rather than
`about/index.html`: a site whose links say `/about` then costs no redirect.

**This is not a setting on each middleware.** Which file a URL resolves to is a property of where
the site is deployed, and every part of the site has to agree on it — so `serveAsHost` wraps the
composed site once, and the same object goes to the build. `compose` returns a `SiteMiddleware`
itself, which is what lets it nest.

Without the wrapper the dev server is quietly more forgiving than the deploy: `/about/` answers
locally and 404s in production. With it, both 404.

### Base paths

`normalizeBase` turns what a GitHub Pages workflow hands out — a full URL — into the path prefix a
project site or a per-PR preview needs; a bare `/repo` is accepted too. Links and asset URLs carry
the prefix; the build strips it back off when writing, so output always lands at the root of
`dist/`.

The prefix is baked in when `router.ts` evaluates, so a process builds for one deploy target.

`normalizeBase`, `joinBase` and `stripBase` are also exported from
**`@remix-kbn/ssg/base`**, which is the import to reach for from anything the browser is given:

```ts
import { normalizeBase } from '@remix-kbn/ssg/base'
```

`/site` is the Deno half of this package — `createIslands`, the file trees, the loader — so
importing from it in a browser entrypoint pulls `node:fs`, `node:path` and a WebAssembly loader
into the bundle, and the bundle then fails to load. That is easy to miss, because it only bites
once a browser module imports the file a site's routes are built from — which is what client-side
routing is. `/base` has no imports at all.

## Related Packages

- [`fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router) - The router you prerender
- [`ui`](https://github.com/remix-run/remix/tree/main/packages/ui) - `renderToStream` / `renderToString`, the SSR engine your routes render with
- [`assets`](https://github.com/remix-run/remix/tree/main/packages/assets) - Compiles the client JS/CSS the crawler emits for hydration

## License

See [LICENSE](https://github.com/remix-run/remix/blob/main/LICENSE)
