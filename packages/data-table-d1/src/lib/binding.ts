/**
 * The part of Cloudflare's `D1Database` binding this package uses.
 *
 * Declared structurally rather than imported from `@cloudflare/workers-types`, so the package
 * carries no type dependency and the Worker's own `env.DB` is accepted as is. The same surface is
 * implemented over D1's REST API ({@link createD1HttpClient}) and over a local SQLite file
 * (`createLocalD1()` from `/node`), so migrations and tests can reach a database without a Worker.
 */
export interface D1DatabaseBinding {
  /** Prepares a single SQL statement. */
  prepare(query: string): D1PreparedStatementBinding
  /**
   * Runs statements in order as one SQL transaction: either every statement commits or none does.
   */
  batch(statements: D1PreparedStatementBinding[]): Promise<D1ResultBinding[]>
}

/** The part of Cloudflare's `D1PreparedStatement` this package uses. */
export interface D1PreparedStatementBinding {
  /** Binds positional (`?`) parameters, returning a new statement. */
  bind(...values: unknown[]): D1PreparedStatementBinding
  /** Runs the statement and returns every row plus metadata. */
  all(): Promise<D1ResultBinding>
}

/** The part of Cloudflare's `D1Result` this package reads. */
export interface D1ResultBinding {
  results: unknown[]
  meta: {
    changes?: number
    last_row_id?: number
  }
}
