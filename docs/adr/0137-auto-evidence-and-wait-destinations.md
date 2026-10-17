# 0137 — Auto uses current evidence; wait notifications choose one destination

- Status: accepted
- Date: 2026-10-17
- Builds on: ADR 0100, ADR 0125, ADR 0128

## Problem

A local shared clone followed by restoring its source repository's HTTPS origin
was classified as redirecting code to a new destination. Explicit authorization
also expired on an unrelated follow-up message. Separately, a wait's tell flag
sent the result to every channel enabled for routine notifications.

## Decision

Auto keeps explicit authorization in the current chat context until a later
statement about that operation replaces or revokes it. Named targets still
have to match. Clearing the chat removes both grants and boundaries. This
does not enable new tools or bypass mandatory guards.

For a plain remote set-url, the gateway reads fresh local Git fetch and push
destinations. Identical HTTPS destinations, including restoring origin in a
new local shared clone, add no new reach. Unknown destinations, different
owners on the same host, config overrides, helper protocols, credentials,
extra push URLs and complex shell forms retain the ordinary decision.
No model is asked to guess repository ownership. These reads are bounded and
local, with no network requests. Git tree cleanliness is also read afresh:
a clean result from earlier in a turn must not authorize discarding newer work.

The existing semantic review remains for ambiguous operations. It receives
the complete command and request up to 12,000 characters each, or returns no
verdict. The same rule covers app arguments. A safe-looking prefix can never
clear a rule about a hidden suffix. Hard prohibitions and the user's negative
instructions remain enforced outside the model.

Wait completion stays in the current conversation by default. External delivery
requires an explicitly named app, resolved unambiguously to one channel ID.
The ID survives restart. A disconnected destination fails without rerouting or
retrying an uncertain send. Old waits with only tell=true cannot broadcast.
Routine notification preferences no longer control wait delivery.

## Verification and limits

Focused regressions cover routine and adversarial Auto inputs, continuing and
revoking authorization, identical versus different Git destinations, incomplete
model reviews, wait restarts, cancellation and single-destination routing.
These are deterministic checks, not a claim that a model classifier catches all
malicious instructions. Broader checks run in CI, not on the user's machine.

## Sources

- OWASP LLM Prompt Injection Prevention Cheat Sheet, read 17 October 2026:
  https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
  Complete tool argument validation, scoped authority, independent execution
  controls and adversarial tests; a model guard is only one layer.
