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

Review required read replay to retain actual contents,
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

Foreground prepared drafts hand off to one bounded background task. A trusted
argument hash fixes the exact parsed payload (ignoring undefined optional fields),
and a request key binds parent conversation, user turn and payload. Repeated tool
calls within that turn return the same task, while a new user turn can deliberately
request another draft. The task inherits its source conversation/provider, forces
normal approvals, and cannot change accounts, recipients or content. The queued
handoff is not evidence that a draft was saved. Oversized handoffs fail before
persistence. Scoped workflows skip MCP initialization as well as filtering tools:
untrusted source notes cannot start unrelated integration processes.

## Amended 2026-10-07: execution, evidence and outcomes

A completed turn and a verified goal are different facts. `assessTask` in the
protocol is the single assessment used by task finalization, tool diagnostics,
health and the UI. General tasks without trusted criteria finish with no error
and say **Finished — outcome not checked**. They retain the existing `unverified`
storage status for compatibility. Their model summary does not become proof.
Guided workflows still require server-defined criteria; optional input hashes
and receipt identities bind those criteria to a target, not merely a tool count.
Criteria cannot grant tools or permissions.

Read attempts append distinct observations. The latest attempt for each read
identity must succeed to satisfy a required read; a failed attempt cannot reuse
an older cached receipt. Conditional empty-source rules also retain every earlier
nonempty observation in the goal revision. Optional failed reads do not block
unrelated effects or a completed goal. Native reads are settled by actual engine
result events, awaited before task finalization; late results after Stop do not
settle evidence. Trusted host effect declarations are independent of receipt
support. Remote tool descriptions and annotations do not establish these declarations.

Local Write and Edit operations persist before/after content hashes before
dispatch, check the precondition, and read back the resulting bytes. Edits to a
canonical file are serialized across Conch tasks. A confirmed local predecessor
may be followed by a new mutation; this does not apply to external writes. Artifact
updates similarly persist a base version and verify the exact following version.
Restored tasks remain constrained by the historical-backup rules above.

There are two different reasons a write may have no receipt. If a declared
reconciler fails, or execution fails/loses its response, the operation is uncertain
and still blocks other writes and replay. If an opaque tool returns successfully
but has no reconciler, Conch records successful execution and unavailable outcome
verification. Distinct subsequent work can proceed; the same opaque operation
cannot replay. This does not certify its outcome or allow changing a payload to
bypass a failed declared reconciler. It is not possible to independently prove
arbitrary shell or third-party effects from their success text. Such work is
explicitly shown without outcome assurance. This is a change from globally
blocking all subsequent work after every unsupported successful tool.

Structured `isError` and trusted `not-executed` results survive every adapter.
Health does not warn about missing optional criteria or proven no-dispatch.
Task status includes bounded operation evidence and reason codes, without copying
arguments, checkpoints or credentials. New optional ledger fields preserve the
previous release's ability to read the file; older releases may conservatively
require inspection of newer evidence.

Threat model: models and remote tool content cannot fabricate host contracts,
operation checkpoints or receipts. A model changing write arguments cannot evade
an uncertain declared write. Sequential mutation is explicitly limited to local
versioned tools and remains behind the same permission/path guards. Read evidence
is scoped to an actual invocation and goal revision. General tasks never gain
verification merely because the model says it finished. Tests cover stale and
erased read evidence, precondition conflicts, duplicate writes, native result
ordering, cancellation, account/consent changes and all four diagnostic flows.

Sources reviewed: [RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)
(idempotence is a property of an operation, not its result text), and
[OWASP Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html)
(server-controlled authorization, bound transaction data, and ordered transitions).
