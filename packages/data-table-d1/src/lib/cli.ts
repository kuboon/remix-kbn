import process from 'node:process'

import type { MigrationDescriptor, Seed } from '@remix-run/data-table'
import { runRemixDb } from '@remix-run/data-table/cli'
import { loadMigrations, loadSeed } from '@remix-run/data-table/migrations/node'

import type { D1DatabaseBinding } from './binding.ts'
import { createD1Database, type D1BackedDatabase } from './database.ts'
import { createD1HttpClient } from './http.ts'
import { createLocalD1 } from './local.ts'

/** Database commands accepted by {@link runD1DbCli}. */
export type D1DbCommand = 'migrate' | 'rollback' | 'status' | 'seed' | 'reset' | 'wipe'

/** Where a command runs: a local SQLite file, or a D1 database over Cloudflare's REST API. */
export type D1DbTarget =
  | { kind: 'local'; filename: string }
  | { kind: 'remote'; accountId: string; databaseId: string; apiToken: string }

/**
 * Overrides for {@link runD1DbCli}, used by tests and by embedding CLIs.
 *
 * Output is not injectable: results are printed by `runRemixDb()` inside `@remix-run/data-table`,
 * which writes to the console directly. That is what keeps this command's output identical to
 * `remix db`'s.
 */
export interface D1DbCliOptions {
  /** Environment used for connection defaults. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /**
   * Opens the binding for a target. Defaults to `createLocalD1()` for `--local` and
   * `createD1HttpClient()` for `--remote`. The CLI calls `close()` on the result when it has one.
   */
  connect?: (target: D1DbTarget) => D1DatabaseBinding | Promise<D1DatabaseBinding>
}

const DEFAULT_LOCAL = 'data/app.db'
const DEFAULT_MIGRATIONS = './db/migrations'
const DEFAULT_SEED = './db/seed.sql'
const ACCOUNT_ID_ENV = 'CLOUDFLARE_ACCOUNT_ID'
const DATABASE_ID_ENV = 'CLOUDFLARE_D1_DATABASE_ID'
const API_TOKEN_ENV = 'CLOUDFLARE_API_TOKEN'

const HELP_TEXT = `Manage a Cloudflare D1 database for @remix-run/data-table.

The Remix CLI's own \`remix db\` cannot drive D1: remix.json only accepts sqlite, postgres,
and mysql adapters. This command is the replacement — same migration directories, same
journal table, same output, plus the rollback \`remix db\` has no flag for.

Usage:
  <runner> migrate [--to <migration>] [--dry-run] [target] [options]
  <runner> rollback [--step <n> | --to <migration>] [--dry-run] [target] [options]
  <runner> status [target] [options]
  <runner> seed [target] [options]
  <runner> reset --force [target] [options]
  <runner> wipe --force [target] [options]

Commands:
  migrate   Apply pending migrations
  rollback  Revert applied migrations, newest first, by running their down.sql
  status    Print each migration as applied, pending, drifted, or missing
  seed      Run the SQL seed file
  reset     Wipe, migrate, then seed
  wipe      Drop every user table, view, index, and trigger

Target (local unless --remote is given):
  --local <file>           Local SQLite file (default: ${DEFAULT_LOCAL})
  --remote                 The D1 database, over Cloudflare's REST API
  --account-id <id>        Cloudflare account (default: $${ACCOUNT_ID_ENV})
  --database-id <id>       D1 database id, not its name (default: $${DATABASE_ID_ENV})
  --api-token <token>      API token with D1 edit permission (default: $${API_TOKEN_ENV})

Options:
  --migrations <path>      Migration directory (default: ${DEFAULT_MIGRATIONS})
  --seed <path>            SQL seed file (default: ${DEFAULT_SEED})
  --journal-table <name>   Migration journal table (default: data_table_migrations)
  --to <migration>         migrate: stop after this migration
                           rollback: revert back through this migration, inclusive
  --step <n>               rollback: revert this many migrations (default: 1)
  --dry-run                migrate, rollback: print what would run, change nothing
  --force                  Confirm a destructive command (reset and wipe only)
  -h, --help               Show this help

Examples:
  deno task db migrate
  deno task db status --remote
  deno task db rollback --step 1
  deno task db reset --force --local data/test.db
`

const COMMANDS: ReadonlySet<string> = new Set<D1DbCommand>([
  'migrate',
  'rollback',
  'status',
  'seed',
  'reset',
  'wipe',
])

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--local',
  '--account-id',
  '--database-id',
  '--api-token',
  '--migrations',
  '--seed',
  '--journal-table',
  '--to',
  '--step',
])

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['--remote', '--dry-run', '--force'])

/** A parsed command line. Exported for tests; not part of the package's public API. */
export interface D1DbInvocation {
  command: D1DbCommand
  remote: boolean
  local?: string
  accountId?: string
  databaseId?: string
  apiToken?: string
  migrations: string
  seed: string
  seedExplicit: boolean
  journalTable?: string
  to?: string
  step?: number
  dryRun: boolean
  force: boolean
}

class UsageError extends Error {}

/**
 * Parses the argument list of a `db` command.
 * @param argv Arguments after the runner, for example `['migrate', '--remote']`.
 * @returns The parsed invocation.
 */
export function parseD1DbArgs(argv: string[]): D1DbInvocation {
  let [command, ...rest] = argv

  if (!COMMANDS.has(command)) {
    throw new UsageError(`Unknown database command: ${command}`)
  }

  let values = new Map<string, string>()
  let flags = new Set<string>()

  for (let index = 0; index < rest.length; index += 1) {
    let argument = rest[index]

    if (VALUE_FLAGS.has(argument)) {
      let value = rest[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`Option ${argument} requires a value`)
      }
      values.set(argument, value)
      index += 1
      continue
    }

    if (BOOLEAN_FLAGS.has(argument)) {
      flags.add(argument)
      continue
    }

    throw new UsageError(
      argument.startsWith('-') ? `Unknown option: ${argument}` : `Unexpected argument: ${argument}`,
    )
  }

  let step: number | undefined
  let rawStep = values.get('--step')
  if (rawStep !== undefined) {
    step = Number(rawStep)
    if (!Number.isInteger(step) || step < 1) {
      throw new UsageError(`Option --step requires a positive integer, got: ${rawStep}`)
    }
  }

  if (values.has('--to') && step !== undefined) {
    throw new UsageError('Options --to and --step are mutually exclusive')
  }

  if (step !== undefined && command !== 'rollback') {
    throw new UsageError('Option --step is only available on rollback')
  }

  if (values.has('--to') && command !== 'migrate' && command !== 'rollback') {
    throw new UsageError('Option --to is only available on migrate and rollback')
  }

  if (flags.has('--dry-run') && command !== 'migrate' && command !== 'rollback') {
    throw new UsageError('Option --dry-run is only available on migrate and rollback')
  }

  if ((command === 'reset' || command === 'wipe') && !flags.has('--force')) {
    throw new UsageError(`Database command "${command}" requires --force`)
  }

  let remote = flags.has('--remote')

  if (remote && values.has('--local')) {
    throw new UsageError('Options --local and --remote are mutually exclusive')
  }

  for (let flag of ['--account-id', '--database-id', '--api-token']) {
    if (!remote && values.has(flag)) {
      throw new UsageError(`Option ${flag} is only available with --remote`)
    }
  }

  let seed = values.get('--seed')

  return {
    command: command as D1DbCommand,
    remote,
    local: values.get('--local'),
    accountId: values.get('--account-id'),
    databaseId: values.get('--database-id'),
    apiToken: values.get('--api-token'),
    migrations: values.get('--migrations') ?? DEFAULT_MIGRATIONS,
    seed: seed ?? DEFAULT_SEED,
    seedExplicit: seed !== undefined,
    journalTable: values.get('--journal-table'),
    to: values.get('--to'),
    step,
    dryRun: flags.has('--dry-run'),
    force: flags.has('--force'),
  }
}

/**
 * Runs a database command against a D1 database or a local SQLite file.
 *
 * This is the whole of `deno run -A jsr:@remix-kbn/data-table-d1/cli`: open the target, load
 * `YYYYMMDDHHmmss_name/{up,down}.sql` migration directories, and hand the command to
 * `runRemixDb()` — the same function `remix db` calls — so output and the `data_table_migrations`
 * journal match the Remix CLI exactly. `rollback` is the one addition: `remix db` has no way to
 * run a `down.sql`.
 *
 * Like `wrangler d1`, it works on a local file unless told `--remote`. A remote run reaches D1 over
 * Cloudflare's REST API, with the account, database id, and API token from flags or
 * `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, and `CLOUDFLARE_API_TOKEN`.
 *
 * @param argv Arguments after the runner, for example `['migrate', '--remote']`.
 * @param options Overrides for the environment and for opening the target.
 * @returns The process exit code: `0` on success, `1` on a usage error or a failed command.
 * @example
 * ```ts
 * // db/cli.ts — deno task db migrate
 * import { runD1DbCli } from '@remix-kbn/data-table-d1/node'
 *
 * Deno.exit(await runD1DbCli(Deno.args))
 * ```
 */
export async function runD1DbCli(
  argv: string[],
  options: D1DbCliOptions = {},
): Promise<number> {
  let env = options.env ?? process.env

  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP_TEXT)
    return argv.length === 0 ? 1 : 0
  }

  let invocation: D1DbInvocation
  let target: D1DbTarget
  try {
    invocation = parseD1DbArgs(argv)
    target = resolveTarget(invocation, env)
  } catch (error) {
    console.error(toMessage(error))
    if (error instanceof UsageError && !(error instanceof TargetError)) {
      console.error('')
      console.error(HELP_TEXT)
    }
    return 1
  }

  let binding = await (options.connect ?? connect)(target)
  let db = createD1Database(binding)

  try {
    await runCommand(invocation, db)
    return 0
  } catch (error) {
    console.error(toMessage(error))
    return 1
  } finally {
    let closable = binding as { close?: () => void }
    closable.close?.()
  }
}

async function runCommand(invocation: D1DbInvocation, db: D1BackedDatabase): Promise<void> {
  let { command, journalTable } = invocation

  if (command === 'wipe') {
    await runRemixDb({ command, db })
    // `runRemixDb()` prints nothing here, and a silent destructive command reads as a no-op.
    console.log('database wiped')
    return
  }

  if (command === 'seed') {
    await runRemixDb({ command, db, seed: await requireSeed(invocation) })
    return
  }

  let migrations = await readMigrations(invocation)

  if (command === 'status') {
    await runRemixDb({ command, db, migrations, journalTable })
    return
  }

  if (command === 'reset') {
    await runRemixDb({
      command,
      db,
      migrations,
      seed: await optionalSeed(invocation),
      journalTable,
    })
    return
  }

  if (command === 'rollback') {
    let result = invocation.to === undefined
      ? await db.migrate(migrations, {
        direction: 'down',
        step: invocation.step ?? 1,
        dryRun: invocation.dryRun,
        journalTable,
      })
      : await db.migrate(migrations, {
        direction: 'down',
        to: invocation.to,
        dryRun: invocation.dryRun,
        journalTable,
      })

    if (result.reverted.length === 0) {
      console.log('no migrations to revert')
    }
    for (let entry of result.reverted) {
      console.log(`${invocation.dryRun ? 'would revert' : 'reverted'} ${entry.id}_${entry.name}`)
    }
    return
  }

  if (invocation.dryRun) {
    // `runRemixDb()` has no dryRun, so this path reports rather than applies. It is labelled
    // differently on purpose: `would apply` never reads as `applied`.
    let result = invocation.to === undefined
      ? await db.migrate(migrations, { direction: 'up', dryRun: true, journalTable })
      : await db.migrate(migrations, {
        direction: 'up',
        to: invocation.to,
        dryRun: true,
        journalTable,
      })

    if (result.applied.length === 0) {
      console.log('no pending migrations')
    }
    for (let entry of result.applied) {
      console.log(`would apply ${entry.id}_${entry.name}`)
    }
    return
  }

  await runRemixDb({ command, db, migrations, to: invocation.to, journalTable })
}

class TargetError extends UsageError {}

function resolveTarget(
  invocation: D1DbInvocation,
  env: Record<string, string | undefined>,
): D1DbTarget {
  if (!invocation.remote) {
    return { kind: 'local', filename: invocation.local ?? DEFAULT_LOCAL }
  }

  let accountId = invocation.accountId ?? readEnv(env, ACCOUNT_ID_ENV)
  let databaseId = invocation.databaseId ?? readEnv(env, DATABASE_ID_ENV)
  let apiToken = invocation.apiToken ?? readEnv(env, API_TOKEN_ENV)
  let missing = [
    accountId === undefined && `--account-id or $${ACCOUNT_ID_ENV}`,
    databaseId === undefined && `--database-id or $${DATABASE_ID_ENV}`,
    apiToken === undefined && `--api-token or $${API_TOKEN_ENV}`,
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new TargetError('--remote needs ' + missing.join(', '))
  }

  return {
    kind: 'remote',
    accountId: accountId!,
    databaseId: databaseId!,
    apiToken: apiToken!,
  }
}

function connect(target: D1DbTarget): D1DatabaseBinding | Promise<D1DatabaseBinding> {
  return target.kind === 'local' ? createLocalD1(target.filename) : createD1HttpClient(target)
}

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  let value = env[name]
  return value === undefined || value === '' ? undefined : value
}

async function readMigrations(invocation: D1DbInvocation): Promise<MigrationDescriptor[]> {
  try {
    return await loadMigrations(invocation.migrations)
  } catch (error) {
    if (isFileNotFound(error)) {
      throw new Error(
        `Migration directory not found: ${invocation.migrations} (pass --migrations <path>)`,
      )
    }
    throw error
  }
}

/** Loads the seed file, failing when it is missing. */
async function requireSeed(invocation: D1DbInvocation): Promise<Seed> {
  try {
    return await loadSeed(invocation.seed)
  } catch (error) {
    if (!isFileNotFound(error)) throw error
    throw new Error(`Seed file not found: ${invocation.seed} (pass --seed <path>)`)
  }
}

/**
 * Loads the seed file for `reset`, where seeding is optional — as it is for `remix db reset` with
 * no `db.seed` configured. An explicit `--seed` that does not exist is still an error.
 */
async function optionalSeed(invocation: D1DbInvocation): Promise<Seed | undefined> {
  try {
    return await loadSeed(invocation.seed)
  } catch (error) {
    if (!isFileNotFound(error)) throw error
    if (!invocation.seedExplicit) return undefined
    throw new Error(`Seed file not found: ${invocation.seed} (pass --seed <path>)`)
  }
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
