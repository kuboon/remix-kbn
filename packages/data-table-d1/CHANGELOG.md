# `data-table-d1` CHANGELOG

This is the changelog for [`data-table-d1`](https://github.com/kuboon/remix-kbn/tree/main/packages/data-table-d1). It follows [semantic versioning](https://semver.org/).

## 0.2.0

Follows Remix v3 `3.3.0`.

- `@remix-run/data-table` `^1.0.0` → `^1.1.0`.
- **Rows read through the query builder now have the same JavaScript shape as on the first-party adapters**, which is what `data-table@1.1.0` asks of every driver. The driver implements the new `decodeValue()` hook: `json()` columns come back parsed, `boolean()` columns as `true` / `false`, and `timestamp()` columns as `Date`. Previously they came back as the stored text and integers. `db.exec()` results are still returned unchanged.
- `json()` values are now written with `JSON.stringify()` by `data-table` itself. Code that stored already-serialized JSON text through the query builder now stores a JSON _string_; pass the value instead:

  ```diff
  -await db.create(settings, { id: 1, data: JSON.stringify({ theme: 'dark' }) })
  +await db.create(settings, { id: 1, data: { theme: 'dark' } })
  ```

  Text written before this release that is not valid JSON is read back as it was stored.
- `Date` parameters bind as UTC text in SQLite's `current_timestamp` format (`2026-11-20 01:02:03.456`), the same as `data-table-sqlite@1.1.0`. Any other non-byte object parameter throws `TypeError`: every parameter binds as exactly one value.
- Arrays interpolated into `sql` expand into `(?, ?, …)` (a `data-table@1.1.0` change; an empty array throws).
- The SQL compiler is now upstream `data-table-sqlite@1.1.0`'s, built on the shared `@remix-run/data-table/sql-helpers` compilers. Behaviour changes that come with it:
  - **Fixed: an upsert with a separate `update` object bound its values to the wrong columns.** The `update` values were bound first, so `insert … (status, email) values (?, ?) … do update set email = ?` inserted the update value into `status`, shifted every insert value one column along, and set the conflicting row's `email` to the last insert value.
  - `order by` directions go through `compileOrderByDirection()` instead of being interpolated, and `limit` / `offset` are bound as parameters (`limit ? offset ?`).

## 0.1.0

- Initial release: a Cloudflare D1 database for `@remix-run/data-table@^1.0.0`.
  - `createD1Database(env.DB)`. The root imports nothing from `node:`, so it bundles into a Worker without `nodejs_compat`.
  - `transaction()` queues writes and commits them as one `batch()`. Inside a transaction, writes cannot return rows, a read after a write throws, and nesting throws (no savepoints).
  - `executeScript()` splits a script into statements and batches it, so a migration and its journal row commit together.
  - `createD1HttpClient()`: the same binding surface over Cloudflare's REST API, for tooling.
  - `/node`: `createLocalD1()`, a D1-shaped binding over a local SQLite file (`node:sqlite`), and `runD1DbCli()`.
  - `/cli`: `migrate | rollback | status | seed | reset | wipe`, local by default, `--remote` for D1 — the replacement for `remix db`, which cannot drive D1.
