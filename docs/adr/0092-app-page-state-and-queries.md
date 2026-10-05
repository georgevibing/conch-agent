# 0092: App page state and queries

An app page should load useful data when opened, remember its view, and refresh after a change made through chat. Its opaque origin and lack of network access remain the boundary.

## Decision

Apps may declare `pageState: true` to keep small JSON preferences through `conch.state`. Tools may declare `cache: { maxAge: seconds }` to allow host-managed caching of read results through `conch.query` and `conch.observe`. Cache writes are infrastructure, not app actions: the tool must be read-only and must not write app.data. Ordinary app.data writes and external changes retain `changes: true` and existing approvals. Legacy tools without cache declarations keep their behavior.

Page state and query results live in a bounded host-owned file in the app's existing data directory. There are no new filesystem paths outside existing backup and protection rules. Updates retain state in the same hands, but cached results are scoped to the code hash; settings changes clear state and results to avoid showing another account's data. Removing the app follows the existing keep-data choice. No background execution after the page closes is introduced.

The gateway checks app and tool switches and required settings before every cache read, including cached reads. Changes invalidate queries even when an external result is uncertain. Concurrent query refreshes coalesce; an invalidation prevents an older in-flight read from being saved. Failed reads never replace successful data. Pages receive invalidation through the existing host message bridge and refresh only while visible. Refresh intervals are bounded and failures back off.

Scratch fixtures supply fake settings and exact HTTPS request/response pairs to a separate draft runtime. They never access installed data, real credentials or the network, and unmatched requests fail. Setup-required answers do not count as successful tool tests.

## Threat model and sources

A malicious sealed page must not select another app, read disabled tools' cached results, turn a query into an external write, or use state keys as paths. A malicious tools module must not use a cacheable read to write durable app data. All messages remain data, validated on both sides; the frame stays `allow-scripts` only. Resource caps cover stored state, query count, request input and concurrent refreshes.

Followed OWASP's [HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) (message source/origin checks, no evaluated messages, storage is untrusted) and [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (least privilege and checks on every request). No authentication, cryptography or network reach is added.
