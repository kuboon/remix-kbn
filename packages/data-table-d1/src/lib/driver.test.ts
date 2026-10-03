import * as assert from '@remix-run/assert'
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd'
import { column, eq, table } from '@remix-run/data-table'

import { createD1Database, type D1BackedDatabase } from './database.ts'
import { createLocalD1, type LocalD1 } from './local.ts'

const accounts = table({
  name: 'accounts',
  columns: {
    id: column.integer(),
    email: column.text(),
    status: column.text(),
  },
})

const logs = table({
  name: 'logs',
  columns: {
    id: column.integer(),
    account_id: column.integer(),
    message: column.text(),
  },
})

const schema = `
  create table accounts (id integer primary key, email text not null unique, status text not null);
  create table logs (
    id integer primary key,
    account_id integer not null references accounts(id),
    message text not null
  );
`

describe('d1 driver', () => {
  let binding: LocalD1
  let db: D1BackedDatabase

  beforeEach(async () => {
    binding = await createLocalD1(':memory:')
    db = createD1Database(binding)
    await db.executeScript(schema)
  })

  afterEach(() => binding.close())

  it('creates, finds, updates, counts, and deletes outside a transaction', async () => {
    let created = await db.create(accounts, { email: 'a@example.com', status: 'active' }, {
      returnRow: true,
    })
    assert.equal(created.email, 'a@example.com')

    let updated = await db.update(accounts, created.id, { status: 'inactive' })
    assert.equal(updated.status, 'inactive')

    assert.equal(await db.count(accounts), 1)
    assert.equal(await db.query(accounts).where(eq(accounts.status, 'inactive')).exists(), true)
    assert.equal(await db.delete(accounts, created.id), true)
    assert.equal(await db.count(accounts), 0)
  })

  it('reports affectedRows and insertId', async () => {
    let result = await db.create(accounts, { email: 'a@example.com', status: 'active' })
    assert.equal(result.affectedRows, 1)
    assert.equal(result.insertId, 1)

    let many = await db.updateMany(accounts, { status: 'x' }, { where: eq(accounts.id, 1) })
    assert.equal(many.affectedRows, 1)
  })

  it('commits a transaction as one batch', async () => {
    await db.transaction(async (tx) => {
      await tx.create(accounts, { id: 1, email: 'a@example.com', status: 'active' })
      await tx.create(logs, { account_id: 1, message: 'created' })
      // Nothing has reached the database until the callback returns.
      assert.equal(await db.count(accounts), 0)
    })

    assert.equal(await db.count(accounts), 1)
    assert.equal(await db.count(logs), 1)
  })

  it('rolls back every queued write when the callback throws', async () => {
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.create(accounts, { id: 1, email: 'a@example.com', status: 'active' })
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.equal(await db.count(accounts), 0)
  })

  it('rolls back the whole batch when one statement fails at commit', async () => {
    await db.create(accounts, { id: 1, email: 'taken@example.com', status: 'active' })

    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.create(accounts, { id: 2, email: 'b@example.com', status: 'active' })
        await tx.create(accounts, { id: 3, email: 'taken@example.com', status: 'active' })
      }),
    )
    assert.equal(await db.count(accounts), 1)
  })

  it('updates inside a transaction with updateMany()', async () => {
    await db.create(accounts, { id: 1, email: 'a@example.com', status: 'active' })

    await db.transaction(async (tx) => {
      await tx.updateMany(accounts, { status: 'done' }, { where: eq(accounts.id, 1) })
      await tx.create(logs, { account_id: 1, message: 'done' })
    })

    let account = await db.find(accounts, 1)
    assert.equal(account?.status, 'done')
  })

  it('refuses a write that needs returned rows inside a transaction', async () => {
    await db.create(accounts, { id: 1, email: 'a@example.com', status: 'active' })

    await assert.rejects(
      db.transaction((tx) => tx.update(accounts, 1, { status: 'x' })),
      (error: unknown) =>
        String((error as Error).cause ?? error).includes('cannot return rows') ||
        String(error).includes('cannot return rows'),
    )
    assert.equal((await db.find(accounts, 1))?.status, 'active')
  })

  it('reads before the first queued write, and refuses one after', async () => {
    await db.create(accounts, { id: 1, email: 'a@example.com', status: 'active' })

    await assert.rejects(
      db.transaction(async (tx) => {
        assert.equal(await tx.count(accounts), 1)
        await tx.create(accounts, { id: 2, email: 'b@example.com', status: 'active' })
        await tx.count(accounts)
      }),
      (error: unknown) => JSON.stringify(describeError(error)).includes('queued a write'),
    )
    assert.equal(await db.count(accounts), 1)
  })

  it('refuses a nested transaction', async () => {
    await assert.rejects(
      db.transaction((tx) => tx.transaction(async () => {})),
      /savepoint/,
    )
  })

  it('introspects tables and columns', async () => {
    assert.equal(await db.hasTable({ name: 'accounts' }), true)
    assert.equal(await db.hasTable({ name: 'missing' }), false)
    assert.equal(await db.hasColumn({ name: 'accounts' }, 'email'), true)
    assert.equal(await db.hasColumn({ name: 'accounts' }, 'missing'), false)
  })

  it('wipes every table, even ones other tables reference', async () => {
    await db.executeScript('create view active as select * from accounts where status = 1')
    await db.create(accounts, { id: 1, email: 'a@example.com', status: 'active' })
    await db.create(logs, { account_id: 1, message: 'x' })

    await db.wipe()

    assert.equal(await db.hasTable({ name: 'accounts' }), false)
    assert.equal(await db.hasTable({ name: 'logs' }), false)
    await db.wipe()
  })

  it('applies a migration and its journal row together, or neither', async () => {
    await db.wipe()
    let migrations = [
      { id: '20260101000000', name: 'ok', up: 'create table a (id integer primary key);' },
      {
        id: '20260102000000',
        name: 'broken',
        up: 'create table b (id integer primary key); insert into missing values (1);',
      },
    ]

    await assert.rejects(db.migrate(migrations))

    let status = await db.migrationStatus(migrations)
    assert.deepEqual(status.map((entry) => entry.status), ['applied', 'pending'])
    assert.equal(await db.hasTable({ name: 'a' }), true)
    assert.equal(await db.hasTable({ name: 'b' }), false)
  })

  it('rolls a migration back with its down script', async () => {
    await db.wipe()
    let migrations = [{
      id: '20260101000000',
      name: 'a',
      up: 'create table a (id integer primary key);',
      down: 'drop table a;',
    }]

    await db.migrate(migrations)
    assert.equal(await db.hasTable({ name: 'a' }), true)
    await db.migrate(migrations, { direction: 'down', step: 1 })
    assert.equal(await db.hasTable({ name: 'a' }), false)
  })
})

function describeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  return { message: error.message, cause: describeError(error.cause) }
}
