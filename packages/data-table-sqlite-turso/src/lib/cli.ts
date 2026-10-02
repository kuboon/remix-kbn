import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'

import type { Client as TursoClient } from '@libsql/client'
import type { MigrationDescriptor, Seed } from '@remix-run/data-table'
import { runRemixDb } from '@remix-run/data-table/cli'
import { loadMigrations, loadSeed } from '@remix-run/data-table/migrations/node'

import { createTursoDatabase, type TursoDatabase } from './database.ts'

/** Database commands accepted by {@link runTursoDbCli}. */
export type TursoDbCommand = 'migrate' | 'rollback' | 'status' | 'seed' | 'reset' | 'wipe'

/**
 * Overrides for {@link runTursoDbCli}, used by tests and by embedding CLIs.
 *
 * Output is not injectable: results are printed by `runRemixDb()` inside `@remix-run/data-table`,
 * which writes to the console directly. That is what keeps this command's output identical to
 * `remix db`'s.
 */
export interface TursoDbCliOptions {
  /** Environment used for connection defaults. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /**
   * Builds the libSQL client. Defaults to `createClient` from `@libsql/client`.
   *
   * Override this to pick a different `@libsql/client` entry point (`/web`, `/sqlite3`), to add
   * `syncUrl` for an embedded replica, or to hand the CLI a client the test already owns. The CLI
   * closes whatever this returns.
   */
  createClient?: (config: { url: string; authToken?: string }) => TursoClient
}

const DEFAULT_URL = 'file:data/app.db'
const DEFAULT_MIGRATIONS = './db/migrations'
const DEFAULT_SEED = './db/seed.sql'
const DEFAULT_URL_ENV = 'TURSO_DATABASE_URL'
const DEFAULT_AUTH_TOKEN_ENV = 'TURSO_AUTH_TOKEN'

const HELP_TEXT = `Manage a Turso / libSQL database for @remix-run/data-table.

The Remix CLI's own \`remix db\` cannot drive this database: remix.json only accepts
sqlite, postgres, and mysql adapters. This command is the replacement — same migration
directories, same journal table, same output, plus the rollback \`remix db\` has no flag for.

Usage:
  <runner> migrate [--to <migration>] [--dry-run] [options]
  <runner> rollback [--step <n> | --to <migration>] [--dry-run] [options]
  <runner> status [options]
  <runner> seed [options]
  <runner> reset --force [options]
  <runner> wipe --force [options]

Commands:
  migrate   Apply pending migrations
  rollback  Revert applied migrations, newest first, by running their down.sql
  status    Print each migration as applied, pending, drifted, or missing
  seed      Run the SQL seed file
  reset     Wipe, migrate, then seed
  wipe      Drop every user table, view, index, and trigger

Options:
  --url <url>              libSQL URL (default: $TURSO_DATABASE_URL, else ${DEFAULT_URL})
  --auth-token <token>     Turso auth token (default: $${DEFAULT_AUTH_TOKEN_ENV})
  --connection-env <name>  Read the URL from this variable instead of $${DEFAULT_URL_ENV}
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
  deno task db status
  deno task db rollback --step 1
  deno task db reset --force
  TURSO_DATABASE_URL=libsql://app.turso.io deno task db migrate
`

const COMMANDS: ReadonlySet<string> = new Set<TursoDbCommand>([
  'migrate',
  'rollback',
  'status',
  'seed',
  'reset',
  'wipe',
])

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--url',
  '--auth-token',
  '--connection-env',
  '--migrations',
  '--seed',
  '--journal-table',
  '--to',
  '--step',
])

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['--dry-run', '--force'])

/** A parsed command line. Exported for tests; not part of the package's public API. */
export interface TursoDbInvocation {
  command: TursoDbCommand
  url?: string
  authToken?: string
  connectionEnv?: string
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
 * @param argv Arguments after the runner, for example `['migrate', '--to', '20260101000000']`.
 * @returns The parsed invocation.
 */
export function parseTursoDbArgs(argv: string[]): TursoDbInvocation {
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

  let seed = values.get('--seed')

  return {
    command: command as TursoDbCommand,
    url: values.get('--url'),
    authToken: values.get('--auth-token'),
    connectionEnv: values.get('--connection-env'),
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
 * Runs a database command against a Turso / libSQL database.
 *
 * This is the whole of `deno run -A jsr:@remix-kbn/data-table-sqlite-turso/cli`: connect from
 * the environment, load `YYYYMMDDHHmmss_name/{up,down}.sql` migration directories, and hand the
 * command to `runRemixDb()` — the same function `remix db` calls — so output and the
 * `data_table_migrations` journal match the Remix CLI exactly. `rollback` is the one addition:
 * `remix db` has no way to run a `down.sql`.
 *
 * It opens the libSQL client itself (that is what a CLI process is for) and always closes it,
 * unlike the library, where the client stays caller-owned.
 *
 * @param argv Arguments after the runner, for example `['migrate', '--to', '20260101000000']`.
 * @param options Overrides for the environment, output sinks, and client construction.
 * @returns The process exit code: `0` on success, `1` on a usage error or a failed command.
 * @example
 * ```ts
 * // db/cli.ts — deno task db migrate
 * import { runTursoDbCli } from '@remix-kbn/data-table-sqlite-turso'
 *
 * Deno.exit(await runTursoDbCli(Deno.args))
 * ```
 */
export async function runTursoDbCli(
  argv: string[],
  options: TursoDbCliOptions = {},
): Promise<number> {
  let env = options.env ?? process.env

  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP_TEXT)
    return argv.length === 0 ? 1 : 0
  }

  let invocation: TursoDbInvocation
  try {
    invocation = parseTursoDbArgs(argv)
  } catch (error) {
    console.error(toMessage(error))
    console.error('')
    console.error(HELP_TEXT)
    return 1
  }

  let url: string
  try {
    url = resolveUrl(invocation, env)
  } catch (error) {
    console.error(toMessage(error))
    return 1
  }

  await ensureLocalDirectory(url)

  // Loaded on demand: `@libsql/client` is the native build, and importing it eagerly would drag it
  // into every app that only imports this package's database, including ones on the edge.
  let createClient = options.createClient ?? (await import('@libsql/client')).createClient
  let client = createClient({
    url,
    authToken: invocation.authToken ?? readEnv(env, DEFAULT_AUTH_TOKEN_ENV),
  })
  let db = createTursoDatabase(client)

  try {
    await runCommand(invocation, db)
    return 0
  } catch (error) {
    console.error(toMessage(error))
    return 1
  } finally {
    // `db.close()` is a documented no-op — the client is caller-owned, and here the caller is
    // this process.
    client.close()
  }
}

async function runCommand(invocation: TursoDbInvocation, db: TursoDatabase): Promise<void> {
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

function resolveUrl(
  invocation: TursoDbInvocation,
  env: Record<string, string | undefined>,
): string {
  if (invocation.url !== undefined) return invocation.url

  if (invocation.connectionEnv !== undefined) {
    let value = readEnv(env, invocation.connectionEnv)
    if (value === undefined) {
      throw new UsageError(
        `Database environment variable ${invocation.connectionEnv} is not set`,
      )
    }
    return value
  }

  return readEnv(env, DEFAULT_URL_ENV) ?? DEFAULT_URL
}

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  let value = env[name]
  return value === undefined || value === '' ? undefined : value
}

/**
 * Creates the parent directory of a `file:` URL.
 *
 * libSQL does not create it and fails with `Unable to open connection to local database …: 14`.
 * The Remix CLI does this for a sqlite `filename`, so a `file:` URL behaves the same here.
 */
async function ensureLocalDirectory(url: string): Promise<void> {
  if (!url.startsWith('file:')) return

  let filename = url.slice('file:'.length).split('?')[0]
  if (filename === '' || filename === ':memory:') return

  let directory = dirname(filename)
  if (directory === '' || directory === '.') return

  await mkdir(directory, { recursive: true })
}

async function readMigrations(invocation: TursoDbInvocation): Promise<MigrationDescriptor[]> {
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
async function requireSeed(invocation: TursoDbInvocation): Promise<Seed> {
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
async function optionalSeed(invocation: TursoDbInvocation): Promise<Seed | undefined> {
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
