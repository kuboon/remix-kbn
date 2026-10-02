# `helper-agent` CHANGELOG

This is the changelog for [`helper-agent`](https://github.com/kuboon/remix-kbn/tree/main/packages/helper-agent). It follows [semantic versioning](https://semver.org/).

## 0.3.0

Follows Remix v3 `3.0.0` (stable).

- `@remix-run/ui` `^0.11.0` → `@remix-run/component` `^1.0.0`. The component runtime moved back out of `@remix-run/ui` in Remix 3.0.0, so the imports and `jsxImportSource` follow. No other code changed; the symbols this package uses are the same in `component@1.0.0`.
- The other `@remix-run/*` ranges move to `^1.0.0`.

## 0.2.0

Follows Remix v3 `rc.4`.

- `@remix-run/ui` `^0.10.0` → `^0.11.0`, and `@remix-run/fetch-router` `^0.22.0` → `^0.22.2`. No
  code in this package changed. `ui@0.11.0` is additive — it adds `diffElementAttributes` and
  tightens `clientEntry`'s props typing, and this package uses neither — and `fetch-router@0.22.2`
  is a patch within the range it already had.

  The `ui` range moves anyway, because `^0.11.0` does not include 0.10: a consumer on rc.4 with
  this package left at `^0.10.0` would resolve **two copies of the UI runtime**, and the panel's
  module-level state would then exist twice with no error.

## 0.1.1

- The panel turns URLs in a reply into links. `draft_bug_report` answers with a prefilled issue
  URL rather than opening a window, because a tool callback has no user activation left by the
  time the reply has streamed and the popup is blocked — so the link has to be something the
  person clicks.

## 0.1.0

Initial release: an in-page support chat for a `remix/fetch-router` app.

- `@remix-kbn/helper-agent/client` — the panel, as a `@remix-run/ui` component. Opening it is the
  host site's business; this is what the button opens.
- `@remix-kbn/helper-agent/controller` — an ordinary `fetch-router` handler. The client's
  transport takes a `fetch`, so a browser-side router works as well as a server one.
- `@remix-kbn/helper-agent/agent/claude` — the real agent, over the Anthropic SDK, with tool use
  so the conversation can report a bug rather than only describe one.
- `@remix-kbn/helper-agent/agent/dummy` — a scripted agent for tests. Mounted in a SPA router it
  makes the whole chat exercisable on a static host, with no server and no API key.
