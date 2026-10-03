import * as assert from '@remix-run/assert'
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd'
import { join } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { parseD1DbArgs, runD1DbCli } from './cli.ts'
import type { D1DbTarget } from './cli.ts'
import { createLocalD1 } from './local.ts'

describe('parseD1DbArgs', () => {
  it('defaults to the local file', () => {
    let invocation = parseD1DbArgs(['migrate'])
    assert.equal(invocation.remote, false)
    assert.equal(invocation.local, undefined)
    assert.equal(invocation.migrations, './db/migrations')
  })

  it('parses a remote target', () => {
    let invocation = parseD1DbArgs(['status', '--remote', '--database-id', 'abc'])
    assert.equal(invocation.remote, true)
    assert.equal(invocation.databaseId, 'abc')
  })

  it('rejects --local with --remote, and remote flags without --remote', () => {
    assert.throws(() => parseD1DbArgs(['migrate', '--remote', '--local', 'x.db']), /exclusive/)
    assert.throws(() => parseD1DbArgs(['migrate', '--database-id', 'abc']), /only available/)
  })

  it('requires --force for destructive commands', () => {
    assert.throws(() => parseD1DbArgs(['wipe']), /requires --force/)
    assert.equal(parseD1DbArgs(['wipe', '--force']).force, true)
  })
})

describe('runD1DbCli', () => {
  let dir: string
  let logs: string[]
  let errors: string[]
  let log = console.log
  let error = console.error

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'data-table-d1-'))
    let migration = join(dir, 'migrations', '20260101000000_init')
    await mkdir(migration, { recursive: true })
    await writeFile(join(migration, 'up.sql'), 'create table a (id integer primary key);')
    await writeFile(join(migration, 'down.sql'), 'drop table a;')
    logs = []
    errors = []
    console.log = (...args: unknown[]) => void logs.push(args.join(' '))
    console.error = (...args: unknown[]) => void errors.push(args.join(' '))
  })

  afterEach(async () => {
    console.log = log
    console.error = error
    await rm(dir, { recursive: true, force: true })
  })

  it('migrates, reports, and rolls back a local file', async () => {
    let common = ['--local', join(dir, 'nested', 'app.db'), '--migrations', join(dir, 'migrations')]

    assert.equal(await runD1DbCli(['migrate', ...common], { env: {} }), 0)
    assert.equal(await runD1DbCli(['status', ...common], { env: {} }), 0)
    assert.ok(logs.join('\n').includes('20260101000000'))
    assert.equal(await runD1DbCli(['rollback', ...common], { env: {} }), 0)
    assert.ok(logs.some((line) => line === 'reverted 20260101000000_init'))
    assert.deepEqual(errors, [])
  })

  it('builds a remote target from the environment', async () => {
    let targets: D1DbTarget[] = []
    let code = await runD1DbCli(['status', '--remote', '--migrations', join(dir, 'migrations')], {
      env: {
        CLOUDFLARE_ACCOUNT_ID: 'acc',
        CLOUDFLARE_D1_DATABASE_ID: 'db-id',
        CLOUDFLARE_API_TOKEN: 'secret',
      },
      connect(target) {
        targets.push(target)
        return createLocalD1(':memory:')
      },
    })

    assert.equal(code, 0)
    assert.deepEqual(targets, [
      { kind: 'remote', accountId: 'acc', databaseId: 'db-id', apiToken: 'secret' },
    ])
  })

  it('names what a remote target is missing', async () => {
    let code = await runD1DbCli(['status', '--remote'], { env: { CLOUDFLARE_ACCOUNT_ID: 'acc' } })
    assert.equal(code, 1)
    assert.ok(errors[0].includes('--database-id or $CLOUDFLARE_D1_DATABASE_ID'))
    assert.ok(errors[0].includes('--api-token or $CLOUDFLARE_API_TOKEN'))
    assert.ok(!errors[0].includes('--account-id'))
  })
})
