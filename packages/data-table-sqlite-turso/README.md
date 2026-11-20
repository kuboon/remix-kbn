# data-table-sqlite-turso

> Renamed from `@kuboon/remix-data-table-sqlite-turso` at 0.4.0. The old name stops at 0.3.2 and stays on
> JSR; nothing was unpublished.

Turso / libSQL database for [`remix/data-table`](https://github.com/remix-run/remix/tree/main/packages/data-table). Use this package when you want `data-table` APIs backed by an asynchronous SQLite client such as [`@libsql/client`](https://www.npmjs.com/package/@libsql/client).

Turso speaks the SQLite dialect but exposes an async, promise-based client, so the synchronous [`data-table-sqlite`](https://github.com/remix-run/remix/tree/main/packages/data-table-sqlite) database cannot drive it. This package awaits every client call, which makes it a good fit for remote Turso databases, embedded replicas, and other libSQL deployments.

Requires `@remix-run/data-table@^1.1.0` (Remix v3 `3.3.0`).

## Features

- **Async libSQL Support**: Works with `@libsql/client` against remote Turso databases, embedded replicas, and local files
- **Full `data-table` API Support**: Queries, relations, writes, and interactive transactions
- **Package-Owned Compiler**: SQL compilation lives in this package, with optional shared pure helpers from `data-table`
- **Multi-Statement Migrations**: `executeScript()` runs `up.sql` / `down.sql` files via libSQL's `executeMultiple()`
- **Migration CLI**: `…/cli` replaces `remix db`, which cannot drive this database — plus a `rollback` the Remix CLI does not have
- **SQLite Capabilities Enabled By Default**:
  - `returning: true`
  - `savepoints: true`
  - `upsert: true`
  - `transactionalDdl: true`
  - `migrationLock: false`

## Installation

This package is published to [JSR](https://jsr.io/@remix-kbn/data-table-sqlite-turso). Install it together with the `@libsql/client` peer dependency (`@remix-run/data-table` is pulled in automatically):

```sh
npx jsr add @remix-kbn/data-table-sqlite-turso
npm i @libsql/client
```

For Deno:

```sh
deno add jsr:@remix-kbn/data-table-sqlite-turso npm:@libsql/client
```

## Usage

```ts
import { createClient } from '@libsql/client'
import { createTursoDatabase } from '@remix-kbn/data-table-sqlite-turso'

let client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})
let db = createTursoDatabase(client)
```

`@libsql/client` is a peer dependency, so install it alongside this package. Import any driver-specific types you need directly from `@libsql/client`; the client type is also re-exported here as `TursoDatabaseClient`.

## Migrations

`remix db` cannot manage this database. The Remix CLI builds its database from the `db.adapter` section of `remix.json`, whose `type` is a closed set — a fourth type is rejected outright, and there is no plugin hook:

```
Error [RMX_INVALID_CONFIG] Invalid Remix configuration
remix.json:1:32: Expected one of: sqlite, postgres, mysql at db.adapter.type
```

So this package ships the replacement. Wire it up as a task:

```jsonc
// deno.json
{
  "tasks": { "db": "deno run -A jsr:@remix-kbn/data-table-sqlite-turso/cli" }
}
```

```sh
deno task db migrate                       # apply pending migrations
deno task db migrate --to 20260101000000   # stop after this one
deno task db rollback --step 1             # run down.sql — remix db has no flag for this
deno task db status                        # id, name, applied | pending | drifted | missing
deno task db seed                          # run the SQL seed file
deno task db reset --force                 # wipe, migrate, seed
deno task db wipe --force                  # drop every user table, view, index, and trigger
deno task db --help
```

Migrations are the same directories of plain SQL `remix db` reads — `YYYYMMDDHHmmss_name/up.sql` plus an optional `down.sql` — journaled in the same `data_table_migrations` table, and printed the same way, because each command is handed to `runRemixDb()` from `@remix-run/data-table`: the same function the Remix CLI calls. Only the wiring differs.

Connection and paths come from flags and the environment rather than `remix.json`, which is never read:

| Option                    | Default                                        |
| ------------------------- | ---------------------------------------------- |
| `--url <url>`             | `$TURSO_DATABASE_URL`, else `file:data/app.db` |
| `--auth-token <token>`    | `$TURSO_AUTH_TOKEN`                            |
| `--connection-env <name>` | reads the URL from a different variable        |
| `--migrations <path>`     | `./db/migrations`                              |
| `--seed <path>`           | `./db/seed.sql`                                |
| `--journal-table <name>`  | `data_table_migrations`                        |

`migrate` and `rollback` also take `--dry-run` (report, change nothing); `rollback` takes `--step <n>` (default `1`) or `--to <migration>`, which reverts back through that migration inclusive. `reset` and `wipe` refuse to run without `--force`.

Node and Bun get the same commands from a one-line entry point, since importing the `/cli` subpath runs it:

```js
// db/cli.js — node db/cli.js migrate
import '@remix-kbn/data-table-sqlite-turso/cli'
```

To embed the commands in your own script — to load `.env` first, or to build the client from `@libsql/client/web` — call the same function the executable does:

```ts
// db/cli.ts — deno task db migrate
import { runTursoDbCli } from '@remix-kbn/data-table-sqlite-turso'

Deno.exit(await runTursoDbCli(Deno.args))
```

`runTursoDbCli(argv, options)` takes `env` and a `createClient` override for exactly that. Unlike the library, the CLI opens the client itself and always closes it.

Two things worth knowing:

- **Do not point `remix db`'s `sqlite` adapter at the same local `file:` database.** It appears to work — same dialect, same journal table — but it only ever works for the local file, so staging and production still need this command, and you end up with two migration paths that can disagree.
- **Deno needs more than the usual permissions.** `@libsql/client` loads a native module, so the minimum is `--allow-read --allow-write --allow-env --allow-sys --allow-ffi` (leaving out `--allow-sys` fails on `cpus` while detecting glibc, and `--allow-env` on `LIBSQL_JS_DEV`). `-A` is the pragmatic choice for a local task. A remote `libsql://` URL adds `--allow-net`.

## Lifecycle

The libSQL client is always **caller-owned**. `@libsql/client` ships several entry points (`@libsql/client`, `@libsql/client/web`, `@libsql/client/sqlite3`) and only your application knows which one its runtime can load, so this package never constructs one. Two consequences:

- `db.close()` is a **no-op**. Close the client yourself at shutdown.
- `db.wipe()` cannot unlink a database file — the client may point at a remote Turso database. It instead drops every user-defined trigger, view, index, and table, suspending foreign key enforcement for the drop and restoring the connection's previous setting. That is the end state `db.reset({ migrations })` needs, so `reset()` works normally.

## Capabilities

`data-table-sqlite-turso` reports this capability set by default:

- `returning: true`
- `savepoints: true`
- `upsert: true`
- `transactionalDdl: true`
- `migrationLock: false`

## Advanced Usage

### Local File Database

`@libsql/client` can open a local SQLite file, which is handy for development and tests:

```ts
import { createClient } from '@libsql/client'
import { createTursoDatabase } from '@remix-kbn/data-table-sqlite-turso'

let client = createClient({ url: 'file:app.db' })
let db = createTursoDatabase(client)
```

### Synchronous SQLite

If you are running against a synchronous SQLite client (Node's `node:sqlite` or Bun's `bun:sqlite`), use [`data-table-sqlite`](https://github.com/remix-run/remix/tree/main/packages/data-table-sqlite) instead — its `createSqliteDatabase()` also supports config-backed construction, which this package deliberately does not.

## Related Packages

- [`data-table`](https://github.com/remix-run/remix/tree/main/packages/data-table) - Core query/relations API
- [`data-schema`](https://github.com/remix-run/remix/tree/main/packages/data-schema) - Schema parsing and validation
- [`data-table-sqlite`](https://github.com/remix-run/remix/tree/main/packages/data-table-sqlite) - Synchronous SQLite database
- [`data-table-postgres`](https://github.com/remix-run/remix/tree/main/packages/data-table-postgres) - PostgreSQL database
- [`data-table-mysql`](https://github.com/remix-run/remix/tree/main/packages/data-table-mysql) - MySQL database

## License

See [LICENSE](https://github.com/remix-run/remix/blob/main/LICENSE)
