# remix-assets-deno

> Renamed from `@kuboon/remix-assets-deno` at 0.8.0. The old name stops at 0.7.1 and stays on
> JSR; nothing was unpublished.

On-demand asset server for [`remix/fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router), built on Deno's own resolver and loader — so **JSR imports work**.

This is the JSR-capable counterpart of [`@remix-run/assets`](https://github.com/remix-run/remix/tree/main/packages/assets). That package resolves imports with `oxc-resolver`, which only understands `node_modules`, so a `jsr:` specifier never resolves — and `nodeModulesDir: "auto"` does not help, because Deno keeps JSR packages in its global cache and materializes only npm packages into `node_modules`. Here resolution, loading, and TypeScript/JSX transpilation all come from [`@deno/loader`](https://jsr.io/@deno/loader), the same machinery the Deno CLI uses, so JSR, npm, `deno.json` import maps, and workspace members resolve exactly the way the running Deno process resolves them.

## The problem: duplicated singletons

If three client entries all `import { sessionStore } from './session.ts'`, a bundler that compiles each entry **independently** inlines a separate copy of `session.ts` into each bundle. Module-level state is then per-bundle, so the "singleton" is really three instances — the usual workaround being to anchor the instance on `globalThis` behind a symbol.

Note what actually breaks it: not bundling, but compiling each entry on its own. This package offers the two ways out, and never does the thing that duplicates.

|                      | `mode: 'modules'` (default)                                                | `mode: 'bundle'`                                                            |
| -------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| How identity is kept | one URL per module — the browser's module registry evaluates each URL once | one graph, code-split so shared modules land in a chunk every entry imports |
| Equivalent to        | Vite's dev server                                                          | Rollup / webpack / Vite's production build                                  |
| Output               | every module, individually addressable                                     | a chunk per entry plus shared chunks                                        |
| Requests             | many                                                                       | few                                                                         |
| Minified             | no                                                                         | yes, by default                                                             |
| Build step           | none — compiled in memory on startup                                       | one `Deno.bundle` call on startup                                           |
| Needs                | `@deno/loader`                                                             | Deno's `--unstable-bundle` flag                                             |

Use `'modules'` when you want per-module URLs in devtools and no bundler in the loop. Use `'bundle'` when the output ships to a browser over a network — or gets crawled into a static site — and request count and bytes matter.

## Features

- **Two modes, one guarantee** — per-module URLs or code-split chunks; a shared module stays one instance either way
- **JSR + npm + import maps** — resolution comes from `@deno/loader`, not a reimplementation
- **True module identity** — one resolved specifier, one URL, one instance
- **No bundling, no build step, no subprocess** — compile in-process on startup, serve from memory
- **CommonJS interop** — CJS dependencies are wrapped as ES modules instead of being refused
- **Runtime graph only** — type-only modules are never served, because they do not exist at runtime
- **Readable URLs** — `/assets/app/client/session.js`, `/assets/jsr/@kuboon/dpop/0.1.2/client/mod.js`
- **Conditional requests** — `ETag` + `304`, so reloads are cheap

## Installation

```sh
deno add jsr:@remix-kbn/assets-deno
```

## Usage

```ts
import { createRouter } from '@remix-run/fetch-router'
import { createAssetServer } from '@remix-kbn/assets-deno'

let assets = await createAssetServer({
  rootDir: new URL('..', import.meta.url).pathname,
  entrypoints: ['client/*.tsx'],
  configPath: 'client/deno.json',
})

let router = createRouter()
router.map('/assets/*path', ({ request }) => assets.fetch(request))
```

Then point each entry's `<script>` at its public URL:

```tsx
<script async type='module' src={assets.entryUrl('client/nav_auth.tsx')} />
```

Run with `--allow-read --allow-env --allow-net`. `--allow-net` is only needed when something is not already in the Deno cache. **No `--allow-run`** — nothing is shelled out to.

Your `deno.json`'s `compilerOptions` are honored, so a JSX config like
`{ "jsx": "react-jsx", "jsxImportSource": "@remix-run/component" }` needs no repeating here.

### Naming the entrypoints

An entrypoint may be a path, a `file:` URL, or a glob:

```ts
entrypoints: ;
;['client/hydration.ts', 'islands/*.tsx', 'islands/showcase/*.tsx']
```

Globs are expanded once at startup and their matches sorted, so a build is reproducible; a pattern
matching nothing is an error rather than an empty set. `islands/*.tsx` also leaves `islands/_lib/`
alone by depth, without the underscore having to mean anything.

Why expand at all, when [`@remix-run/assets`](https://github.com/remix-run/remix/tree/main/packages/assets)
keeps globs as globs and compiles on demand? Because `mode: 'bundle'` cannot: `Deno.bundle` takes
its entry points up front, and code splitting cannot know which module is shared until it knows
every entry. The glob is the same idea; the expansion is what bundling costs.

### With Remix's render middleware

`render()` from [`@remix-run/render-middleware`](https://github.com/remix-run/remix/tree/main/packages/render-middleware) asks for an asset server structurally — `Pick<AssetServer, 'getHref' | 'getPreloads'>` — so this one goes straight in:

```ts
import { createRouter } from '@remix-run/fetch-router'
import { render } from '@remix-run/render-middleware'

let router = createRouter({ middleware: [render({ assets })] })
```

That is what makes `clientEntry(import.meta.url, function Counter(…) {…})` work: the middleware hands the module's own `file:` URL to `getHref` and takes the export name from the component's name.

### Bundled mode

Same API, same `entryUrl()` — the difference is what comes out the other end:

```ts
let assets = await createAssetServer({
  rootDir: new URL('..', import.meta.url).pathname,
  entrypoints: ['client/nav_auth.tsx', 'client/signin_card.tsx', 'client/push_card.tsx'],
  mode: 'bundle',
  bundle: { minify: true, sourcemap: 'linked' },
})
```

All three entrypoints go into a **single** `Deno.bundle({ codeSplitting: true, format: 'esm' })` call,
so `session.ts` is emitted once into a shared chunk that all three entry chunks import. Run with
`--unstable-bundle`:

```sh
deno run --unstable-bundle -A server.ts
```

The chunks import each other by relative path, so serving the output under one base path is all it
takes — nothing rewrites the emitted code.

> [!IMPORTANT]
> `Deno.bundle` takes no config argument: it uses the import map and `compilerOptions` from the
> config the **process** started with, and `Deno.chdir` does not change that (the config is bound at
> startup). So `configPath` is ignored in bundled mode — start the process from the project its
> entrypoints belong to.

Bundled mode is also what makes this usable from a static site generator: prerender the pages, then
write every URL in `moduleUrls()` to disk alongside them.

### CommonJS dependencies

Browsers run ES modules only, so a CommonJS file cannot be served as-is — `module` is not defined,
and an importer asking for a default export finds none. `@remix-run/assets` refuses such a module
outright (`COMMONJS_NOT_SUPPORTED`).

Here CJS is wrapped as an ES module, the way esbuild and Vite do:

```js
import __cjs_dep_0 from '/assets/npm/ms/index.js' // each require(), hoisted
const __cjs_module = { exports: {} }
;(function (exports, require, module, __filename, __dirname) {
  /* the original CommonJS body */
}).call(__cjs_module.exports, __cjs_module.exports, __cjs_require, __cjs_module, '…', '…')
export default __cjs_module.exports
export const greet = __cjs_module.exports.greet // each detected named export
```

Two details beyond the bare `module`/`exports` shim are what make this work on real packages.
`require()` calls with a literal specifier are hoisted to real imports and resolved under Node's
require semantics, so a package like `debug` — which does `require('./common')` — loads. And the
names the module assigns are detected with `cjs-module-lexer` and re-exported individually, so
`import { greet } from …` keeps working instead of only `import greet from …`.

Because the served body is an ES module, its URL ends in `.js` even when the source was `.cjs`.

What is _not_ handled: `require(someVariable)` cannot be resolved ahead of time and throws at
runtime; Node globals such as `process` and `Buffer` are not shimmed; and a CJS import cycle
resolves in ESM order rather than CommonJS's partially-filled-exports order.

### Deleting the globalThis singleton workaround

With one URL per module, module-level state is genuinely shared:

```ts
// Before: anchored on globalThis because each entry got its own copy.
const STORE_KEY = Symbol.for('kbn.dpop-session-store')
export const sessionStore = (globalThis[STORE_KEY] ??= new DpopSessionStore())

// After: a plain module-level instance.
export const sessionStore: DpopSessionStore = new DpopSessionStore()
```

## API

### `createAssetServer(options): Promise<DenoAssetServer>`

- `entrypoints` — client entrypoints: paths relative to `rootDir`, absolute `file:` URLs, or globs over `rootDir` (required)
- `mode` — `'modules'` (default, one URL per module) or `'bundle'` (code-split chunks)
- `bundle` — bundled-mode tuning: `minify` (default `true`), `keepNames`, `sourcemap` (`'linked'` by default, or `'inline'` / `'external'` / `'none'`), `external`
- `rootDir` — directory entrypoints resolve against (default `Deno.cwd()`)
- `basePath` — public mount point (default `'/assets'`)
- `configPath` — `deno.json` supplying the import map and compiler options, relative to `rootDir` (`'modules'` mode only)
- `platform` — resolution platform, `'browser'` (default) or `'node'`
- `nodeConditions` — extra Node resolution conditions for `package.json` exports
- `cacheControl` — `Cache-Control` for served modules (default `'no-cache'`)

The returned server has `fetch(request)`, `entryUrl(entrypoint)`, `getHref(entry)`, `getPreloads(entry)`, `moduleUrls()`, `basePath`, and `reload()`.

`getHref` answers the same URL as `entryUrl`, but takes an entry named any way you have it — as configured, as an absolute path, or as a `file:` URL. `getPreloads` returns that entry and every module under it, shallowest first, deduplicated; pass an array to merge several. Both are async.

### Lower-level pieces

`loadModuleGraph` (resolve, load, and transpile everything reachable from the entrypoints, pairing each authored specifier with what Deno resolved it to), `PathRegistry` / `candidatePathFor` (the specifier ↔ URL bijection), and `rewriteImports` (specifier rewriting via `es-module-lexer`) are exported for building your own pipeline.

## Scope

Deliberately not covered: CSS and other non-script assets, fingerprinted URLs, and file watching. Scripts and their transitive graph only. Source maps and minification exist in bundled mode only — module mode serves what Deno transpiled, unchanged. Compilation happens once at startup; call `reload()` after sources change.

Dynamic `import()` is rewritten only when its argument is a string literal — there is nothing to resolve at build time otherwise.

## Related Packages

- [`@remix-run/assets`](https://github.com/remix-run/remix/tree/main/packages/assets) - the Node-oriented original, for `node_modules`-only projects
- [`@deno/loader`](https://jsr.io/@deno/loader) - Deno's resolver, loader, and transpiler, which this delegates to
- [`fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router) - the router you mount it on

## License

See [LICENSE](https://github.com/remix-run/remix/blob/main/LICENSE)
