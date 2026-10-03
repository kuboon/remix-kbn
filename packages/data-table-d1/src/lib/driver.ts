import type {
  DatabaseCapabilities,
  DatabaseDriver,
  DataManipulationOperation,
  DataManipulationRequest,
  DataManipulationResult,
  SqlStatement,
  TableRef,
  TransactionToken,
} from '@remix-run/data-table'
import { getTablePrimaryKey } from '@remix-run/data-table'

import type { D1DatabaseBinding, D1PreparedStatementBinding, D1ResultBinding } from './binding.ts'
import { compileSqliteOperation } from './sql-compiler.ts'
import { splitSqlStatements } from './split-sql.ts'

type OperationKind = DataManipulationOperation['kind']

/** Statements a transaction has queued for its commit. */
type PendingTransaction = {
  statements: D1PreparedStatementBinding[]
}

/**
 * `DatabaseDriver` implementation for Cloudflare D1.
 *
 * D1 speaks SQLite but has no interactive transactions: there is no connection to hold a `BEGIN`
 * open on. What it does have is `batch()`, which runs a list of statements as one SQL transaction.
 * So a transaction here is a queue — writes are collected and sent as a single `batch()` on
 * commit, and dropped on rollback. That makes a transaction atomic, at the price of three rules:
 *
 * - A write inside a transaction has not run yet, so it cannot `returning` anything. Use
 *   `updateMany()` / `create()` (without `returnRow`) inside a transaction rather than `update()`,
 *   which always asks for the updated row. Its `affectedRows` is reported as `0`.
 * - A read inside a transaction runs at once against committed data. That is only the truth before
 *   the transaction has queued a write, so a read after one throws instead of answering stale.
 * - There are no savepoints, so a nested `transaction()` throws.
 *
 * A script ({@link executeScript}) is cut into statements and batched too, so a migration's
 * `up.sql` and its journal row commit together or not at all.
 *
 * This class is internal: applications construct a {@link D1BackedDatabase} instead.
 */
export class D1Driver implements DatabaseDriver<'sqlite'> {
  /** The SQL dialect identifier reported by this driver. */
  readonly dialect = 'sqlite'

  /** Feature flags describing the sqlite behaviors supported by this driver. */
  readonly capabilities: DatabaseCapabilities

  #binding: D1DatabaseBinding
  #transactions = new Map<string, PendingTransaction>()
  #transactionCounter = 0

  constructor(binding: D1DatabaseBinding) {
    this.#binding = binding
    this.capabilities = {
      returning: true,
      savepoints: false,
      upsert: true,
      transactionalDdl: true,
      migrationLock: false,
    }
  }

  /**
   * Compiles a data-manipulation operation to sqlite SQL statements.
   * @param operation Operation to compile.
   * @returns Compiled SQL statements.
   */
  compileSql(operation: DataManipulationOperation): SqlStatement[] {
    let compiled = compileSqliteOperation(operation)
    return [{ text: compiled.text, values: compiled.values }]
  }

  /**
   * Executes a data-manipulation request, or queues it when it is a write inside a transaction.
   * @param request Request to execute.
   * @returns Execution result.
   */
  async execute(request: DataManipulationRequest): Promise<DataManipulationResult> {
    let { operation } = request

    if (operation.kind === 'insertMany' && operation.values.length === 0) {
      return {
        affectedRows: 0,
        insertId: undefined,
        rows: operation.returning ? [] : undefined,
      }
    }

    let compiled = this.compileSql(operation)[0]
    let statement = this.#prepare(compiled.text, compiled.values)

    if (request.transaction) {
      let transaction = this.#transaction(request.transaction)

      if (!isReadOperation(operation)) {
        if ('returning' in operation && operation.returning) {
          throw new Error(
            'D1 cannot return rows from a write inside a transaction: the write is queued and runs ' +
              'when the transaction commits. Write without returning (for example updateMany() ' +
              'instead of update()), or move the write out of the transaction.',
          )
        }
        transaction.statements.push(statement)
        return { affectedRows: undefined, insertId: undefined, rows: undefined }
      }

      assertNothingQueued(transaction)
    }

    let result = await statement.all()
    let rows = normalizeRows(result.results)

    if (operation.kind === 'count' || operation.kind === 'exists') {
      rows = normalizeCountRows(rows)
    }

    return {
      rows,
      affectedRows: normalizeAffectedRows(operation.kind, result, rows),
      insertId: normalizeInsertId(operation, result, rows),
    }
  }

  /**
   * Executes a multi-statement SQL script as one `batch()`, or queues it inside a transaction.
   * @param sql SQL script to execute.
   * @param transaction Optional transaction token.
   * @returns A promise that resolves once execution completes.
   */
  async executeScript(sql: string, transaction?: TransactionToken): Promise<void> {
    let statements = splitSqlStatements(sql).map((text) => this.#binding.prepare(text))

    if (transaction) {
      this.#transaction(transaction).statements.push(...statements)
      return
    }

    if (statements.length > 0) {
      await this.#binding.batch(statements)
    }
  }

  /**
   * Checks whether a table exists.
   * @param table Table reference to inspect.
   * @param transaction Optional transaction token.
   * @returns `true` when the table exists.
   */
  async hasTable(table: TableRef, transaction?: TransactionToken): Promise<boolean> {
    if (transaction) assertNothingQueued(this.#transaction(transaction))
    let masterTable = table.schema
      ? quoteIdentifier(table.schema) + '.sqlite_master'
      : 'sqlite_master'
    let result = await this.#prepare(
      'select 1 from ' + masterTable + ' where type = ? and name = ? limit 1',
      ['table', table.name],
    ).all()
    return result.results.length > 0
  }

  /**
   * Checks whether a column exists.
   * @param table Table reference to inspect.
   * @param column Column name to look up.
   * @param transaction Optional transaction token.
   * @returns `true` when the column exists.
   */
  async hasColumn(
    table: TableRef,
    column: string,
    transaction?: TransactionToken,
  ): Promise<boolean> {
    if (transaction) assertNothingQueued(this.#transaction(transaction))
    let schemaPrefix = table.schema ? quoteIdentifier(table.schema) + '.' : ''
    let result = await this.#prepare(
      'pragma ' + schemaPrefix + 'table_info(' + quoteIdentifier(table.name) + ')',
      [],
    ).all()
    return normalizeRows(result.results).some((row) => row.name === column)
  }

  /**
   * Opens a transaction: an empty queue that commit sends as one `batch()`.
   *
   * Transaction options are accepted and ignored — a batch is always serializable, and a
   * read-only transaction simply never queues anything.
   * @returns Transaction token.
   */
  async beginTransaction(): Promise<TransactionToken> {
    this.#transactionCounter += 1
    let token = { id: 'tx_' + String(this.#transactionCounter) }
    this.#transactions.set(token.id, { statements: [] })
    return token
  }

  /**
   * Commits a transaction by running its queued writes as one `batch()`.
   * @param token Transaction token to commit.
   * @returns A promise that resolves when the batch has committed.
   */
  async commitTransaction(token: TransactionToken): Promise<void> {
    let transaction = this.#transaction(token)

    try {
      if (transaction.statements.length > 0) {
        await this.#binding.batch(transaction.statements)
      }
    } finally {
      this.#transactions.delete(token.id)
    }
  }

  /**
   * Rolls back a transaction. Nothing has reached the database yet, so this drops the queue.
   * @param token Transaction token to roll back.
   */
  async rollbackTransaction(token: TransactionToken): Promise<void> {
    this.#transaction(token)
    this.#transactions.delete(token.id)
  }

  /** D1 has no savepoints. `capabilities.savepoints` is `false`, so this is never reached. */
  async createSavepoint(): Promise<void> {
    throw new Error('D1 does not support savepoints')
  }

  /** D1 has no savepoints. `capabilities.savepoints` is `false`, so this is never reached. */
  async rollbackToSavepoint(): Promise<void> {
    throw new Error('D1 does not support savepoints')
  }

  /** D1 has no savepoints. `capabilities.savepoints` is `false`, so this is never reached. */
  async releaseSavepoint(): Promise<void> {
    throw new Error('D1 does not support savepoints')
  }

  /**
   * Drops every user-defined trigger, view, index, and table.
   *
   * A D1 database cannot be deleted and recreated from inside it, so emptying the schema stands in
   * for that: `Database.reset()` can migrate from scratch afterwards. D1's own `_cf_*` tables stay.
   * The drops run as one batch with foreign key checks deferred to its commit, by which point every
   * table that could be referenced is gone.
   * @returns A promise that resolves once the schema is empty.
   */
  async wipe(): Promise<void> {
    // `sqlite_autoindex_*` and friends are dropped with their tables and cannot be dropped directly.
    let objects = await this.#prepare(
      "select type, name from sqlite_master where type in ('trigger', 'view', 'index', 'table')" +
        " and name not like 'sqlite\\_%' escape '\\' and name not like '\\_cf\\_%' escape '\\'" +
        " order by case type when 'trigger' then 0 when 'view' then 1 when 'index' then 2 else 3 end",
      [],
    ).all()
    let rows = normalizeRows(objects.results)

    if (rows.length === 0) {
      return
    }

    await this.#binding.batch([
      this.#binding.prepare('pragma defer_foreign_keys = on'),
      ...rows.map((row) =>
        this.#binding.prepare(
          'drop ' + String(row.type) + ' if exists ' + quoteIdentifier(String(row.name)),
        )
      ),
    ])
  }

  /**
   * Releases handles owned by this driver. The binding belongs to the Worker, so this is a no-op,
   * safe to call repeatedly.
   */
  close(): void {}

  #prepare(sql: string, values: unknown[]): D1PreparedStatementBinding {
    let statement = this.#binding.prepare(sql)
    return values.length === 0 ? statement : statement.bind(...normalizeStatementValues(values))
  }

  #transaction(token: TransactionToken): PendingTransaction {
    let transaction = this.#transactions.get(token.id)

    if (!transaction) {
      throw new Error('Unknown transaction token: ' + token.id)
    }

    return transaction
  }
}

function assertNothingQueued(transaction: PendingTransaction): void {
  if (transaction.statements.length > 0) {
    throw new Error(
      'D1 cannot read inside a transaction after it has queued a write: the write runs when the ' +
        'transaction commits, so the read would not see it. Read before the first write.',
    )
  }
}

function isReadOperation(operation: DataManipulationOperation): boolean {
  if (operation.kind === 'select' || operation.kind === 'count' || operation.kind === 'exists') {
    return true
  }
  if (operation.kind === 'raw') {
    return /^\s*(select|pragma|explain|values|with)\b/i.test(operation.sql.text)
  }
  return false
}

function normalizeRows(rows: unknown[]): Record<string, unknown>[] {
  return rows.map((row) => {
    if (typeof row !== 'object' || row === null) {
      return {}
    }

    return { ...(row as Record<string, unknown>) }
  })
}

/**
 * Maps values to what D1 binds: `undefined` becomes `null`, booleans become `1` / `0`, and a
 * `bigint` that fits becomes a number. D1 rejects the first two outright.
 */
function normalizeStatementValues(values: unknown[]): unknown[] {
  return values.map((value) => {
    if (value === undefined) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    if (typeof value === 'bigint' && Number.isSafeInteger(Number(value))) return Number(value)
    return value
  })
}

function normalizeCountRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    let count = row.count

    if (typeof count === 'string' || typeof count === 'bigint') {
      let numeric = Number(count)

      if (!Number.isNaN(numeric)) {
        return { ...row, count: numeric }
      }
    }

    return row
  })
}

function normalizeAffectedRows(
  kind: OperationKind,
  result: D1ResultBinding,
  rows: Record<string, unknown>[],
): number | undefined {
  if (kind === 'select' || kind === 'count' || kind === 'exists') {
    return undefined
  }

  if (isWriteOperationKind(kind) && rows.length > 0) {
    return rows.length
  }

  if (kind === 'raw' && rows.length > 0) {
    return undefined
  }

  return Number(result.meta.changes ?? 0)
}

function normalizeInsertId(
  operation: DataManipulationOperation,
  result: D1ResultBinding,
  rows: Record<string, unknown>[],
): unknown {
  if (
    operation.kind !== 'insert' && operation.kind !== 'insertMany' && operation.kind !== 'upsert'
  ) {
    return undefined
  }

  let primaryKey = getTablePrimaryKey(operation.table)

  if (primaryKey.length !== 1) {
    return undefined
  }

  if (rows.length > 0) {
    let row = rows[rows.length - 1]
    return row ? row[primaryKey[0]] : undefined
  }

  return result.meta.last_row_id
}

function quoteIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"'
}

function isWriteOperationKind(kind: OperationKind): boolean {
  return (
    kind === 'insert' ||
    kind === 'insertMany' ||
    kind === 'update' ||
    kind === 'delete' ||
    kind === 'upsert'
  )
}
