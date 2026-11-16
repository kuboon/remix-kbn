# `web-push` CHANGELOG

This is the changelog for [`web-push`](https://github.com/kuboon/remix-kbn/tree/main/packages/web-push). It follows [semantic versioning](https://semver.org/).

## 0.1.0

First release, extracted from [id.kbn.one](https://github.com/kuboon/id.kbn.one)'s push notifications so that it and [kagi](https://github.com/kbn-one/kagi) share one implementation.

- `./server`: `createPushSender` (send, and classify the push service's answer: expired, VAPID key mismatch, rejected `Topic`), VAPID key helpers, `PushRateLimiter`, `mapWithConcurrency`.
- `./sw`: `installPushHandlers` and `pushServiceWorkerScript` — show the notification, set the app badge, focus or open the URL on click.
- `./client`: `subscribePush`, `unsubscribePush`, `currentPushSubscription`, `detectDeviceKind`.
- `.`: the message format both sides share (`toPushMessage`) and `parsePushSubscription`.

Differences from the code it came from:

- A 404 from the push service also counts as gone, not only 410 (RFC 8030 uses both for an expired subscription).
- A notification click resolves a relative `url` before comparing it with open windows, so an already-open window is focused instead of a second one opened.
- `subscribePush` replaces a subscription made with a different VAPID key instead of reusing it.
- `parsePushSubscription` accepts only `https:` endpoints.
