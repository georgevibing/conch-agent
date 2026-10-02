# 0038 — Durable verified tasks

- Status: accepted
- Date: 2026-10-02
- Supersedes completion/resumption semantics in ADR 0033

This decision supersedes the original “from the start”, derived backup and
model-completion semantics in ADR 0033.

- `Task.expectations` and `toolScope` are server-defined workflow contracts;
  neither model text nor the public create endpoint grants extra tools. Scope
  checks cover host wrappers, native guards and permission requests. Structured
  read/draft workflows cannot invoke shell/browser/integration tools outside
  their allowlist. Account identity is checked before Google calls.
- Each operation has a canonical input digest, stable ID bound to task, tool,
  account and consent generation, and an fsynced write-ahead record. Arguments
  themselves are not copied into this ledger. `HostTool.verification` describes
  scope, effect kind and independent provider reconciliation; model strings
  and `report_result` are never provider receipts.
- Reads may safely run again. Confirmed writes return existing evidence without
  a second write. In-flight/uncertain writes reconcile by stable operation ID;
  absent search results do **not** authorize a second non-idempotent write.
  Unknown tools retain explicit unresolved records. Native known read-only
  tools can repeat; unknown write tools cannot replay an identical operation.
- The manager persists the task/chat association before starting the engine.
  Retry and fallback use the same conversation and its transcript/handoff, not
  a blank chat. Turn-scoped approval answers are cleared. `/continue` adds a
  user revision under the same authorization scope and advances goal revision;
  evidence for an old goal cannot independently certify its revision.
- `modelCompleted` and `verification` are separate. `done` requires every required
  tool receipt for the current goal revision and no unresolved operation;
  successful free-form turns without explicit criteria become `unverified`.
  All summaries and partial confirmed results remain visible on failed/stopped
  cards. The UI labels this distinction and gives inspect links.
- HTTP `requestKey` reuse is serialized and body-bound. Changed requests with
  the same key fail; concurrent retry accepts one claimant. Removing a card
  archives tasks with receipts/request keys, not their deduplication evidence.
- `tasks.json` is protected against model file tools and kept with chats in
  backups. A damaged ledger fails closed, never silently discarding receipts.
  Legacy `done` records without verification migrate to `unverified`. On startup,
  running **and queued** tasks become interrupted: restored authority is not
  automatically exercised. Doctor identifies unverified/uncertain operations.

### Security review and limits

Trust boundaries: model output and external app data are untrusted; workflow
criteria originate in application routes; consent/account scope originates in
connector code; only provider readback can confirm a provider write. The ledger
is local authority, not part of the assistant's editable work folder. Cancellation
cannot undo an already accepted external write; its receipt is preserved.

This is at-most-once replay under uncertainty, **not** a claim of universal
exactly-once delivery. Provider eventual consistency is deliberately a reason to
stop. A human inspecting an unresolved external result may need a separate new
job; there is no unsafe “assume failed and resend” button. A backup is historical:
restored jobs require explicit resumption and reconciliation. Missing/corrupt
provider verification never becomes fabricated evidence.

Independent parent review required read replay to retain actual contents,
archive rather than delete deduplication records, and preserve safe revision
paths from task chats. Regression tests cover those changes, concurrent retry,
crash after write/before receipt, double retries, scope/consent/account changes,
cancellation and partial failure.

Sources: [RFC 9110 §9.2.2, idempotent methods](https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2),
[Google Gmail drafts.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/get),
[Node FileHandle.sync](https://nodejs.org/api/fs.html#filehandlesync).

Trusted tool code may return `HostToolResult.effect = 'not-executed'` only when
no write was attempted (for example an approval declined before POST). The
ledger keeps `not-run`, allowing a fresh approval on retry. It never derives this
state from a model string or a network error. Semantic tool identities bind their
original argument digest within a goal revision; changed content cannot evade
an uncertain or already-confirmed write. Per-tool operation limits bound guided
workflow effects in addition to tool/account allowlists.

Task backup restoration merges existing receipts/tombstones instead of rolling
them back. Historical task records are explicitly marked restored, existing
operations require reconciliation, and brand-new writes without evidence are
refused. A historical backup cannot prove which later external writes occurred.

Conditional workflow steps use `expectation.unlessEmpty` only with a trusted
provider `receipt.empty` on a confirmed read for the current goal revision.
Every recorded matching source must be empty; one later empty query cannot
waive an earlier nonempty source. Neither model arguments nor summary prose
can declare an inbox empty. Scoped tasks expose only approved common tools
and never silently fall back to a different provider after a quota failure.
Same-account reconsent allows fresh reads or fresh approval for a proven
unattempted write; old writes retain their operation ID and reconcile read-only.
