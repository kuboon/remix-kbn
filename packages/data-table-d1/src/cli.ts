/**
 * Executable entry point for the D1 database commands.
 *
 * Running this module runs a command and sets the process exit code — it is not meant to be
 * imported. Import {@link runD1DbCli} from `/node` to embed the same commands in your own script.
 *
 * @example
 * ```jsonc
 * // deno.json
 * { "tasks": { "db": "deno run -A jsr:@remix-kbn/data-table-d1/cli" } }
 * ```
 *
 * ```sh
 * deno task db migrate            # data/app.db
 * deno task db migrate --remote   # the D1 database, over Cloudflare's REST API
 * ```
 *
 * @module
 */
import process from 'node:process'

import { runD1DbCli } from './lib/cli.ts'

process.exitCode = await runD1DbCli(process.argv.slice(2))
