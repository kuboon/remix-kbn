import { Database, type DatabaseOptions } from '@remix-run/data-table'

import type { D1DatabaseBinding } from './binding.ts'
import { D1Driver } from './driver.ts'

/**
 * A {@link Database} backed by a Cloudflare D1 binding.
 *
 * Transactions are atomic but queued: writes inside `transaction()` run as one D1 `batch()` when
 * the callback returns, so they cannot return rows, and reads after a queued write throw. See the
 * README's "Transactions" section.
 *
 * The binding belongs to the Worker, so `close()` is a no-op.
 */
export class D1BackedDatabase extends Database<'sqlite'> {
  /**
   * Creates a D1-backed database.
   * @param binding A D1 binding (`env.DB`), or anything with the same `prepare` / `batch` surface.
   * @param options Database runtime options.
   */
  constructor(binding: D1DatabaseBinding, options?: DatabaseOptions) {
    super(new D1Driver(binding), options)
  }
}

/**
 * Creates a D1-backed database.
 * @param binding A D1 binding (`env.DB`), or anything with the same `prepare` / `batch` surface,
 *   such as {@link createD1HttpClient} or `createLocalD1()` from `/node`.
 * @param options Database runtime options.
 * @returns A D1-backed database.
 * @example
 * ```ts
 * import { createD1Database } from '@remix-kbn/data-table-d1'
 *
 * export default {
 *   async fetch(request: Request, env: { DB: D1Database }) {
 *     let db = createD1Database(env.DB)
 *     // …
 *   },
 * }
 * ```
 */
export function createD1Database(
  binding: D1DatabaseBinding,
  options?: DatabaseOptions,
): D1BackedDatabase {
  return new D1BackedDatabase(binding, options)
}
