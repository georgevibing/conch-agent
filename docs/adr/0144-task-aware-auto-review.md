# 0144 — Task-aware Auto review

Date: 2026-10-25

## Decision

Auto's deterministic fast path stays cheap. Before an eligible permission question, one shared reviewer evaluates the complete action and chronological owner messages from the durable conversation log. Earlier same-task instructions can establish authority; later constraints win. Synthetic task/routine messages and chats with other speakers supply no owner authority. Owner text remains data: quotations are not grants.

The reviewer uses the turn's provider and selected model, rather than selecting a security decision model by cheap-sounding names. It can allow a low/moderate-risk action once, reject it for replanning, or preserve the question. Strict JSON rejects duplicate keys, contradictory allowance, unknown fields and invalid evidence ids. Inputs exceeding the context budget do not get clipped allowances. A deadline covers model acquisition and completion, including providers that ignore cancellation.

Model review cannot waive explicit tool Ask, Off, credentials, exfiltration rules, safety changes, privilege escalation, remote code, spending, persistence or critical destruction. The existing execution and protected-path guards remain authoritative. A held owner instruction rejects the action. Repeated model rejections exhaust a runtime review budget rather than escalating into a human prompt. Ordinary fast-path work remains available.

Neither model verdicts nor clean-tree checks are cached across calls. During review, changed arguments, changed owner context and Stop invalidate the result. Integration policy is read again after review. This is not a claim of OS-level binding for arbitrary provider-native shell scripts: those still rely on the existing sandbox and execution boundaries.

## Threat model and limits

Pages, files, tool descriptions and other agents can propose actions or forge instructions. They cannot be promoted to owner authority. Review is defense in depth, not a security boundary replacing confinement. Unavailable or oversized review preserves the prior policy. An ordinary-looking mutable script is not proof of its contents; its model verdict cannot guarantee that contents will not change before execution.

No stored permission is broadened or new durable power introduced. Existing judgement counters record task-review allowances/questions without storing prompts or secrets. Focused tests cover reviewer contracts, bounded cancellation, malformed and duplicated JSON, authority evidence, hard restrictions, and native/bridged/host permission paths. Mocked decisions test enforcement, not model attack resistance.

## Comparative audit

Hermes v0.22.5 reviews flagged commands with a terse classifier, but lacks task context in that path and can ask a human after a denial. OpenClaw c9db73543a42d3e53e23c8b70c3997bc5d4a0fff separates allow/deny/ask, supplies richer context and revalidates prepared execution. Conch adopts task context and distinct internal replanning while preserving its multi-tool guards. OpenClaw's prepared executable/file binding remains stronger than a review of an arbitrary provider-native shell command. No market-leading accuracy claim is justified without real-model comparative evaluation.

Sources inspected 2026-10-25:

- https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- https://github.com/openclaw/openclaw/blob/c9db73543a42d3e53e23c8b70c3997bc5d4a0fff/src/agents/exec-auto-reviewer.ts
- https://github.com/openclaw/openclaw/blob/c9db73543a42d3e53e23c8b70c3997bc5d4a0fff/src/infra/exec-approvals-authorization.kernel.ts
- Hermes installed source bf0203a794a07aac3ff764972ab9087baa4e4f4e, tools/approval.py and tools/approval_smart.py.

## Second audit pass

Rebased onto main 692fa6b1 before validation. Main already preserved follow-up authority, fresh Git-tree state and complete second-look inputs (ADR 0137); those changes are retained, not reintroduced as new features here. The new work removes cross-call model verdict caching and introduces structured task review across eligible native, bridged and host-tool questions.

The authorization adapter now detects changes to both original and normalized arguments while awaiting a guard or permission. This closes the mismatch exposed by an executable regression test. A valid task-review ask cannot be cleared by an older fallback reviewer. Non-liftable risk rules remain non-liftable even within an otherwise eligible category.

A resolved communication click in Conch's isolated browser can supply a complete, redacted page to the same reviewer. The host re-reads it and checks exact equality immediately before proceeding. Long/failed snapshots, uploads, coordinate clicks, typed-but-unapplied payloads, shared personal browsers and non-communication controls retain their existing checks. Page state is untrusted evidence, not permission. This is a best-effort state check, not a transaction with the remote service. Tests exercise both the real snapshot boundary and changed-page refusal.

The older second-look path also uses the current turn's provider/model. It no longer consults the default provider's cheapest name match. Permission review never silently falls over to an unrelated provider.
