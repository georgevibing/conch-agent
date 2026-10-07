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

## Amended 2026-10-07: rejected reads and restart continuity

Read failures before dispatch (including path checks, expired scope and denied
account scope) append a failed, not-run observation under the same read identity.
They invalidate earlier required evidence without granting any scope, storing
provider error details, or blocking unrelated writes. Successful later reads can
recover. Permission checks and path protection remain ahead of execution.

A new turn snapshots earlier operation IDs. Reissuing a previously confirmed
local mutation with the same payload returns its historical receipt instead of
undoing later edits. A new payload may extend the work; a new goal revision may
intentionally request an earlier value. Uncertain effects and backup-restored
operations still require reconciliation. No prose or provider utility is promoted
to a receipt: provider-internal operations without a result hook are outside the
ledger’s coverage.

Startup preserves queued/running tasks as interrupted and clears obsolete asking
cards. Resume is explicit, increments a persisted attempt, and uses the same
conversation, outcome criteria, tool scope and original working folder. Resumed
turns recheck the parent’s current permission ceiling and inherit additional taint
and skill holds. Old approval answers cannot release new requests. Shutdown fences
admission across asynchronous preparation and leaves unfinished tasks recoverable.
Provider/startup exceptions finish with an error instead of stranding a running
card.

Worktree metadata retains its repository, base commit and whether Conch kept the
folder. Interrupted, stopped and failed tasks retain clean worktrees too. Successful
clean worktrees persist their clean checkpoint before removal with Git’s own
dirty check, never force-removal; failed checkpoint persistence prevents cleanup.
A restart after removal can therefore reopen the folder. Failed removal retains
the branch, and branch deletion uses the expected base hash to preserve concurrent
commits. Only deliberate cleanup permits recreation at
the saved base (or an existing saved branch). Missing retained folders and branch
changes stop before starting a provider. Older records without recovery metadata
remain readable and use their existing folder, failing closed if it is missing.

Regression coverage includes cold service restarts with pending approvals and
queued work, changed workspace/permissions/taint/skill holds, worktree recovery,
shutdown during provider detection, rejected reads, and actual child-process death
before a write, after its external effect, and after its durable receipt. The
external-effect fixture demonstrates reconciliation without a duplicate; absence
alone does not authorize replay. Fault injection uses temporary homes only.

This follows the server-side state sequencing and per-operation authorization
requirements of the [OWASP Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html#25-application-should-control-which-transaction-state-transitions-are-allowed).
No automatic resume, trust setting, or new network capability is introduced.

## Amended 2026-10-07: completion contracts and observable provider tools

New general tasks fix a response-delivery contract before starting. A successful
turn must save a nonempty answer, tagged by the server with the goal revision and
attempt. `assessTask` reports `delivered`; this is not a claim that the prose is
true or that an external action happened. Missing answers remain incomplete.
Legacy tasks without a contract remain unchecked. Explicit receipt expectations
always take precedence, and uncertain or unsupported effects cannot be hidden by
an answer. This replaces the no-criteria default described above.

`delegate`, `start_background_task` and the task-create API accept bounded `checks`
(tool, minimum receipt count, optional exact arguments/receipt/empty-source rule).
The server validates every helper's checks before starting any of the helpers,
normalizes Conch tool names and hashes arguments before saving criteria. For
example, a check for `Write` with arguments `{file_path: "probe.txt", content:
"updated"}` requires a confirmed receipt for that exact payload. These fields
never grant tool, account or permission scope. Repeated reads count as distinct
observations only since the latest failed or pending read of that identity; an
exact receipt requirement still needs the latest result. Task briefs include the fixed
criteria and status diagnostics expose the missing ones. Guided workflows retain
their existing server-defined criteria.

Delivery uses optional fields in the existing ledger, and preserves the existing
verification enum for rollback compatibility. An older release can still read the
file and conservatively display a delivered answer as unverified. A cold restart
preserves a valid delivery marker; a retry or new goal cannot reuse it, and backup
restore clears it. No new backup file or authority setting is introduced.

Conch's always-available `current_time` read tool samples UTC and records the exact
result through the existing operation wrapper. Codex app-server `currentTime/read`
requests use that same guarded tool and return the protocol's integer Unix seconds.
Wrong-thread, duplicate, cancelled and unavailable calls never sample the clock.
The queue and invocation cap bound requests. Other providers can call the same
host tool; old providers need no private transcript or internal tracing API.

Codex standard MCP, dynamic-tool and web-search item events are normalized into
Conch tool events, including a completion received without a start. Host calls
already executed locally are excluded; duplicate completions cannot replace a
failure. Names, event counts and output are bounded. ConversationManager's
observation hook records these calls even when a provider did not request an
approval. Observation is telemetry only: it cannot skip the execution guard or
replay checks. Remote `readOnlyHint`, descriptions and success text never establish
trusted effect declarations or receipts. Opaque tools stay opaque.

Threat model: untrusted models may claim success, supply weak criteria, replay
notifications or label an effect as a read. A delivery marker establishes only
that an answer was saved; criteria established before execution are evaluated
against host evidence, never the answer. Every external effect retains its prior
permission and receipt requirements. Tests cover empty replies, stale goal/attempt
markers, backup and cold restart, malformed helper batches, exact argument checks,
clock routing and denial, missing/duplicate provider events and an observation
arriving before a rejected replay. Existing process-death tests exercise recovery
before dispatch, after an external effect and after a persisted receipt.

Sources reviewed: the Codex app-server protocol's
[current-time request](https://github.com/openai/codex/blob/2dae757b8713d3317e8da58828bdac821386982c/codex-rs/app-server-protocol/src/protocol/v2/current_time.rs),
[standard item events](https://github.com/openai/codex/blob/2dae757b8713d3317e8da58828bdac821386982c/codex-rs/app-server-protocol/src/protocol/v2/item.rs),
and [clock forwarding](https://github.com/openai/codex/blob/2dae757b8713d3317e8da58828bdac821386982c/codex-rs/app-server/src/current_time.rs);
[OWASP Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html)
for fixed transaction data and server-controlled sequencing.
