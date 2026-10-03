/**
 * Everything that runs outside a Worker: a D1 binding over a local SQLite file (`node:sqlite`),
 * and the migration commands behind `/cli`, for embedding in your own script.
 *
 * Kept apart from the package root so that a Worker bundle never sees `node:sqlite` or `node:fs`.
 *
 * @module
 */

export { createLocalD1 } from './lib/local.ts'
export type { LocalD1 } from './lib/local.ts'
export { parseD1DbArgs, runD1DbCli } from './lib/cli.ts'
export type { D1DbCliOptions, D1DbCommand, D1DbInvocation, D1DbTarget } from './lib/cli.ts'
