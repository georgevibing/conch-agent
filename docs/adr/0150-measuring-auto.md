# 0150 — Measuring how often Auto asks

- Status: accepted
- Date: 2026-10-26
- Builds on: [ADR 0100](./0100-permission-modes-every-provider.md) (Auto asks only about real
  risk), [ADR 0117](./0117-auto-asks-about-what-matters.md), [ADR 0121](./0121-dashboards.md)
  (numbers only, private by default), [ADR 0128](./0128-auto-reads-what-you-asked-for.md),
  [ADR 0144](./0144-task-aware-auto-review.md)

## Context

AGENTS.md says a question about routine work in Auto is a bug. We could not see that bug.
Telemetry counted only `conch.auto.judgements`: what Auto decided at a few of its branches. It
did not count the steps Auto let through without a judgement, so there was no denominator.
Nothing said why a question reached a person, and nothing replayed real chats through the rules.
The corpus in `test/riskCorpus.ts` proves the rules on steps we wrote; it can't say how often
they stop the steps people's chats really take.

## Decision

**Two counters.** `conch.auto.steps` counts every tool call the guard judges, by the chat's
mode (`conch.mode`). `conch.auto.questions` counts every question that reaches a person while
the chat is in Auto, by one kind of reason (`conch.question.reason`). Questions per 100 steps is
`100 × questions / steps{conch.mode="auto"}`.

- The step is counted at the top of `guard`, the one place every provider's every call passes
  (Claude Code's PreToolUse, `authorizeTool` for the others, a script's calls).
- The question is counted in `askUser`, after Full trust has let it through, so it is a question
  someone sees. A question asked in another mode isn't counted here.
- Both are `ConversationDeps` hooks (`stepJudged`, `questioned`), one line each in the manager,
  wired to `TelemetryService.autoStep` and `autoQuestion` in `services.ts`.

**One kind of reason.** `conversations/ask-reason.ts` reads it from what the question already
carries: Explicit Ask, a price, Passwords, the browser, the class Always allow would lift
(`risk:<kind>:…`), and its words, matched against the same pure rules run again on the step
(`breaksCircuit`, `assessRisk`). The kinds are the risk kinds, plus `after-reading`, `pattern`,
`circuit`, `explicit`, `unavailable-review`, `browser` and `other`. The label is a word from that
fixed list; anything else becomes `_OTHER`. No command, argument or word is ever a label.
`unavailable-review` is only the case the question itself shows: someone else's app's step that
nothing could judge. Review outcomes and timeouts are counted by the review's own telemetry.

While here, `conch.verdict` now takes `lifted` as a word. It was sent as `_OTHER`.

**An offline replay.** `pnpm auto:replay [--home <dir>] [--since 30d] [--json] [--examples]`
reads this computer's own chat logs under `CONCH_HOME` and judges every recorded tool call again,
as Auto would have at that point in the chat:

- what the chat had read by then (`heldTaints` on the events before the step);
- the person's own words as `#yourWords` has them: none in a routine's run or a task, none once
  someone else's words are in the chat, and only since the context was last cleared;
- the circuit breaker, the patterns across steps (`behaviour.ts`), then `assessRisk` and
  `riskAsks` with what was read.

It reports the steps before and after reading, the steps the rules would ask about per 100 of
each, the kinds that fire most, and what people were really asked (`permission.requested`) with
how they answered (`permission.resolved`), by the same kinds.

It is read only. It never goes through the stores that repair files: it reads `index.json` and
`settings.json` as they are, and each log a line at a time with the store's own line reader
(`eventFromLine`), so a long log costs only the events the rules need, and a damaged line is
counted and skipped. No model, no network, nothing written. It prints numbers and kinds.
`--examples` adds a few steps per kind, through `scrubSecrets` and the trajectory redaction
(keys, emails, phone and card numbers, the home folder). The vault's redactor needs the running
gateway's unlocked keys, so it is out of reach here; that is why examples are off by default.

It is a root `pnpm` script, like `pnpm eval`, not a `conch` command: it is for people working on
Conch's rules, with a checkout.

## What it doesn't measure

- The second look and the task-aware review are a model's. The replay counts what the rules ask
  before any review, so after reading it is the most Auto could ask.
- The work folder is today's, from Settings. A task in its own worktree is judged against it,
  and what a project's manifest lists is read as it is now.
- An app tool's own declarations (`destructive`, read or write) aren't in the log. The replay
  reads the tool's name, as the rules do when nothing more is known.

## Consequences

- Auto asks nothing more. The counters only count, and the replay changes nothing.
- No stored data changes. Older logs replay as they are; lines they don't know are skipped.
- The corpus benchmark stays in `risk.test.ts`. `replay.test.ts` checks the replay agrees with
  it (routine work never asks, before or after reading; the adversarial half always does) and
  prints the corpus as the replay sees it when `CONCH_AUTO_RATE=1`.
