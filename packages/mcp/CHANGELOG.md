# `remix-mcp` CHANGELOG

This is the changelog for [`remix-mcp`](https://github.com/kuboon/remix-kbn/tree/main/packages/mcp). It follows [semantic versioning](https://semver.org/).

## 0.4.0

Follows Remix v3 `3.0.0` (stable).

- `@remix-run/*` ranges move to `^1.0.0`. No code in this package changed.

## 0.2.0

- Moved to the `@remix-kbn` scope: this package is **`@remix-kbn/mcp`** from 0.2.0 on. The `remix-` prefix went with the move, because the scope says it now.

  ```diff
  - "@kuboon/remix-mcp": "jsr:@kuboon/remix-mcp@^0.1.2"
  + "@remix-kbn/mcp": "jsr:@remix-kbn/mcp@^0.2.0"
  ```

  No code changed. The minor bump is so that no version number exists under both names — 0.2.0 is only ever the new one.

  `@kuboon/remix-mcp` stops at 0.1.2, whose only content was the notice that this was coming. JSR cannot unpublish, so every version under the old name keeps resolving exactly as it did; entries below 0.1.2 describe releases made there.

## 0.1.2

- Moving to the `@remix-kbn` scope: this package continues as **`@remix-kbn/mcp`**, with the `remix-` prefix dropped because the scope now says it.

  ```diff
  - "@kuboon/remix-mcp": "jsr:@kuboon/remix-mcp@^0.1.1"
  + "@remix-kbn/mcp": "jsr:@remix-kbn/mcp"
  ```

  0.1.2 is the announcement and nothing more — its code is 0.1.1's, byte for byte. Nothing breaks if you stay: JSR cannot unpublish, so every version under this name keeps resolving exactly as it does today, and there is no deadline attached to moving.

## 0.1.1

- Bumped `@remix-run/fetch-router` to `^0.21.0` (Remix v3 `beta.6`). No API change here: `0.21.0`'s only breaking change is `Route.href()` taking an options object, which this package does not call.

## 0.1.0

- Initial release of `@kuboon/remix-mcp`, the `remix/fetch-router` counterpart of [`mcp-server-hono-middleware`](https://github.com/yusukebe/mcp-server-hono-middleware).
- `mcp(server, options)` returns a request handler that serves an `McpServer` over the MCP Streamable HTTP transport, with Host/Origin validation enabled by default for localhost binds and a `requestOptions` hook for forwarding `parsedBody` / `authInfo`.
- `hostHeaderValidation`, `localhostHostValidation`, `originValidation`, and `localhostOriginValidation` expose the same checks as standalone middleware, over `hostRejection` / `originRejection`.
