import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import type { D1DatabaseBinding, D1PreparedStatementBinding, D1ResultBinding } from './binding.ts'

/** A D1 binding over a local SQLite file, with a `close()` the binding does not have. */
export interface LocalD1 extends D1DatabaseBinding {
  /** Closes the SQLite file. */
  close(): void
}

/**
 * A D1 binding over a local SQLite file, opened with `node:sqlite` (Node 22.5+, Deno, Bun).
 *
 * It answers like D1 does, so code that runs against `env.DB` in a Worker runs here unchanged:
 * `batch()` is one SQL transaction and foreign keys are enforced. Use it for development and tests
 * outside `wrangler dev`, and for running migrations against a local database.
 *
 * The directory holding the file is created when missing. `':memory:'` opens a throwaway database.
 *
 * @param filename Path to the SQLite file.
 * @returns A binding accepted by `createD1Database()`; close it when done.
 */
export async function createLocalD1(filename: string): Promise<LocalD1> {
  if (filename !== ':memory:') {
    let directory = dirname(filename)
    if (directory !== '' && directory !== '.') await mkdir(directory, { recursive: true })
  }

  let db = new DatabaseSync(filename)
  let totalChanges = db.prepare('select total_changes() as changes')
  let lastRowId = db.prepare('select last_insert_rowid() as id')

  function run(sql: string, params: unknown[]): D1ResultBinding {
    let before = Number(totalChanges.get()?.changes ?? 0)
    let statement = db.prepare(sql)
    let values = params as SQLInputValue[]
    let results = statement.columns().length > 0
      ? statement.all(...values).map((row) => ({ ...row }))
      : (statement.run(...values), [])
    let changes = Number(totalChanges.get()?.changes ?? 0) - before
    return {
      results,
      meta: {
        changes,
        last_row_id: changes > 0 ? Number(lastRowId.get()?.id ?? 0) : 0,
      },
    }
  }

  function statement(sql: string, params: unknown[]): LocalStatement {
    return {
      sql,
      params,
      bind(...values: unknown[]) {
        return statement(sql, values)
      },
      async all() {
        return run(sql, params)
      },
    }
  }

  return {
    prepare(sql: string) {
      return statement(sql, [])
    },
    async batch(statements: D1PreparedStatementBinding[]) {
      let queries = statements.map(toLocal)
      db.exec('begin')
      try {
        let results = queries.map((query) => run(query.sql, query.params))
        db.exec('commit')
        return results
      } catch (error) {
        db.exec('rollback')
        throw error
      }
    },
    close() {
      db.close()
    },
  }
}

interface LocalStatement extends D1PreparedStatementBinding {
  sql: string
  params: unknown[]
}

function toLocal(statement: D1PreparedStatementBinding): LocalStatement {
  let local = statement as Partial<LocalStatement>
  if (typeof local.sql !== 'string' || !Array.isArray(local.params)) {
    throw new Error('createLocalD1().batch() only accepts statements from its own prepare()')
  }
  return local as LocalStatement
}
