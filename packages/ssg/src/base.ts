/**
 * The deploy prefix, on its own.
 *
 * A sub-path deploy touches every part of a site at once — every URL carries the prefix, and no
 * output path does — so both halves of a site need the same rule for turning a deploy URL into
 * that prefix. `@remix-kbn/ssg/site` exports these alongside everything else it has, and that is
 * the problem this entry point exists to solve: `site` is the Deno half of the framework — the
 * bundler, the file trees, the loader — so a module the browser is given cannot import from it
 * without pulling `node:fs`, `node:path` and a WebAssembly loader into the bundle.
 *
 * A site hits that the moment anything in a browser entrypoint imports the module its routes are
 * built from, which is what client-side routing is: one route table, matched on both sides. So the
 * three functions that a browser has any business calling live here too, and here they cost it
 * nothing. There is nothing to import — they are string handling and no more.
 *
 * ```ts
 * import { normalizeBase } from '@remix-kbn/ssg/base'
 *
 * export const base = normalizeBase(Deno.env.get('BASE_URL'))
 * ```
 *
 * `@remix-kbn/ssg/site` re-exports all three, unchanged, so nothing has to move.
 *
 * @module
 */

export { joinBase, normalizeBase, stripBase } from './lib/site/base.ts'
