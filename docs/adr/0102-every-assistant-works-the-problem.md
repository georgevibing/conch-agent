# 0102 — Every assistant works the problem

- Status: accepted
- Date: 2026-10-07
- Builds on: [ADR 0071](./0071-evals-on-every-model.md) (evals),
  [ADR 0072](./0072-every-model-gets-its-tools.md) (precise tool errors),
  [ADR 0085](./0085-long-jobs-that-finish-and-cost-less.md) (the turn watch and its nudges),
  [ADR 0086](./0086-lean-mode-for-small-models.md) (lean mode),
  [ADR 0100](./0100-permission-modes-every-provider.md) (permission modes)

## Context

Conch promises to fix what breaks before anyone notices (working agreement 11). The
code kept that promise; the assistant often didn't. Depending on the provider, a model
would stop at the first failed command, take "no invoices found" for an answer, run the
very same step again, or say "done" without looking. How hard an assistant worked a
problem depended on which provider's own prompt happened to be underneath, and the
browser's prompt was the only place Conch said "try once more another way".

Two things in the product made it worse:

- **Errors went missing.** The ACP door (Copilot, Gemini CLI, Grok) and Codex's tool
  calls answered any thrown error with "The tool could not complete", so the model
  guessed. Errors thrown by Conch's own tools didn't count in the turn watch for agents
  that run their own loop, so its "the last 4 tool calls failed, step back" never came.
- **A dropped app stayed dropped.** For model APIs, Conch connects each MCP app for the
  turn. A connection that failed for a passing reason was given up at once, and one that
  dropped mid-turn failed every later call.

## Decision

### One way of working, in every assistant's instructions

`conversations/resilience.ts` holds `RESILIENCE_PROMPT`, a short block under the heading
"How you work on a problem". The manager puts it into every turn's system prompt right
after who the assistant is, for every provider (it travels in `systemAppend`, which
Claude Code appends to its preset, Codex takes as developer instructions, the ACP
programs read through the door or the preamble, and the model APIs send as the system
prompt). Tasks and routines get it the same way; a task's brief adds that, with nobody
to ask, it names what only the person can do in its result.

The behaviours, distilled from published practice:

| Behaviour                                                         | From                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Work out the goal and what "done" means; ask only when it matters | Gemini CLI's understand → plan → implement → verify; GPT-5 guide on eagerness                                |
| A short plan, and a sentence before long work                     | GPT-5 guide, "tool preambles"; ReAct (Yao et al., 2022): reasoning between actions                           |
| Read the error, name the cause, check it, change something        | Self-Debugging (Chen et al., 2023); Reflexion (Shinn et al., 2023): reflect on a failure before the next try |
| Escalate the approach, not the effort; bounded retries            | Anthropic, "Building effective agents": ground truth each step, stopping conditions                          |
| An empty result is a clue                                         | SWE-agent (Yang et al., 2024): agents accept bad observations unless told what they mean                     |
| Verify before claiming done                                       | Claude Code and Codex prompts: run the tests, never claim unseen success                                     |
| Stop for approvals, sign-ins, keys, spending, real choices        | GPT-5 guide: separate safe from unsafe actions; Anthropic: pause at checkpoints and blockers                 |
| When stuck: what was tried, what's in the way, one next step      | Working agreement 11: "Never a dead end"                                                                     |

It is written for the person's interests, not the provider's: it never outranks the
permission mode (Conch still asks where the mode says), a no is never worked around,
and plan mode investigates as hard but changes nothing. It says nothing about voice;
the persona says how it talks. Personas compose it as base → resilience → persona →
instructions → memory and goal.

### Three forms, because every word costs every turn

- **The whole block** (about 1.8 K characters, some 450 tokens) for a model with tools.
- **`RESILIENCE_COMPACT`** (about 0.5 K characters) in lean mode: `leanSystem` swaps it in and keeps
  its section, so a small local model still hears it.
- **`RESILIENCE_WORDS`** for a model that can only chat and for a guest in a group:
  think it through, check the reasoning, never invent. The API engine also swaps it in
  when a model's tools turn out unusable.

The block is the same every turn, so prompt caches keep it (ADR 0085).

### Errors the model can act on, and apps that come back

- `failureText` (engines/types.ts) is what a thrown tool error says to the model on every
  engine: its own words, bounded. The ACP door and Codex use it instead of the generic
  sentence.
- The turn guard counts a thrown host-tool error as a failure, and when the watch has a
  word to add, it goes into the error the model reads.
- The MCP bridge (`integrations/bridge.ts`) tries a connection once more when it failed
  quickly for a passing reason (a reset, a refused connection, a 5xx or 429), never for a
  missing program or a refused sign-in. A connection that drops mid-turn is opened again
  for the next call. A call the drop cut off is asked again by itself only when the app
  marks the tool read-only; otherwise the model is told it may or may not have happened,
  to check before repeating. A timeout says the app may still be working on it.

### Evals that fail a quitter

Four tasks join `pnpm eval`, each made so that giving up at the first failure fails:

- `other-way`: the CSV export the person names is down; the site's own page has the price.
- `misleading-empty`: the Ledger app finds nothing for "ACME Corp"; its customer list
  says "Acme Corporation".
- `flaky-tool`: the Ledger's exchange rate is busy the first time it's asked.
- `honest-blocker`: sending needs a setting only the account owner can change; passing
  means saying so, never "sent", in at most three tries.

`evals/persistence.test.ts` runs the Ledger ones through the real harness with two
scripted assistants, one that works the problem and one that quits, and requires a pass
and a fail. A stand-in engine signs every other provider out for the run, so a scripted
test can never fall back to a paid one.

## Consequences

- Every provider, persona and mode gets the same way of working; how it says so stays
  the persona's.
- About 450 tokens more per turn with tools (cached after the first), about 125 in lean
  mode.
- A dropped app costs one reconnect instead of the rest of the turn. A change is never
  repeated without the model deciding to.
- The rules live in one file; tests check the block reaches every provider in every mode,
  plan mode and tasks, and that the forms stay in step.
