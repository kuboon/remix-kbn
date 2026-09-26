# remix-kbn

`@remix-kbn`-scoped utility packages for [remix](https://github.com/remix-run/remix), published to [JSR](https://jsr.io/@remix-kbn).

These were `@kuboon/remix-*` until the `@remix-kbn` scope existed. The `remix-` prefix went with the move, since the scope says it now — `@kuboon/remix-ssg` is `@remix-kbn/ssg`. Each old name carries a final release saying so and stays on JSR; nothing was unpublished, and each package's CHANGELOG records where its old series stopped.

This is a [Deno workspace](https://docs.deno.com/runtime/fundamentals/workspaces/). Each package lives under `packages/` with its own `deno.json`.

## Packages

| Package                                                         | JSR                                                                                       | Description                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`assets-deno`](./packages/assets-deno)                         | [`@remix-kbn/assets-deno`](https://jsr.io/@remix-kbn/assets-deno)                         | JSR-capable on-demand asset server for `remix/fetch-router`                                          |
| [`data-table-sqlite-turso`](./packages/data-table-sqlite-turso) | [`@remix-kbn/data-table-sqlite-turso`](https://jsr.io/@remix-kbn/data-table-sqlite-turso) | Async Turso / libSQL database for `@remix-run/data-table`, with a migration CLI replacing `remix db` |
| [`helper-agent`](./packages/helper-agent)                       | [`@remix-kbn/helper-agent`](https://jsr.io/@remix-kbn/helper-agent)                       | In-page support chat for a `remix/fetch-router` app — panel, route, and a Claude or scripted agent   |
| [`mcp`](./packages/mcp)                                         | [`@remix-kbn/mcp`](https://jsr.io/@remix-kbn/mcp)                                         | Serve an MCP server from a `remix/fetch-router` route                                                |
| [`ssg`](./packages/ssg)                                         | [`@remix-kbn/ssg`](https://jsr.io/@remix-kbn/ssg)                                         | Static site generation (prerender) for `remix/fetch-router`                                          |
| [`ui-pinch-pan`](./packages/ui-pinch-pan)                       | not published — see below                                                                 | Pinch, pan and wheel as a `@remix-run/ui` mixin — reading the gesture and running it, separately     |

`ui-pinch-pan` has no published package, and did not move with the others. `@kuboon/remix-ui-pinch-pan`
is archived on JSR with its only version yanked, so it is out of the release workflow and still
carries its old name here. It gets its own pass later, as `@remix-kbn/ui-pinch-pan`; the source in
this directory is what will be published then.

## Claude Code plugins

`plugins/` holds Claude Code plugins whose skills document these packages, kept
next to the implementation they describe rather than in a separate skills repo.
[`kuboon/agent-plugins`](https://github.com/kuboon/agent-plugins) lists them in
its marketplace with a `git-subdir` source pointing back here, so a skill and the
package it documents change in the same commit.

| Plugin                                                           | Skill                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`remix-db-migrations-deno`](./plugins/remix-db-migrations-deno) | Running `@remix-run/data-table` migrations from Deno — `remix db` for sqlite/postgres/mysql, and this repo's `@remix-kbn/data-table-sqlite-turso` CLI for Turso / libSQL |

```sh
claude plugin marketplace add kuboon/agent-plugins
claude plugin install remix-db-migrations-deno@agent-plugins
```

## Development

```sh
deno task check   # type check every package
deno task test    # run all tests
deno fmt          # format
deno lint         # lint
```

## Releasing

Publishing to JSR is automated. When a package's source changes on `main`,
`.github/workflows/release-jsr.yaml` calls the shared reusable workflow
[`kuboon/workflows/.github/workflows/release-jsr.yml`](https://github.com/kuboon/workflows/blob/main/.github/workflows/release-jsr.yml),
which runs `deno publish` (OIDC, no token) and pushes a `name@version` git tag.
It skips the publish when the tag already exists, so bump the `version` in the
package's `deno.json` to cut a release.

> [!NOTE]
> Each JSR package must be linked to this repository at
> `https://jsr.io/<package>/publish` for OIDC publishing to succeed.
