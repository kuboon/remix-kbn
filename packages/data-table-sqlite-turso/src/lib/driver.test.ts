import * as assert from '@remix-run/assert'
import { describe, it } from '@std/testing/bdd'
import { column, eq, rawSql, sql, table } from '@remix-run/data-table'
import { createClient } from '@libsql/client'

import { createTursoDatabase } from './database.ts'
import { TursoDriver } from './driver.ts'

const accounts = table({
  name: 'accounts',
  columns: {
    id: column.integer(),
    email: column.text(),
    status: column.text(),
  },
})

const accountProjects = table({
  name: 'account_projects',
  columns: {
    account_id: column.integer(),
    project_id: column.integer(),
    email: column.text(),
  },
  primaryKey: ['account_id', 'project_id'],
})

type ResultSetOverrides = {
  rows?: unknown[]
  rowsAffected?: number
  lastInsertRowid?: bigint | undefined
}

function resultSet(overrides: ResultSetOverrides = {}): unknown {
  return {
    columns: [],
    columnTypes: [],
    rows: overrides.rows ?? [],
    rowsAffected: overrides.rowsAffected ?? 0,
    lastInsertRowid: overrides.lastInsertRowid,
    toJSON() {
      return {}
    },
  }
}

describe('turso driver', () => {
  it('short-circuits insertMany([]) and returns empty rows for returning queries', async () => {
    let executeCalls = 0
    let client = {
      execute() {
        executeCalls += 1
        return Promise.resolve(resultSet())
      },
      executeMultiple() {
        return Promise.resolve()
      },
    }

    let driver = new TursoDriver(client as never)
    let result = await driver.execute({
      operation: {
        kind: 'insertMany',
        table: accounts,
        values: [],
        returning: ['id'],
      },
      transaction: undefined,
    })

    assert.deepEqual(result, {
      affectedRows: 0,
      insertId: undefined,
      rows: [],
    })
    assert.equal(executeCalls, 0)
  })

  it('checks table and column existence through driver introspection hooks', async () => {
    let executedStatements: string[] = []

    let client = {
      execute(statement: { sql: string; args: unknown[] }) {
        executedStatements.push(statement.sql)

        if (statement.sql.includes('sqlite_master')) {
          return Promise.resolve(resultSet({ rows: [{ 1: 1 }] }))
        }

        return Promise.resolve(resultSet({ rows: [{ name: 'id' }, { name: 'email' }] }))
      },
      executeMultiple() {
        return Promise.resolve()
      },
    }

    let driver = new TursoDriver(client as never)
    let hasTable = await driver.hasTable({ name: 'users' })
    let hasColumn = await driver.hasColumn({ schema: 'app', name: 'users' }, 'email')

    assert.equal(hasTable, true)
    assert.equal(hasColumn, true)
    assert.equal(
      executedStatements[0],
      'select 1 from sqlite_master where type = ? and name = ? limit 1',
    )
    assert.equal(executedStatements[1], 'pragma "app".table_info("users")')
  })

  it('reports a missing table when introspection returns no rows', async () => {
    let client = {
      execute() {
        return Promise.resolve(resultSet({ rows: [] }))
      },
      executeMultiple() {
        return Promise.resolve()
      },
    }

    let driver = new TursoDriver(client as never)

    assert.equal(await driver.hasTable({ name: 'users' }), false)
    assert.equal(await driver.hasColumn({ name: 'users' }, 'missing'), false)
  })

  it('routes read-only transactions to the libSQL read mode', async () => {
    let modes: string[] = []
    let client = {
      execute() {
        return Promise.resolve(resultSet())
      },
      executeMultiple() {
        return Promise.resolve()
      },
      transaction(mode: string) {
        modes.push(mode)
        return Promise.resolve({
          execute() {
            return Promise.resolve(resultSet())
          },
          executeMultiple() {
            return Promise.resolve()
          },
          commit() {
            return Promise.resolve()
          },
          rollback() {
            return Promise.resolve()
          },
        })
      },
    }

    let driver = new TursoDriver(client as never)
    let readToken = await driver.beginTransaction({ readOnly: true })
    let writeToken = await driver.beginTransaction({ isolationLevel: 'serializable' })
    await driver.commitTransaction(readToken)
    await driver.commitTransaction(writeToken)

    assert.deepEqual(modes, ['read', 'write'])
  })

  it('supports rollback and savepoint lifecycle with escaped names', async () => {
    let executed: string[] = []
    let committed = false
    let rolledBack = false

    let transaction = {
      execute(statement: { sql: string; args: unknown[] }) {
        executed.push(statement.sql)
        return Promise.resolve(resultSet())
      },
      executeMultiple() {
        return Promise.resolve()
      },
      commit() {
        committed = true
        return Promise.resolve()
      },
      rollback() {
        rolledBack = true
        return Promise.resolve()
      },
    }

    let client = {
      execute() {
        return Promise.resolve(resultSet())
      },
      executeMultiple() {
        return Promise.resolve()
      },
      transaction() {
        return Promise.resolve(transaction)
      },
    }

    let driver = new TursoDriver(client as never)
    let token = await driver.beginTransaction()

    await driver.createSavepoint(token, 'sp"name')
    await driver.rollbackToSavepoint(token, 'sp"name')
    await driver.releaseSavepoint(token, 'sp"name')
    await driver.rollbackTransaction(token)

    assert.deepEqual(executed, [
      'savepoint "sp""name"',
      'rollback to savepoint "sp""name"',
      'release savepoint "sp""name"',
    ])
    assert.equal(committed, false)
    assert.equal(rolledBack, true)
  })

  it('throws for unknown transaction tokens', async () => {
    let client = {
      execute() {
        return Promise.resolve(resultSet())
      },
      executeMultiple() {
        return Promise.resolve()
      },
      transaction() {
        throw new Error('not used')
      },
    }

    let driver = new TursoDriver(client as never)

    await assert.rejects(
      () => driver.commitTransaction({ id: 'tx_missing' }),
      /Unknown transaction token: tx_missing/,
    )
    await assert.rejects(
      () => driver.rollbackTransaction({ id: 'tx_missing' }),
      /Unknown transaction token: tx_missing/,
    )
    await assert.rejects(
      () => driver.createSavepoint({ id: 'tx_missing' }, 'sp'),
      /Unknown transaction token: tx_missing/,
    )
    await assert.rejects(
      () => driver.rollbackToSavepoint({ id: 'tx_missing' }, 'sp'),
      /Unknown transaction token: tx_missing/,
    )
    await assert.rejects(
      () => driver.releaseSavepoint({ id: 'tx_missing' }, 'sp'),
      /Unknown transaction token: tx_missing/,
    )
    await assert.rejects(
      () =>
        driver.execute({
          operation: {
            kind: 'insert',
            table: accounts,
            values: { id: 1, email: 'a@example.com', status: 'active' },
          },
          transaction: { id: 'tx_missing' },
        }),
      /Unknown transaction token: tx_missing/,
    )
    await assert.rejects(
      () => driver.hasTable({ name: 'users' }, { id: 'tx_missing' }),
      /Unknown transaction token: tx_missing/,
    )
    await assert.rejects(
      () => driver.hasColumn({ name: 'users' }, 'email', { id: 'tx_missing' }),
      /Unknown transaction token: tx_missing/,
    )
    await assert.rejects(
      () => driver.executeScript('select 1', { id: 'tx_missing' }),
      /Unknown transaction token: tx_missing/,
    )
  })

  it('normalizes non-object rows and count values', async () => {
    let client = {
      execute() {
        return Promise.resolve(
          resultSet({ rows: [1, null, { count: '2' }, { count: 'oops' }, { count: 5n }] }),
        )
      },
      executeMultiple() {
        return Promise.resolve()
      },
    }

    let driver = new TursoDriver(client as never)
    let result = await driver.execute({
      operation: {
        kind: 'count',
        table: accounts,
        joins: [],
        where: [],
        groupBy: [],
        having: [],
      },
      transaction: undefined,
    })

    assert.deepEqual(result.rows, [{}, {}, { count: 2 }, { count: 'oops' }, { count: 5 }])
    assert.equal(result.affectedRows, undefined)
    assert.equal(result.insertId, undefined)
  })

  it('returns undefined metadata for select statements', async () => {
    let client = {
      execute() {
        return Promise.resolve(resultSet({ rows: [{ id: 1 }], rowsAffected: 3 }))
      },
      executeMultiple() {
        return Promise.resolve()
      },
    }

    let driver = new TursoDriver(client as never)
    let result = await driver.execute({
      operation: {
        kind: 'select',
        table: accounts,
        select: '*',
        joins: [],
        where: [],
        groupBy: [],
        having: [],
        orderBy: [],
        limit: undefined,
        offset: undefined,
        distinct: false,
      },
      transaction: undefined,
    })

    assert.equal(result.affectedRows, undefined)
    assert.equal(result.insertId, undefined)
  })

  it('falls back to returned row count when libSQL reports zero rowsAffected for returning writes', async () => {
    let client = {
      execute() {
        return Promise.resolve(resultSet({ rows: [{ id: 42 }], rowsAffected: 0 }))
      },
      executeMultiple() {
        return Promise.resolve()
      },
    }

    let driver = new TursoDriver(client as never)
    let result = await driver.execute({
      operation: {
        kind: 'insert',
        table: accounts,
        values: { email: 'a@example.com', status: 'active' },
        returning: ['id'],
      },
      transaction: undefined,
    })

    assert.equal(result.affectedRows, 1)
    assert.equal(result.insertId, 42)
  })

  it('uses rowsAffected for writes without returning', async () => {
    let client = {
      execute() {
        return Promise.resolve(resultSet({ rows: [], rowsAffected: 2, lastInsertRowid: 99n }))
      },
      executeMultiple() {
        return Promise.resolve()
      },
    }

    let db = createTursoDatabase(client as never)
    let result = await db.updateMany(accounts, { status: 'inactive' }, { where: { id: 1 } })

    assert.equal(result.affectedRows, 2)
    assert.equal(result.insertId, undefined)
  })

  it('derives insertId from lastInsertRowid for inserts without returning', async () => {
    let client = {
      execute() {
        return Promise.resolve(resultSet({ rows: [], rowsAffected: 1, lastInsertRowid: 99n }))
      },
      executeMultiple() {
        return Promise.resolve()
      },
    }

    let driver = new TursoDriver(client as never)
    let result = await driver.execute({
      operation: {
        kind: 'insert',
        table: accounts,
        values: { email: 'a@example.com', status: 'active' },
      },
      transaction: undefined,
    })

    assert.equal(result.affectedRows, 1)
    assert.equal(result.insertId, 99)
  })

  it('does not expose insertId for composite primary keys', async () => {
    let client = {
      execute() {
        return Promise.resolve(resultSet({ rows: [], rowsAffected: 1, lastInsertRowid: 42n }))
      },
      executeMultiple() {
        return Promise.resolve()
      },
    }

    let driver = new TursoDriver(client as never)
    let result = await driver.execute({
      operation: {
        kind: 'insert',
        table: accountProjects,
        values: { account_id: 1, project_id: 2, email: 'team@example.com' },
      },
      transaction: undefined,
    })

    assert.equal(result.affectedRows, 1)
    assert.equal(result.insertId, undefined)
  })

  it('normalizes undefined statement values to null', async () => {
    let boundArgs: unknown[][] = []
    let client = {
      execute(statement: { sql: string; args: unknown[] }) {
        boundArgs.push(statement.args)
        return Promise.resolve(resultSet({ rows: [{ id: 1, email: null, status: 'active' }] }))
      },
      executeMultiple() {
        return Promise.resolve()
      },
    }

    let driver = new TursoDriver(client as never)

    await driver.execute({
      operation: {
        kind: 'insert',
        table: accounts,
        values: { email: undefined, status: 'active' },
        returning: ['id', 'email', 'status'],
      },
      transaction: undefined,
    })

    assert.deepEqual(boundArgs, [[null, 'active']])
  })

  it('executeScript delegates to the libSQL executeMultiple hook', async () => {
    let scripts: string[] = []
    let transactionScripts: string[] = []

    let transaction = {
      execute() {
        return Promise.resolve(resultSet())
      },
      executeMultiple(sql: string) {
        transactionScripts.push(sql)
        return Promise.resolve()
      },
      commit() {
        return Promise.resolve()
      },
      rollback() {
        return Promise.resolve()
      },
    }

    let client = {
      execute() {
        return Promise.resolve(resultSet())
      },
      executeMultiple(sql: string) {
        scripts.push(sql)
        return Promise.resolve()
      },
      transaction() {
        return Promise.resolve(transaction)
      },
    }

    let driver = new TursoDriver(client as never)
    await driver.executeScript('create table widgets (id integer primary key)')

    let token = await driver.beginTransaction()
    await driver.executeScript('insert into widgets values (1)', token)
    await driver.commitTransaction(token)

    assert.deepEqual(scripts, ['create table widgets (id integer primary key)'])
    assert.deepEqual(transactionScripts, ['insert into widgets values (1)'])
  })

  it('wipe drops every user object and restores the foreign key setting', async () => {
    let scripts: string[] = []
    let queries: string[] = []

    let client = {
      execute(statement: { sql: string; args: unknown[] }) {
        queries.push(statement.sql)

        if (statement.sql === 'pragma foreign_keys') {
          return Promise.resolve(resultSet({ rows: [{ foreign_keys: 1 }] }))
        }

        return Promise.resolve(
          resultSet({
            rows: [
              { type: 'trigger', name: 'widgets_ai' },
              { type: 'view', name: 'widget_names' },
              { type: 'index', name: 'widgets_name_idx' },
              { type: 'table', name: 'wid"gets' },
            ],
          }),
        )
      },
      executeMultiple(sql: string) {
        scripts.push(sql)
        return Promise.resolve()
      },
    }

    await new TursoDriver(client as never).wipe()

    assert.equal(queries.length, 2)
    assert.ok(queries[0].includes('from sqlite_master'))
    assert.equal(queries[1], 'pragma foreign_keys')
    assert.deepEqual(scripts, [
      [
        'pragma foreign_keys = off;',
        'drop trigger if exists "widgets_ai";',
        'drop view if exists "widget_names";',
        'drop index if exists "widgets_name_idx";',
        'drop table if exists "wid""gets";',
        'pragma foreign_keys = on;',
      ].join('\n'),
    ])
  })

  it('wipe leaves an empty database alone', async () => {
    let scripts: string[] = []
    let client = {
      execute() {
        return Promise.resolve(resultSet({ rows: [] }))
      },
      executeMultiple(sql: string) {
        scripts.push(sql)
        return Promise.resolve()
      },
    }

    await new TursoDriver(client as never).wipe()

    assert.deepEqual(scripts, [])
  })

  it('close is a no-op that is safe to repeat, because the client is caller-owned', () => {
    let closed = 0
    let client = {
      execute() {
        return Promise.resolve(resultSet())
      },
      executeMultiple() {
        return Promise.resolve()
      },
      close() {
        closed += 1
      },
    }

    let driver = new TursoDriver(client as never)
    driver.close()
    driver.close()

    assert.equal(closed, 0)
  })
})

describe('turso driver against libSQL', () => {
  const settings = table({
    name: 'settings',
    columns: {
      id: column.integer(),
      data: column.json(),
      enabled: column.boolean(),
      seen_at: column.timestamp(),
    },
  })

  it('reads json, boolean, and timestamp columns back as JavaScript values', async () => {
    let client = createClient({ url: ':memory:' })
    try {
      let db = createTursoDatabase(client)
      await db.executeScript(
        'create table settings (id integer primary key, data text, enabled integer, seen_at text)',
      )

      let seenAt = new Date('2026-11-20T01:02:03.456Z')
      await db.create(settings, { id: 1, data: { theme: 'dark' }, enabled: true, seen_at: seenAt })

      let row = await db.find(settings, 1)
      assert.deepEqual(row?.data, { theme: 'dark' })
      assert.equal(row?.enabled, true)
      assert.ok(row?.seen_at instanceof Date)
      assert.equal((row?.seen_at as Date).toISOString(), seenAt.toISOString())

      let stored = await db.exec(rawSql('select data, enabled, seen_at from settings'))
      assert.deepEqual(stored.rows?.[0], {
        data: '{"theme":"dark"}',
        enabled: 1,
        seen_at: '2026-11-20 01:02:03.456',
      })

      assert.equal(await db.query(settings).where(eq(settings.seen_at, seenAt)).exists(), true)

      let ids = await db.exec(sql`select id from settings where id in ${[1, 2]}`)
      assert.deepEqual(ids.rows, [{ id: 1 }])
    } finally {
      client.close()
    }
  })
})
