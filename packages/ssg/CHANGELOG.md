# `remix-ssg` CHANGELOG

This is the changelog for [`remix-ssg`](https://github.com/kuboon/remix-kbn/tree/main/packages/ssg). It follows [semantic versioning](https://semver.org/).

## 0.12.0

Trimmed to what a site actually uses. [`remix3-ssg-gh-pages`](https://github.com/kuboon/remix3-ssg-gh-pages) is the only consumer, and it writes its own `router.ts` against `@remix-run/fetch-router` and `@remix-run/render-middleware` — so the half of this package that offered a second way to do that was never reached, and is gone.

**Removed entry points.** `@remix-kbn/ssg` (the root), `@remix-kbn/ssg/node` and `@remix-kbn/ssg/client`.

- The root exported `crawl`, `CrawlError`, `toOutput` and `rewriteExtensionsToJs` — the build's own internals, exposed for a caller who wanted to drive it by hand. `build.ts` still uses them; nothing else did.
- `/node` exported `prerender` and `writeResult`, the batteries-included build for Node's `fs`. The build writes with `Deno`.
- `/client` exported `island()`, a `clientEntry()` wrapper that resolved a logical island id through a map the server embedded. A site that names its client entries with `import.meta.url` — which is what `@remix-run/render-middleware` and an asset server already resolve — needs none of it.

**Removed from `/site`.** `createIslands`, `htmlDocument`, `compose`, `serveAsHost`, plus the `buildSite` / `loadRouter` re-exports and the `SiteMiddleware` type.

- `createIslands` compiled a directory of islands into code-split chunks. It is `createAssetServer` from [`@remix-kbn/assets-deno`](https://jsr.io/@remix-kbn/assets-deno) with a glob in front of it, and a site that calls that package directly gets to say which entrypoints it has.
- `htmlDocument` rendered a node tree into an HTML `Response`. `context.render()` from `@remix-run/render-middleware` does that, and answers the hooks a client entry needs besides.
- `compose` merged middlewares by passing a `404` along. A router already routes.
- `serveAsHost` made the dev server resolve URLs the way the deploy would. It only worked for a site assembled out of `compose`, which is no longer a thing this package offers.

With them go the dependencies they carried: `@remix-kbn/assets-deno`, `@remix-run/ui`, `@remix-run/ui/server` and `@remix-run/response/html` are no longer in this package's import map at all.

**Still here, unchanged:** `createFileTree`, `githubPages`, `FileServerBehavior`, the deploy-prefix helpers, and `build.ts`. That is everything a site imports.

**New entry point: `@remix-kbn/ssg/base`**, exporting `normalizeBase`, `joinBase` and `stripBase` — and nothing else.

```diff
- import { normalizeBase } from '@remix-kbn/ssg/site'
+ import { normalizeBase } from '@remix-kbn/ssg/base'
```

They are also still exported from `/site`, so nothing has to move. What changes is what importing them costs a module the browser is given: `/site` reaches `node:path` through the file tree and the loader, so a browser entrypoint that imports it pulls Node built-ins into the bundle, and the bundle then fails to load. A site hits that the moment anything in a browser entrypoint imports the module its routes are built from — which is what client-side routing is. `/base` has no imports of its own.

**Renamed:** the type `SiteMiddleware` is `FileTree`, and lives beside `createFileTree` that returns it.

## 0.11.0

- Tracks the `remix@3.0.0-rc.3` package set: `@remix-run/ui` `^0.9.0` → `^0.10.0`. A minor rather than a patch because a `^0.10.0` range excludes 0.9, so leaving it would resolve a consumer a second copy of the UI runtime.

  (Written after the fact — this release went out without an entry here.)

## 0.10.0

- Moved to the `@remix-kbn` scope: this package is **`@remix-kbn/ssg`** from 0.10.0 on. The `remix-` prefix went with the move, because the scope says it now.

  ```diff
  - "@kuboon/remix-ssg": "jsr:@kuboon/remix-ssg@^0.9.1"
  + "@remix-kbn/ssg": "jsr:@remix-kbn/ssg@^0.10.0"
  ```

  No code changed. The minor bump is so that no version number exists under both names — 0.10.0 is only ever the new one.

  `@kuboon/remix-ssg` stops at 0.9.1, whose only content was the notice that this was coming. JSR cannot unpublish, so every version under the old name keeps resolving exactly as it did; entries below 0.9.1 describe releases made there.
- `@remix-kbn/assets-deno` `^0.7.0` → `^0.8.0`, which is that package's own move. Both ranges have to turn over together, or a consumer resolves the asset server twice — once under each name.

## 0.9.1

- Moving to the `@remix-kbn` scope: this package continues as **`@remix-kbn/ssg`**, with the `remix-` prefix dropped because the scope now says it.

  ```diff
  - "@kuboon/remix-ssg": "jsr:@kuboon/remix-ssg@^0.9.0"
  + "@remix-kbn/ssg": "jsr:@remix-kbn/ssg"
  ```

  0.9.1 is the announcement and nothing more — its code is 0.9.0's, byte for byte. Nothing breaks if you stay: JSR cannot unpublish, so every version under this name keeps resolving exactly as it does today, and there is no deadline attached to moving.

## 0.9.0

- Tracks the `remix@3.0.0-rc.2` package set: `@remix-run/fetch-router` 0.21 → 0.22 and `@remix-run/ui` 0.8 → 0.9. Both are additive for what this package uses — `renderToStream`, `clientEntry`, `run` — and `fetch-router` appears only in a doc comment. A minor rather than a patch for the same reason 0.7.0 was: a `^0.22.0` range excludes 0.21, so leaving it would resolve a consumer a second copy of the router.
- `@kuboon/remix-assets-deno` `^0.4.2` → `^0.7.0`, so `createIslands` and a consumer's own asset server are one copy rather than two.

  `fetch-router` 0.22 also changes what a router answers when a path matches and the method does not: a `405` with an `Allow` header, where 0.21 fell through to the `404` handler. The crawl only issues `GET`, so nothing here changes — but a site with its own method-mismatch expectations should know.

## 0.7.0

- `@remix-run/ui` 0.7.0 → 0.8.0, the `remix@3.0.0-rc.1` set. `spaResponse` is new and `addEventListeners` is gone; this package used neither. `@remix-run/fetch-router` stays at `^0.21.0` — rc.1 pins the same range.

  The bump is a minor here rather than a patch because a `^0.8.0` range excludes 0.7: a consumer still on `@remix-run/ui` 0.7 would resolve a second copy of the runtime, which is exactly what 0.6.0 set out to stop.

## 0.6.0

- Depends on the `@remix-run/*` packages it actually uses instead of the `remix` meta-package. `remix` pins a compatible set of ~45 packages, so importing it for `remix/ui` also pulled data-table, its three dialect drivers, the CLI, a tar parser and the rest into every consumer's `node_modules`. This package needs two of them:

  ```diff
  - "remix": "npm:remix@3.0.0-beta.5"
  + "@remix-run/fetch-router": "npm:@remix-run/fetch-router@^0.21.0"
  + "@remix-run/ui": "npm:@remix-run/ui@^0.7.0"
  + "@remix-run/ui/server": "npm:@remix-run/ui@^0.7.0/server"
  ```

  `compilerOptions.jsxImportSource` moves from `remix/ui` to `@remix-run/ui` with it.

- Updated from the beta.5 set to the beta.10 one: `@remix-run/ui` 0.4.0 → 0.7.0 and `@remix-run/fetch-router` 0.20.1 → 0.21.0. Nothing this package does was touched by the breaking changes in between — it defines no `resolveFrame`, builds no `href()` with search params, and declares no route patterns.

## 0.5.2

- `buildSite` named output files after a URL's escapes. A crawl carries paths in the form a request uses, so a page linked as `/notes%20%231` was written to a file literally called `notes%20%231.html` — which a static host, decoding the request before it looks, would never find. Output paths are decoded now. This is the last of the three places the same confusion lived; the fixture site has a page whose name needs escaping, reached through an ordinary link, so a build proves it end to end.

## 0.5.1

- `serveAsHost` lost half of any path that needed escaping. Having matched a request to what the site serves, it rebuilt the URL from the tree's key — which is in decoded form — with `new URL(served, url)`. For `/blog/release notes #2` that makes everything after the `#` a fragment, so the request arrived at the tree as `/blog/release notes` and 404'd. Paths are now escaped per segment on the way back into a URL. Redirect targets went through the same path and are fixed with it.

## 0.5.0

- `FileTransform.render` takes one argument instead of two. It used to be handed `(absolutePath, relativePath)` — the same fact spelled twice, since the tree knows its own root. It now gets a `SourceFile`:

  ```ts
  interface SourceFile {
    readonly path: string // under the tree's root — what match() and path() saw
    readonly url: URL // where to read it
  }
  ```

  A URL rather than a path, because both things a transform does with it take one — `Deno.readTextFile(url)` and `import(url.href)` — so no transform has to build `file://${absolutePath}` and get the escaping right. The two that shipped with 0.4.0 both did that by hand, and one of them did it wrong: a page whose file name contains a space or a `#` failed to load. Pinned by a test.

  `match` and `path` still take a plain string. They answer questions about the name; `render` is the only one that opens anything.

## 0.4.0

- Added `@kuboon/remix-ssg/site`: the parts a static site is assembled from, and one CLI entry, `build.ts`. A site wires the parts together itself, in a `router.ts` it owns:

  ```ts
  export const base = normalizeBase(Deno.env.get('BASE_URL'))
  export const entryPoints = ['/']

  let islands = await createIslands({ rootDir: 'islands', basePath: `${base}/assets` })

  export default compose(
    await createFileTree({
      rootDir: 'pages',
      basePath: base,
      transforms: [markdown({ base, islandUrls: islands.urls })],
    }),
    await createFileTree({ rootDir: 'static', basePath: `${base}/static` }),
    islands,
  )
  ```

  ```sh
  deno serve -P=dev --watch router.ts
  deno run -c deno.json -P=build jsr:@kuboon/remix-ssg/build.ts
  ```

  There is no dev-server command, because `router.ts` is an ordinary module that default-exports a `fetch` — `deno serve` already is one. Pass `-c deno.json` to the build: a remote main module picks up a project's config only when it is named, and both the permission set and `"unstable": ["bundle"]` come from there, so neither `-A` nor `--unstable-bundle` belongs on the command line.

- The static host's URL-to-file rule is a swappable object, `FileServerBehavior`, and the default is `githubPages()`. It decides two things that have to agree: where the build writes each page, and how the dev server resolves a request. `serveAsHost` wraps the composed site with it — not a setting on each middleware, because which file a URL resolves to is a property of the deploy target and every part of the site has to agree on it. The shape follows [`@kuboon/file-server-behavior`](https://jsr.io/@kuboon/file-server-behavior) closely enough to accept its implementations, without depending on it.

  Two consequences worth knowing. Pages are now written as `about.html` rather than `about/index.html`, because that is the file GitHub Pages reaches for first — so a site whose links say `/about` no longer pays a redirect. And `/about/` now 404s in the dev server, as it does on the deploy, instead of quietly working.

  `crawl` gained an `outputPath` option for the same reason; its default is unchanged.

- There is no config file and no site object. Islands have to be compiled before the layout can be handed `islandUrls` — the map from an island's name to the chunk the bundler emitted, which shifts with the set of entrypoints — and in a config that ordering had to be expressed as "the config is a function so it can receive them". In a router it is the order of two statements.

- What the framework deliberately does not have: a content model, a document shell, a route table. A `FileTransform` claims the files it renders and says where they are served, and it comes from the site — which is what keeps Markdown, or any other format, and its dependencies out of this package. The layout is the site's too. Transforms are tried in order, so a site can mix formats: the fixture serves `.md` as text and `.tsx` as pages that import an island and place it, with each page loading only the chunks it names.

- `SiteMiddleware` names the contract everything composed satisfies — mount point, fetch, what it serves, rebuild — which `@kuboon/remix-assets-deno`'s asset server already had. `compose` treats a `404` as "not mine" and passes it along, so pages and islands share a site without knowing about each other.

- `crawl` now follows `import` out of JavaScript responses. A code-split bundle reaches its shared chunks only that way, and seeding them separately was a special case standing in for what crawling is for. One rule covers the site: what is reachable from `entryPoints` is what gets generated. A page nothing links to is still _served_ — it is unreachable, not unserved — so naming it in `entryPoints` is all it takes to build it.

- Added `@kuboon/remix-ssg/client` with `island()`. Islands are compiled as one graph, so a module two of them import is emitted once — and the client runtime starts from the chunk they share rather than from a runtime entrypoint a site would have to declare. An island's id is a logical name rather than a URL, because ids are evaluated in the browser too, where predicting the bundler's output naming is guesswork.

- The framework's exports depend on `remix` and `@kuboon/remix-assets-deno`. Importing `@kuboon/remix-ssg` for `crawl`/`toOutput` does not enter those module graphs, so a crawl-only consumer fetches nothing new.

## 0.3.0

- `crawl` failures are handleable rather than fatal by default: a non-OK page raises a `CrawlError` carrying structured `CrawlFailure`s (status, pathname, referrer), and `onError` takes `'throw'`, `'skip'`, or a function deciding per failure — so a build can collect broken links and fail on its own terms.

## 0.2.0

- **Breaking:** the main entry (`@kuboon/remix-ssg`) is now free of `node:*` imports and depends only on web standards (`Request`/`Response`/`URL`). The filesystem-writing entry points `prerender` and `writeResult` moved to the new `@kuboon/remix-ssg/node` subpath.
- Added `toOutput(result)`, the runtime-agnostic transform that turns a `CrawlResult` into the `OutputFile` (`{ path, content }`) to write, so consumers can render a static site with any runtime's filesystem (or none).

## 0.1.0

- Initial release of `@kuboon/remix-ssg`, a static site generator (prerenderer) for `remix/fetch-router`, published to JSR from the `kuboon-remix-utils` repository via the shared `kuboon/workflows` release workflow.
