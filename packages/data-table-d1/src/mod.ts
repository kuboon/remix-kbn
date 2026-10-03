/**
 * Cloudflare D1 database for [`remix/data-table`](https://github.com/remix-run/remix/tree/main/packages/data-table).
 *
 * This entry point is safe to bundle into a Worker: it imports nothing from `node:`. The local
 * SQLite binding and the migration CLI live in `/node`.
 *
 * @module
 */

export { createD1Database, D1BackedDatabase } from './lib/database.ts'
export { createD1HttpClient } from './lib/http.ts'
export type { D1HttpClientOptions } from './lib/http.ts'
export type {
  D1DatabaseBinding,
  D1PreparedStatementBinding,
  D1ResultBinding,
} from './lib/binding.ts'
