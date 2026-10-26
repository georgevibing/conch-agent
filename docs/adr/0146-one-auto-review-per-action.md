# 0146 — One Auto review per action

- Status: accepted
- Date: 2026-10-26
- Builds on: [ADR 0100](./0100-permission-modes-every-provider.md) (Auto's risk policy, the
  second look), [ADR 0117](./0117-auto-asks-about-what-matters.md) (judged beside what the
  person asked), [ADR 0118](./0118-auto-judges-every-app-step.md) (a step in someone else's
  app), [ADR 0128](./0128-auto-reads-what-you-asked-for.md) (the person's words, a hold),
  [ADR 0144](./0144-task-aware-auto-review.md) (task-aware review)
- Amends: ADR 0144's "a held owner instruction rejects the action" and "neither model verdicts
  nor clean-tree checks are cached across calls"; ADR 0100's and ADR 0118's separate second
  looks (`risk-look.ts`, removed)
- Works with: ADR 0147 (the fast reviewer each provider declares), ADR 0149 (the environment
  note)

## Context

One action in Auto could pass up to three model reviews in a row, with two rubrics, and the
same chain again on the permission path:

1. the second look's `serves` (`judgeCommand`), which could lift a question asked only for
   what was read;
2. the same look again as `secondLook`, for a command the rules found nothing in, run after
   `serves` lifted;
3. `judgeStep` (`lookAtAppStep`), for a step in someone else's app;
4. `autoDecision` (`reviewAutoAction`), the task-aware review of ADR 0144, on whatever
   question was left.

The looks had 6 s deadlines and the task review 8 s, so a command after reading could wait
20 s on the guard's path alone. Claude Code asks through its PreToolUse hook and again through
`canUseTool`, and nothing was reused between them: up to six calls and 40 s for one step,
each on the turn's own model, which is often the largest one. Two rubrics could disagree
about the same step. A step the person had said not to do ("don't push yet") was refused with
"do not retry", where AGENTS.md security rule 11 says it asks until they say otherwise.

## Decision

**One reviewer.** `auto-review.ts` has one system prompt and one strict schema,
`{decision, risk, reason, kind, evidence}`, for a command and a step in an app alike. The
rubric is ADR 0144's (owner messages with ids, evidence, allow, replan or ask) with ADR 0117's
judgement after reading folded in: what the chat read may supply details, never permission;
an action is unasked when it serves nothing in the request and looks steered by what was read.
`kind` names the risk, so the card says why in Conch's words (`verdictWords`, the second
look's old phrases). The Gmail send-boundary review is the same reviewer, given the
connector-verified sender.

**The same hard guarantees.** Strict JSON with duplicate keys rejected; no allow that is severe
or unknown, cites no owner message, or names a kind of risk. Without owner messages there is
no allow, so there a review can only add a question. Bands are where they were: the task review
lifts only what `reviewableRisk` allows, `serves` only a command question asked for what was
read (`contextualRisk`), and where the rules found nothing the review only adds a question
(its allow there just means none). A mutation of the arguments, the owner's words or the mode
during review, and Stop, invalidate it. Off and explicit Ask are read again after it. The
browser's page is checked again before a click. `AutoReplans` still ends a run of unsafe
proposals; once it has, `serves` lifts nothing more either.

**Two stages**, as Claude Code's auto mode classifies. When the turn's provider declares a fast
reviewer (`deps.fastReview`, ADR 0147), it is asked first, with the same rubric and one short
instruction: allow only what is clearly routine and authorized. Its allow stands, under every
guarantee above. Anything else, or no answer, goes to the turn's own model (`deps.autoReview`)
with the full rubric. The fast stage never refuses or asks by itself. It gets half the full
stage's 8 s deadline, so the worst case for an action is 12 s, once.

**Start early, reuse narrowly.** The guard (PreToolUse) starts the review of a call that is
likely to need one, before the undo snapshot and the rest of its checks, and every later look
at the same action awaits the same promise, through to the permission question. Verdicts are
kept for the turn, keyed by `reviewKey`: the tool and its canonical arguments, the mode, a hash
of the owner's words, what the chat read, the environment note, what the rules found, the app
step, and the sha256 of every file the command could run (`python3 x.py`, `node x.mjs`,
`./x`, `pnpm exec tsx x.ts`, a project's `package.json` or `Makefile`). A file that isn't there
is a state too; one that can't be read binds the verdict to that one call. Any change is a new
review. A mode change forgets every verdict, and Stop ends the turn and them. OpenClaw binds an
approval to the hashes of what it runs; Codex's guardian reuses a verdict while the
authorization evidence is unchanged. Conch does both, within one turn.

**A hold asks.** A step the person said not to do asks them, on a card that says so: "You asked
me not to push code to a remote. So I'm checking before I do it now." Their Allow is for this
once. No review lifts a hold, and none refuses it.

**The environment note.** `preferences.autoEnvironment`, which only a person writes in
Settings (ADR 0149), goes to the reviewer as owner-written context, quoted as data apart from
the owner's messages. It may say which hosts, remotes and buckets are theirs and what
production means. It can't be cited as evidence and never authorizes a hard rule.

Each stage reports how it ended and how long it took (`deps.reviewed`, numbers only). The
`judged` counters keep their meaning.

## Threat model

The reviewer reads a page's words and the agent's arguments, so it can be steered. A steered
allow is bounded as before: keys, a stranger's code, money, an assistant's own permission
files, the circuit breaker, `NEVER` risks, protected paths, tools turned Off, explicit Ask,
guests and holds never reach a lift. The fast stage is a smaller model and easier to steer; it
gets the same bands, may only allow, and isn't asked without owner messages. Tests make both
stages answer allow to the adversarial corpus: what the hard rules mark still asks.

A cached verdict could be replayed for a different action. The key covers everything the
verdict judged; the arguments are copied before review, so a change while it runs can't reach
the verdict, and the key is computed from the copy. Reuse stays inside one turn.

A script can change between review and execution. Hash binding means a changed script is a new
review; it does not make execution atomic, which ADR 0144 already says. The scan of what a
command runs is a guess on the wide side: a module a script imports isn't hashed. That is
accepted because the reviewer never read the script's contents anyway (ADR 0144).

Starting early spends a model call on a guess: a call the later paths don't need is wasted
money, never a weaker decision.

This is stricter in three places, each because a hard guarantee says so. A mail with a key in
it at Gmail's send boundary is no longer lifted by the step look's "not risky". A question
asked only for what was read needs an owner message as evidence to be lifted, so a task without
owner words (until ADR 0149 gives tasks theirs) keeps its question. After three unsafe
proposals in a turn, a command question is no longer lifted.

## Consequences

One model call per action, usually from the guard, often on a fast model. The guard and the
permission question agree, because they read the same verdict. `risk-look.ts` is gone; the
`riskLook` dependency is only the older name for `autoReview`. Engines without a fast
reviewer run the full stage alone, as before.

## Sources

- Anthropic, Claude Code auto mode: a fast first-stage classifier, and a second stage with
  reasoning only for what the first flags; the second clears work the person asked for.
- OpenAI Codex, the guardian approvals reviewer (V2): reuses a low-risk verdict for its
  session while the authorization evidence it was given is unchanged.
- OpenClaw c9db73543a42d3e53e23c8b70c3997bc5d4a0fff,
  `src/infra/exec-approvals-authorization.kernel.ts`: an approval bound to the hashes of the
  executable and files it runs.
- [ADR 0144](./0144-task-aware-auto-review.md): task authority, evidence and the replanning budget.
- OWASP LLM Prompt Injection Prevention Cheat Sheet; Greshake et al., 2023 (indirect prompt
  injection); Hines et al., 2024 (spotlighting, datamarking).
