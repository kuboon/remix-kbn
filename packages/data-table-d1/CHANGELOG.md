# `data-table-d1` CHANGELOG

This is the changelog for [`data-table-d1`](https://github.com/kuboon/remix-kbn/tree/main/packages/data-table-d1). It follows [semantic versioning](https://semver.org/).

## 0.1.0

- Initial release: a Cloudflare D1 database for `@remix-run/data-table@^1.0.0`.
  - `createD1Database(env.DB)`. The root imports nothing from `node:`, so it bundles into a Worker without `nodejs_compat`.
  - `transaction()` queues writes and commits them as one `batch()`. Inside a transaction, writes cannot return rows, a read after a write throws, and nesting throws (no savepoints).
  - `executeScript()` splits a script into statements and batches it, so a migration and its journal row commit together.
  - `createD1HttpClient()`: the same binding surface over Cloudflare's REST API, for tooling.
  - `/node`: `createLocalD1()`, a D1-shaped binding over a local SQLite file (`node:sqlite`), and `runD1DbCli()`.
  - `/cli`: `migrate | rollback | status | seed | reset | wipe`, local by default, `--remote` for D1 — the replacement for `remix db`, which cannot drive D1.
