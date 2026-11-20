import type {
  ColumnDefinition,
  DatabaseCapabilities,
  DatabaseDriver,
  DataManipulationOperation,
  DataManipulationRequest,
  DataManipulationResult,
  SqlStatement,
  TableRef,
  TransactionOptions,
  TransactionToken,
} from '@remix-run/data-table'
import { getTablePrimaryKey } from '@remix-run/data-table'
import type {
  Client as TursoClient,
  InValue,
  ResultSet,
  Transaction as TursoTransaction,
  TransactionMode,
} from '@libsql/client'

import { compileSqliteOperation } from './sql-compiler.ts'

/**
 * Minimal async surface shared by the libSQL `Client` and `Transaction` types.
 *
 * Both accept `{ sql, args }` statements and multi-statement scripts, which is all the driver
 * needs to route work to either the top-level client or an open interactive transaction.
 */
type TursoExecutor = {
  execute(statement: { sql: string; args: InValue[] }): Promise<ResultSet>
  executeMultiple(sql: string): Promise<void>
}

/**
 * `DatabaseDriver` implementation for Turso / libSQL clients.
 *
 * Turso is SQLite over an async client, so this driver speaks the SQLite dialect while awaiting
 * every client call. Use it when `data-table-sqlite`'s synchronous client surface is not available,
 * such as with `@libsql/client` against a remote Turso database or an embedded replica.
 *
 * This class is internal: applications construct a {@link TursoDatabase} instead, which owns a
 * driver and exposes the shared `data-table` query, persistence, and migration APIs.
 */
export class TursoDriver implements DatabaseDriver<'sqlite'> {
  /**
   * The SQL dialect identifier reported by this driver.
   */
  readonly dialect = 'sqlite'

  /**
   * Feature flags describing the sqlite behaviors supported by this driver.
   */
  readonly capabilities: DatabaseCapabilities

  #client: TursoClient
  #transactions = new Map<string, TursoTransaction>()
  #transactionCounter = 0

  constructor(client: TursoClient) {
    this.#client = client
    this.capabilities = {
      returning: true,
      savepoints: true,
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
   * Decodes values SQLite stores in a different form: JSON text, integer booleans, and
   * timestamp text. `Database` calls this for table query and `returning` rows, so rows have the
   * same JavaScript shape as on the first-party adapters; `db.exec()` results are left as-is.
   * @param value Value read from the database.
   * @param column Definition of the column the value was read from.
   * @returns The decoded value.
   */
  decodeValue(value: unknown, column: ColumnDefinition): unknown {
    if (column.type === 'boolean' && (typeof value === 'number' || typeof value === 'bigint')) {
      return Number(value) !== 0
    }

    if (column.type === 'json' && typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        // Leave text written before JSON columns were serialized as it was stored.
        return value
      }
    }

    if (column.type === 'timestamp' && typeof value === 'string') {
      // Only decode text in the form this driver binds, so a Date read back binds as the same
      // text and still matches the stored value in filters and key lookups.
      let date = new Date(value.replace(' ', 'T') + 'Z')
      return !Number.isNaN(date.getTime()) && formatTimestamp(date) === value ? date : value
    }

    return value
  }

  /**
   * Executes a turso data-manipulation request.
   * @param request Request to execute.
   * @returns Execution result.
   */
  async execute(request: DataManipulationRequest): Promise<DataManipulationResult> {
    if (request.operation.kind === 'insertMany' && request.operation.values.length === 0) {
      return {
        affectedRows: 0,
        insertId: undefined,
        rows: request.operation.returning ? [] : undefined,
      }
    }

    let executor = this.#resolveExecutor(request.transaction)
    let statement = this.compileSql(request.operation)[0]
    let resultSet = await executor.execute({
      sql: statement.text,
      args: normalizeStatementValues(statement.values),
    })

    let rows = normalizeRows(resultSet.rows)

    if (request.operation.kind === 'count' || request.operation.kind === 'exists') {
      rows = normalizeCountRows(rows)
    }

    return {
      rows,
      affectedRows: normalizeAffectedRows(request.operation.kind, resultSet, rows),
      insertId: normalizeInsertId(request.operation.kind, request.operation, resultSet, rows),
    }
  }

  /**
   * Executes a multi-statement sqlite SQL script.
   * @param sql SQL script to execute.
   * @param transaction Optional transaction token (asserted when present).
   * @returns A promise that resolves once execution completes.
   */
  async executeScript(sql: string, transaction?: TransactionToken): Promise<void> {
    let executor = this.#resolveExecutor(transaction)
    await executor.executeMultiple(sql)
  }

  /**
   * Checks whether a table exists in sqlite.
   * @param table Table reference to inspect.
   * @param transaction Optional transaction token.
   * @returns `true` when the table exists.
   */
  async hasTable(table: TableRef, transaction?: TransactionToken): Promise<boolean> {
    let executor = this.#resolveExecutor(transaction)
    let masterTable = table.schema
      ? quoteIdentifier(table.schema) + '.sqlite_master'
      : 'sqlite_master'
    let resultSet = await executor.execute({
      sql: 'select 1 from ' + masterTable + ' where type = ? and name = ? limit 1',
      args: ['table', table.name],
    })
    return resultSet.rows.length > 0
  }

  /**
   * Checks whether a column exists in sqlite.
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
    let executor = this.#resolveExecutor(transaction)
    let schemaPrefix = table.schema ? quoteIdentifier(table.schema) + '.' : ''
    let resultSet = await executor.execute({
      sql: 'pragma ' + schemaPrefix + 'table_info(' + quoteIdentifier(table.name) + ')',
      args: [],
    })

    return resultSet.rows.some((row) => row.name === column)
  }

  /**
   * Starts a turso interactive transaction.
   *
   * `readOnly` transactions open in libSQL's `read` mode; everything else opens in `write` mode so
   * the transaction can both read and write. Other {@link TransactionOptions} are accepted as
   * best-effort hints and ignored where libSQL has no equivalent.
   * @param options Transaction options.
   * @returns Transaction token.
   */
  async beginTransaction(options?: TransactionOptions): Promise<TransactionToken> {
    let mode: TransactionMode = options?.readOnly ? 'read' : 'write'
    let transaction = await this.#client.transaction(mode)

    this.#transactionCounter += 1
    let token = { id: 'tx_' + String(this.#transactionCounter) }
    this.#transactions.set(token.id, transaction)

    return token
  }

  /**
   * Commits an open turso transaction.
   * @param token Transaction token to commit.
   * @returns A promise that resolves when the transaction is committed.
   */
  async commitTransaction(token: TransactionToken): Promise<void> {
    let transaction = this.#transaction(token)

    try {
      await transaction.commit()
    } finally {
      this.#transactions.delete(token.id)
    }
  }

  /**
   * Rolls back an open turso transaction.
   * @param token Transaction token to roll back.
   * @returns A promise that resolves when the transaction is rolled back.
   */
  async rollbackTransaction(token: TransactionToken): Promise<void> {
    let transaction = this.#transaction(token)

    try {
      await transaction.rollback()
    } finally {
      this.#transactions.delete(token.id)
    }
  }

  /**
   * Creates a savepoint in an open turso transaction.
   * @param token Transaction token to use.
   * @param name Savepoint name.
   * @returns A promise that resolves when the savepoint is created.
   */
  async createSavepoint(token: TransactionToken, name: string): Promise<void> {
    let transaction = this.#transaction(token)
    await transaction.execute({ sql: 'savepoint ' + quoteIdentifier(name), args: [] })
  }

  /**
   * Rolls back to a savepoint in an open turso transaction.
   * @param token Transaction token to use.
   * @param name Savepoint name.
   * @returns A promise that resolves when the rollback completes.
   */
  async rollbackToSavepoint(token: TransactionToken, name: string): Promise<void> {
    let transaction = this.#transaction(token)
    await transaction.execute({ sql: 'rollback to savepoint ' + quoteIdentifier(name), args: [] })
  }

  /**
   * Releases a savepoint in an open turso transaction.
   * @param token Transaction token to use.
   * @param name Savepoint name.
   * @returns A promise that resolves when the savepoint is released.
   */
  async releaseSavepoint(token: TransactionToken, name: string): Promise<void> {
    let transaction = this.#transaction(token)
    await transaction.execute({ sql: 'release savepoint ' + quoteIdentifier(name), args: [] })
  }

  /**
   * Drops every user-defined object in the connected database.
   *
   * The libSQL client is supplied by the caller and may point at a remote Turso database, so there
   * is no file to unlink and no database to recreate the way a config-backed driver would. Emptying
   * the schema reaches the same end state: `Database.reset()` can migrate from scratch afterwards.
   *
   * Foreign key enforcement is suspended for the duration and restored to whatever the connection
   * reported beforehand. Everything runs as a single multi-statement script so it stays on one
   * connection — over libSQL's HTTP transport, `pragma` state does not survive between requests.
   * @returns A promise that resolves once the schema is empty.
   */
  async wipe(): Promise<void> {
    // `sqlite_autoindex_*` and friends are dropped with their tables and cannot be dropped directly.
    let objects = await this.#client.execute({
      sql:
        "select type, name from sqlite_master where type in ('trigger', 'view', 'index', 'table')" +
        " and name not like 'sqlite\\_%' escape '\\'" +
        " order by case type when 'trigger' then 0 when 'view' then 1 when 'index' then 2 else 3 end",
      args: [],
    })

    if (objects.rows.length === 0) {
      return
    }

    let foreignKeys = await this.#client.execute({ sql: 'pragma foreign_keys', args: [] })
    let restore = foreignKeys.rows[0]?.foreign_keys ? 'on' : 'off'

    let drops = objects.rows.map((row) =>
      'drop ' + String(row.type) + ' if exists ' + quoteIdentifier(String(row.name)) + ';'
    )

    await this.#client.executeMultiple(
      ['pragma foreign_keys = off;', ...drops, 'pragma foreign_keys = ' + restore + ';'].join('\n'),
    )
  }

  /**
   * Releases handles owned by this driver.
   *
   * The libSQL client is caller-owned — this driver never opens one — so there is nothing to
   * release and this is a no-op, safe to call repeatedly. Close the client yourself when the
   * application shuts down.
   */
  close(): void {}

  #resolveExecutor(token: TransactionToken | undefined): TursoExecutor {
    if (!token) {
      return this.#client
    }

    return this.#transaction(token)
  }

  #transaction(token: TransactionToken): TursoTransaction {
    let transaction = this.#transactions.get(token.id)

    if (!transaction) {
      throw new Error('Unknown transaction token: ' + token.id)
    }

    return transaction
  }
}

function normalizeRows(rows: unknown[]): Record<string, unknown>[] {
  return rows.map((row) => {
    if (typeof row !== 'object' || row === null) {
      return {}
    }

    return { ...(row as Record<string, unknown>) }
  })
}

function normalizeStatementValues(values: unknown[]): InValue[] {
  return values.map((value) => {
    if (value === undefined) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    if (value !== null && typeof value === 'object') return normalizeObjectValue(value)
    return value
  }) as InValue[]
}

/**
 * Binds a `Date` as UTC text in SQLite's own `current_timestamp` format, and refuses any other
 * object: every parameter binds as exactly one value, so JSON must already be serialized.
 */
function normalizeObjectValue(value: object): unknown {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('SQLite Date parameters must be valid dates')
    }
    return formatTimestamp(value)
  }
  if (!ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
    throw new TypeError('SQLite object parameters must be Date or typed array instances')
  }
  return value
}

// Match SQLite's own UTC `current_timestamp` format so stored values compare and sort together.
// Whole seconds omit `.000`, which would otherwise sort after the same second.
function formatTimestamp(date: Date): string {
  let text = date.toISOString().replace('T', ' ').replace('Z', '')
  return date.getUTCMilliseconds() === 0 ? text.slice(0, -4) : text
}

function normalizeCountRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    let count = row.count

    if (typeof count === 'string') {
      let numeric = Number(count)

      if (!Number.isNaN(numeric)) {
        return {
          ...row,
          count: numeric,
        }
      }
    }

    if (typeof count === 'bigint') {
      return {
        ...row,
        count: Number(count),
      }
    }

    return row
  })
}

function normalizeAffectedRows(
  kind: DataManipulationRequest['operation']['kind'],
  resultSet: ResultSet,
  rows: Record<string, unknown>[],
): number | undefined {
  if (kind === 'select' || kind === 'count' || kind === 'exists') {
    return undefined
  }

  // libSQL reports `rowsAffected` as `0` for `returning` writes, so fall back to the returned row
  // count whenever the operation produced rows.
  if (isWriteOperationKind(kind) && rows.length > 0) {
    return rows.length
  }

  if (kind === 'raw' && rows.length > 0) {
    return undefined
  }

  return Number(resultSet.rowsAffected)
}

function normalizeInsertId(
  kind: DataManipulationRequest['operation']['kind'],
  operation: DataManipulationRequest['operation'],
  resultSet: ResultSet,
  rows: Record<string, unknown>[],
): unknown {
  if (!isInsertOperationKind(kind) || !isInsertOperation(operation)) {
    return undefined
  }

  let primaryKey = getTablePrimaryKey(operation.table)

  if (primaryKey.length !== 1) {
    return undefined
  }

  if (rows.length > 0) {
    let key = primaryKey[0]
    let row = rows[rows.length - 1]
    return row ? row[key] : undefined
  }

  return resultSet.lastInsertRowid === undefined ? undefined : Number(resultSet.lastInsertRowid)
}

function quoteIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"'
}

function isWriteOperationKind(kind: DataManipulationRequest['operation']['kind']): boolean {
  return (
    kind === 'insert' ||
    kind === 'insertMany' ||
    kind === 'update' ||
    kind === 'delete' ||
    kind === 'upsert'
  )
}

function isInsertOperationKind(kind: DataManipulationRequest['operation']['kind']): boolean {
  return kind === 'insert' || kind === 'insertMany' || kind === 'upsert'
}

function isInsertOperation(
  operation: DataManipulationRequest['operation'],
): operation is Extract<
  DataManipulationRequest['operation'],
  { kind: 'insert' | 'insertMany' | 'upsert' }
> {
  return (
    operation.kind === 'insert' || operation.kind === 'insertMany' || operation.kind === 'upsert'
  )
}
