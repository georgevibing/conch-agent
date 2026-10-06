# 0097 — Proactive memory maintenance

Date: 2026-10-06. Status: accepted. Amends ADRs 0032, 0087 and 0088.

## Problem and decision

A chat that had read GitHub or Yazio produced ordinary facts from the owner's own
messages, but nightly tidying required Keep on each. Even applied changes showed
Keep. Length over 300 characters also caused security holds. These are routine
maintenance decisions the assistant should handle, visibly and reversibly.

Owner-backed preferences and corrections apply with Undo, including private owner
channels and updates of manually entered facts. Outside-reading provenance stays
attached, but is not by itself a reason to ask. Quiet learning still needs a real
owner quote and matching content. Unsupported instructions, secrets, health or
financial details and one-task permissions are dropped. Existing per-look proposal
and spending limits remain; arbitrary daily counts no longer turn routine facts
into a queue of approvals.

The remember tool accepts up to 2,000 characters, checks the original, removes
exact repeated sentences, then may ask its existing cheap completion model once
to shorten wording. Discovery and completion share a five-second deadline; missing,
failed, malformed, late or lossy answers fall back to the original cleaned text.
A candidate must preserve substantive tokens in order, names, numbers, destinations
and negation, and pass the guard again. This deliberately rejects many paraphrases.
It is a conservative text check, not a proof of semantic equivalence. Length alone
is no longer a hold. Tidying may also shorten existing text under these rules.

Applied tidy changes say Saved automatically and offer Undo. Keep appears only on
pending decisions. Old routine holds can be rechecked at startup, every fifteen
minutes when idle, and before a tidy-up. The pass reads owner messages from the
last fourteen days and considers at most fifty stored memories and fifty proposals.
Only known legacy housekeeping reasons (including a length-only hold) qualify;
real security holds, imports, user records, previous refusals and disabled-learning
proposals do not. No model selects consent. The store checks exact current wording,
owner evidence, values and security again under its write lock. The existing ledger
and chat card are settled quietly, preserving Undo. Unknown evidence stays pending.
No new setting, provider-specific path or protocol enum is added.

## Threat model and boundaries

An attacker controls pages, mail, tool output, imported data or a generated memory
candidate, hoping to turn that into a durable instruction, destination or permission.
The attacker does not control authenticated owner messages, the store's seal key,
or person-consent tokens. Owner text can still quote misleading material; lexical
evidence is not a complete prompt-injection defense. Tool authorization remains
outside memory: stored words grant no permissions or trust.

- Every memory write still crosses the existing store guard. Security holds cannot
  be cleared by compaction, a model's verdict, a normal update or legacy repair.
- Rechecks use host-read evidence and exact-word checks. They retain provenance;
  they never mint the route-only person-consent token. Changed words are not replayed.
- Compaction checks the original before any transformation. Outside-derived text
  is not relabeled as owner text when shortened.
- Forgotten memories are checked before automatic additions, updates and repairs;
  failures to read this policy fail closed. Repair also respects learning being off.
- Nightly learning and repair exclude chats marked quiet, guests/person-tainted
  conversations, routines, delegated tasks, artifacts and app-client prompts.
- Shortening times out even when a provider ignores cancellation. The candidate
  cannot write anything when it arrives late. Offline lossless cleanup still works.

The remaining lexical and model false-negative risks are those of layered memory
screening, not an authorization boundary. Security decisions about sending, spending,
execution and access continue through their own host-side checks.

## Evidence and validation

Primary sources consulted 2026-10-06:

- [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html):
  untrusted-content separation, least privilege, action-level authorization and
  evaluations of both attacks and false positives. Blanket confirmations for
  harmless facts create friction without replacing those boundaries.
- [MINJA: Memory Injection Attacks on LLM Agents via Query-Only Interaction](https://arxiv.org/abs/2503.03704)
  (v5, 2026): persistent malicious records can be induced through ordinary-looking
  interactions. This motivates preserving provenance and forbidding memory-derived
  authority even as benign owner facts become automatic.

Regression coverage includes outside-reading owner facts, channels, corrections,
Undo, grounded quotes, one-task authority, never-again policy, legacy holds across
restart, stale updates, parallel rechecks, forgotten/off/unavailable-policy cases,
synthetic sources, lossy/malicious compaction, nonresponsive model discovery, and
existing injection/consent/seal attack tests. UI checks cover automatic labels and
Undo in both themes, plus the existing accessible pending security decision.
