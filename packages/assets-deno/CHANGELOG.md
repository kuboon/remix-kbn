# `remix-assets-deno` CHANGELOG

This is the changelog for [`remix-assets-deno`](https://github.com/kuboon/remix-kbn/tree/main/packages/assets-deno). It follows [semantic versioning](https://semver.org/).

## 0.9.0

Follows Remix v3 `3.0.0` (stable).

- `@remix-run/*` ranges move to `^1.0.0`. No code in this package changed.

## 0.8.0

- Moved to the `@remix-kbn` scope: this package is **`@remix-kbn/assets-deno`** from 0.8.0 on. The `remix-` prefix went with the move, because the scope says it now.

  ```diff
  - "@kuboon/remix-assets-deno": "jsr:@kuboon/remix-assets-deno@^0.7.1"
  + "@remix-kbn/assets-deno": "jsr:@remix-kbn/assets-deno@^0.8.0"
  ```

  No code changed. The minor bump is so that no version number exists under both names — 0.8.0 is only ever the new one.

  `@kuboon/remix-assets-deno` stops at 0.7.1, whose only content was the notice that this was coming. JSR cannot unpublish, so every version under the old name keeps resolving exactly as it did; entries below 0.7.1 describe releases made there.

## 0.7.1

- Moving to the `@remix-kbn` scope: this package continues as **`@remix-kbn/assets-deno`**, with the `remix-` prefix dropped because the scope now says it.

  ```diff
  - "@kuboon/remix-assets-deno": "jsr:@kuboon/remix-assets-deno@^0.7.0"
  + "@remix-kbn/assets-deno": "jsr:@remix-kbn/assets-deno"
  ```

  0.7.1 is the announcement and nothing more — its code is 0.7.0's, byte for byte. Nothing breaks if you stay: JSR cannot unpublish, so every version under this name keeps resolving exactly as it does today, and there is no deadline attached to moving.

## 0.7.0

- Added `getScriptEntry(entry)`, which answers with the entry's `href`, its `preloads`, and an `importMap` in one call. `@remix-run/render-middleware` 0.3.0 (the `remix@3.0.0-rc.2` set) asks an asset server for exactly that, having asked for `getHref` and `getPreloads` separately before, so `render({ assets })` no longer type-checks against a server without it.

  ```diff
  - let [href, preloads] = await Promise.all([assets.getHref(id), assets.getPreloads(id)])
  + let { href, preloads, importMap } = await assets.getScriptEntry(id)
  ```

  The import map is always `{ imports: {} }`, and that is not a gap: every specifier is rewritten to a served URL at compile time, so nothing bare is left for a browser to resolve. `getHref` and `getPreloads` stay — a caller that wants only a URL should not have to destructure three things to get it.

## 0.6.0

- An entrypoint may be a glob: `entrypoints: ['islands/*.tsx']` expands at startup, sorted, and fails on a pattern that matches nothing. A file appearing in a directory is then the decision, rather than a list to keep in step with it.

## 0.5.0

- Added `getHref(entry)` and `getPreloads(entry)`, the pair `@remix-run/render-middleware` asked an asset server for at the time, so `render({ assets })` could take this server directly instead of through an adapter. Both accept an entry named as configured, by absolute path, or by `file:` URL — the last being what `clientEntry(import.meta.url, …)` hands a renderer.
- `getPreloads` walks the code-split graph breadth-first, recovered by lexing the emitted chunks, so an entry's shared chunks are preloaded rather than discovered one level at a time.

## 0.4.2

- Internals use `Deno.bundle`'s own types again, called directly rather than through a hand-written interface and a cast. The unstable bundler API will change; with its real types a signature change fails this package's type check, where a structural copy would have accepted a stale option name and silently dropped it.
- `BundleMessage` stays declared here rather than aliased to `Deno.bundle.Message`, for the one place it is public API: `BundleError.messages`. A consumer reading `error.messages[0].text` resolves that type under their own `compilerOptions.lib`, and a pinned `lib` would otherwise force them to add `deno.unstable` to read a diagnostic.
- The package's `lib` pin gains `deno.unstable`, stating outright that this package builds on an unstable Deno API.

Note on what makes `Deno.bundle`'s types visible, since 0.4.0's notes had it wrong: it is the `compilerOptions.lib` pin, not the `--unstable-bundle` flag. Pinning `lib` replaces Deno's default set, which includes the unstable declarations. It also does not reach consumers — Deno type-checks local and workspace dependencies, never `jsr:`/`npm:`/`http:` ones — so a package's use of unstable types is invisible from a JSR install either way. The `--unstable-bundle` opt-in remains required at _runtime_.

## 0.4.1

- Updated `es-module-lexer` to 2.x and `cjs-module-lexer` to 2.x. Both are internal — no exported type mentions them — and the CommonJS interop suite that exercises them (detection, `require()` collection, named-export detection, and a wrapped module actually running) passes unchanged.

## 0.4.0

- Added `mode: 'bundle'`, which compiles every entrypoint in one `Deno.bundle({ codeSplitting: true, format: 'esm' })` call so modules shared between entries are hoisted into shared chunks. This is the bundler's answer to the same duplicated-singleton problem the default per-module-URL mode solves by preserving module identity — one graph in, code-split chunks out, never one compile per entry. Minified by default, with source maps; far fewer requests than one URL per module. Requires Deno's `--unstable-bundle` flag.
- Added `bundle` options (`minify`, `keepNames`, `sourcemap`, `external`) and the `BundleError` thrown when the bundler is unavailable or reports diagnostics.
- `configPath` is documented as `'modules'`-mode only: `Deno.bundle` resolves the import map and `compilerOptions` from the config the process started with, and offers no way to override it.
- Served artifacts now carry a `Content-Type`, so bundled-mode source maps are served as JSON rather than JavaScript.

## 0.3.0

- CommonJS dependencies are now served instead of silently emitting a body no browser can run. A CJS module is wrapped as an ES module — its `require()` calls with literal specifiers hoisted to real imports and resolved under Node's require semantics, its body run with `module`, `exports`, `require`, `__filename`, `__dirname`, and `this` bound to `module.exports`, and its exports re-published as a default export plus one named export per name `cjs-module-lexer` detects.
- **Breaking:** a module whose source is `.cjs` or `.cts` is now served under a `.js` URL. The served body is an ES module, so a URL still claiming `.cjs` advertises a format the content does not have, and a client that trusts the extension rejects it.
- **Breaking:** `LoadedModule` gains `commonJs` and `namedExports`.
- What CommonJS interop does not cover: `require(someVariable)` throws at runtime rather than resolving, Node globals such as `process` and `Buffer` are not shimmed, and a CJS import cycle resolves in ESM order.

## 0.2.0

- Resolution, loading, and TypeScript/JSX transpilation now come from [`@deno/loader`](https://jsr.io/@deno/loader) instead of a `deno info --json` subprocess. Everything runs in-process, so **`--allow-run` is no longer required** — `--allow-read`, `--allow-env`, and `--allow-net` are enough. The `@deno/emit` dependency is gone too, since the loader returns modules already transpiled, and npm no longer needs a separate `createRequire` walk: one resolver now handles JSR, npm, import-map, and relative specifiers alike.
- Only the runtime graph is served. Type-only modules, which `deno info` reported and which were previously emitted as empty JavaScript, are no longer served at all.
- **Breaking:** `AssetServerOptions.importMap` is removed — pass the config file as `configPath` instead. Because `@deno/loader` reads it as a Deno config, a bare `"@std/encoding": "jsr:@std/encoding@^1"` now covers subpaths, so the trailing-slash entry a standalone import map needed is no longer necessary.
- **Breaking:** `AssetServerOptions.compilerOptions` and the `AssetCompilerOptions` type are removed. The config file's own `compilerOptions` (`jsx`, `jsxImportSource`, …) are honored automatically.
- **Breaking:** `AssetServerOptions` gains `platform` (`'browser'` by default) and `nodeConditions`.
- **Breaking:** the graph API is reshaped around the loader. `graphFromInfo` and the `GraphDependency` / `GraphModule` / `NpmPackage` types are removed; `ModuleGraph`, `LoadModuleGraphOptions`, and `loadModuleGraph`'s result change accordingly, and modules now carry their transpiled `code`. A new `LoadedModule` type is exported.
- **Breaking:** `candidatePathFor` no longer takes `npmRoots`. Files under `node_modules` are named from their last `node_modules` segment instead.

## 0.1.0

- Initial release of `@kuboon/remix-assets-deno`, an on-demand asset server for `remix/fetch-router` that resolves imports through Deno rather than `node_modules`, so JSR specifiers, npm specifiers, and `deno.json` import maps all work.
- `createAssetServer(options)` compiles the entrypoints and everything they import into individually addressable ES modules and serves them with `ETag` revalidation. Because each resolved specifier gets exactly one URL, a module shared by several client entries is evaluated once by the browser — module-level singletons stay singletons without a `globalThis` anchor.
- Lower-level pieces are exported for custom pipelines: `loadModuleGraph` / `graphFromInfo`, `PathRegistry` / `candidatePathFor`, and `rewriteImports`.
