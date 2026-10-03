# data-table-d1

[Cloudflare D1](https://developers.cloudflare.com/d1/) database for [`remix/data-table`](https://github.com/remix-run/remix/tree/main/packages/data-table), with a migration CLI replacing `remix db`.

D1 speaks the SQLite dialect, but it is reached through a Worker binding (`env.DB`) rather than a connection, and it has no interactive transactions — only `batch()`. This package drives `data-table` through that binding, and turns `transaction()` into a batch.

Requires `@remix-run/data-table@^1.0.0` (Remix v3 `3.0.0`).

## Installation

```sh
deno add jsr:@remix-kbn/data-table-d1
npx jsr add @remix-kbn/data-table-d1
```

There is no peer dependency: the binding comes from the Worker.

## Usage

```ts
import { createD1Database } from '@remix-kbn/data-table-d1'

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    let db = createD1Database(env.DB)
    // db.findMany(...), db.create(...), db.transaction(...)
  },
}
```

The package root imports nothing from `node:`, so it bundles into a Worker without `nodejs_compat`. Everything that runs outside a Worker lives in `/node`.

`createD1Database()` takes anything with D1's `prepare()` / `batch()` surface, and the package ships two besides the real binding:

| Binding                                                   | Entry point | For                                                                |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `env.DB`                                                  | —           | A Worker, `wrangler dev`                                           |
| `createLocalD1(filename)`                                 | `/node`     | Development and tests outside workerd: a local file, `node:sqlite` |
| `createD1HttpClient({ accountId, databaseId, apiToken })` | `.`         | Tooling — the remote database over Cloudflare's REST API           |

`createLocalD1()` answers the way D1 does — `batch()` is one SQL transaction, foreign keys are enforced — so code that passes against it behaves the same on `env.DB`. That includes the transaction rules below, which a plain SQLite driver would not enforce.

```ts
import { createD1Database } from '@remix-kbn/data-table-d1'
import { createLocalD1 } from '@remix-kbn/data-table-d1/node'

let db = createD1Database(await createLocalD1('data/app.db'))
```

`createD1HttpClient()` is an HTTPS round trip to a rate-limited API per call. It is for migrations and scripts, not for serving traffic.

## Transactions

D1 has no `BEGIN`: there is no connection to hold one open on. What it has is `batch()`, which runs a list of statements as one SQL transaction. So here, `transaction()` queues its writes and sends them as a single `batch()` when the callback returns — all of them commit, or none do. If the callback throws, the queue is dropped and nothing reached the database.

```ts
await db.transaction(async (tx) => {
  await tx.create(tasks, { id, content, list: 'inbox' })
  await tx.create(taskLogs, { id: logId, task_id: id, to_list: 'inbox' })
})
```

A queued write has not run when its call returns, which gives three rules:

- **No rows back from a write inside a transaction.** `update()` always asks for the updated row, as does `create({ returnRow: true })`, so they throw inside a transaction. Use `updateMany()` and plain `create()` there. Their `affectedRows` reads `0`, because the write has not happened yet.
- **No read after a write inside a transaction.** A read runs at once against committed data, which would not include the queued writes. Reads before the first write are fine; a read after one throws rather than answering stale.
- **No nested transactions.** D1 has no savepoints; `capabilities.savepoints` is `false`.

Outside a transaction, everything — `returning`, `update()`, `upsert()` — works as on any SQLite database.

## Migrations

`remix db` cannot manage D1: the Remix CLI builds its database from the `db.adapter` section of `remix.json`, whose `type` is a closed set (`sqlite`, `postgres`, `mysql`) with no plugin hook. So this package ships the replacement:

```jsonc
// deno.json
{
  "tasks": { "db": "deno run -A jsr:@remix-kbn/data-table-d1/cli" }
}
```

```sh
deno task db migrate                       # local: data/app.db
deno task db migrate --remote              # the D1 database
deno task db migrate --to 20260101000000   # stop after this one
deno task db rollback --step 1             # run down.sql — remix db has no flag for this
deno task db status --remote               # id, name, applied | pending | drifted | missing
deno task db seed                          # run the SQL seed file
deno task db reset --force                 # wipe, migrate, seed
deno task db wipe --force                  # drop every user table, view, index, and trigger
deno task db --help
```

Migrations are the same directories of plain SQL `remix db` reads — `YYYYMMDDHHmmss_name/up.sql` plus an optional `down.sql` — journaled in the same `data_table_migrations` table and printed the same way, because each command is handed to `runRemixDb()` from `@remix-run/data-table`. They are **not** Wrangler's `migrations/0001_name.sql` / `d1_migrations`; use one or the other, not both.

Each migration runs as one `batch()` together with its journal row: its script is split into statements (string literals, comments, and `CREATE TRIGGER … BEGIN … END` bodies are respected) and either all of it lands, journal row included, or none of it does. D1 rejects `BEGIN` / `COMMIT` / `SAVEPOINT`, so a migration must not contain them; to change tables that others reference, start it with `PRAGMA defer_foreign_keys = on`.

Like `wrangler d1`, a command works on a local file unless told `--remote`:

| Option                   | Default                                        |
| ------------------------ | ---------------------------------------------- |
| `--local <file>`         | `data/app.db`                                  |
| `--remote`               | off                                            |
| `--account-id <id>`      | `$CLOUDFLARE_ACCOUNT_ID` (with `--remote`)     |
| `--database-id <id>`     | `$CLOUDFLARE_D1_DATABASE_ID` (with `--remote`) |
| `--api-token <token>`    | `$CLOUDFLARE_API_TOKEN` (with `--remote`)      |
| `--migrations <path>`    | `./db/migrations`                              |
| `--seed <path>`          | `./db/seed.sql`                                |
| `--journal-table <name>` | `data_table_migrations`                        |

`--database-id` is the database's id (`database_id` in the Wrangler config), not its name. The API token needs D1 edit permission. `migrate` and `rollback` also take `--dry-run`; `rollback` takes `--step <n>` (default `1`) or `--to <migration>`, inclusive. `reset` and `wipe` refuse to run without `--force`.

`--local` opens the file with `node:sqlite`. Pointing it at the SQLite file `wrangler dev` keeps under `.wrangler/state/` works, but that path is Miniflare's internal detail; a file of your own, opened with `createLocalD1()` in development, is the steadier arrangement.

To embed the commands in your own script — to load `.env` first, say:

```ts
// db/cli.ts — deno task db migrate
import { runD1DbCli } from '@remix-kbn/data-table-d1/node'

Deno.exit(await runD1DbCli(Deno.args))
```

## Lifecycle

- `db.close()` is a no-op. The binding belongs to the Worker; a `createLocalD1()` binding has its own `close()`.
- `db.wipe()` cannot delete the database from inside it. It drops every user-defined trigger, view, index, and table in one batch, with foreign key checks deferred to its commit, and leaves D1's own `_cf_*` tables alone. That is the end state `db.reset({ migrations })` needs.

## Capabilities

- `returning: true`
- `savepoints: false`
- `upsert: true`
- `transactionalDdl: true` — a migration and its journal row commit as one batch
- `migrationLock: false`

## Related Packages

- [`data-table`](https://github.com/remix-run/remix/tree/main/packages/data-table) - Core query/relations API
- [`data-table-sqlite`](https://github.com/remix-run/remix/tree/main/packages/data-table-sqlite) - Synchronous SQLite database
- [`data-table-sqlite-turso`](https://jsr.io/@remix-kbn/data-table-sqlite-turso) - Turso / libSQL database

## License

See [LICENSE](./LICENSE)
