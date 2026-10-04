# 0071 — Evals on every model

- Status: accepted
- Date: 2026-10-04
- Goes with: [ADR 0012](./0012-every-provider-at-once.md) (every provider at once),
  [ADR 0049](./0049-every-app-works-with-every-model.md) (every app works with every model),
  [ADR 0050](./0050-models-that-cannot-use-apps.md) (models that can't use apps),
  [ADR 0053](./0053-more-providers.md) (more providers), [ADR 0014](./0014-browser.md) (the browser),
  [ADR 0069](./0069-carrying-a-chat-on.md) (carrying a chat on, which the `switch` task measures),
  [ADR 0070](./0070-every-model-sees-the-page.md) (every model sees the page, which `canvas` measures)

## Context

Conch promises that whichever model runs underneath — Claude Code, Codex, a key-based API, a
model on this computer — the browser, apps, memory, `ask` and a chat that moves between models
all work the same. Until now nothing measured that. `pnpm check` and `pnpm e2e` drive a scripted
mock engine: they prove Conch's own plumbing, never what a real model does with it. Bugs that
only a real model shows (a weak tool-caller that sends bad arguments, a provider that rejects a
schema, a model that can't see a screenshot, a task longer than the step limit) were found by
people, one at a time, after the fact.

## Decision

An eval suite, `pnpm eval`, runs a fixed set of tasks on about ten real models and checks each
result with code.

### Through Conch itself

Each task runs in a whole Conch (`Services`, the same as the gateway's) in a throwaway home:
the real engine for the provider, behind the same `Engine` interface the app uses, with the real
conversation manager, browser, apps, memory and questions. The only thing played by code is the
person:

- **Approvals** go through a scripted approver (`evals/approver.ts`) that denies by default. It
  approves only what it can classify field by field and that stays inside the run: the browser
  on the fixture site's exact origin (no credentials in the URL, no lookalike hosts), the run's
  own pretend app, Conch's own state tools, a file tool's one path field when its real path is
  inside the throwaway home (no `..`, symlinks resolved), and a fetch's one `url` field on the
  fixture origin. Shell and exec tools are always refused: the suite has no sealed box with the
  network off to run them in. Every refusal is recorded and fails the task: an agent reaching
  outside the task is a finding. Permission mode is `default`; `bypassPermissions` needs
  `CONCH_EVAL_ALLOW_BYPASS=1`, and even then only in a throwaway home.
- **Question cards** are answered by the task's script.
- **A sign-in handed over** (`browser_handoff`) is done by the harness in the page itself, the way
  a person uses the live view, then handed back.

A run's home must be a new folder inside the system's temporary folder, never `~/.conch` or the
`CONCH_HOME` in the environment (`unsafeHome`; the harness refuses to start otherwise). Keys come
only from the environment, one per provider, and the device key is a file in the throwaway home,
never this computer's keychain. Nothing of a real person's Conch — memories, sign-ins, apps — is
read or touched. So Codex runs with an OpenAI key, never a copied ChatGPT sign-in.

Every engine is wrapped as it runs (`tapped`) so each tool call is counted from the stream; the
turn's own `usage` gives tokens and cost (the provider's figure, else list price from
`usage/prices.ts`; none when neither is known).

### Deterministic tasks on local fixtures

The fixtures are a small web site on a free port of this computer (`evals/fixtures/site.ts`) and
"Ledger", a stdio MCP server added the way a person adds their own (`evals/fixtures/ledger.ts`).
The tasks (`evals/tasks.ts`):

| Task            | What it proves                                                                |
| --------------- | ----------------------------------------------------------------------------- |
| `form`          | Fill text, email, a list, a tick box and a long answer, then submit           |
| `deep-find`     | Find a value two pages deep, ignoring a look-alike                            |
| `app-tool`      | Call an app's tool and add up what it returns                                 |
| `memory`        | Save a fact in one chat and recall it in another                              |
| `ask`           | Ask the person with a question card, not a list in prose, and use the answer  |
| `canvas`        | Read a number that is only pixels (vision, or a description of a screenshot)  |
| `handoff`       | Hand a sign-in to the person, then carry on                                   |
| `upload`        | Choose a file from the workspace in a file input                              |
| `long`          | More than thirty browser actions in one task                                  |
| `malformed-mcp` | Call a tool whose schema has a `$ref`, a type list, a `null` enum, no `items` |
| `switch`        | Another model starts the job, this one finishes it in the same chat           |

Every check reads what the fixtures recorded (the form the site received, the list it saved, the
file it got, the calls Ledger got), what Conch stored (memories, question cards, handoffs), or
fixed values in the answer. No model grades another: an LLM judge would add its own variance and
its own bill, and every task here has an answer code can check.

### The matrix, in one file

`evals/models.ts` lists the models: Claude through the Anthropic API, OpenAI, Gemini, DeepSeek,
Mistral, a mid-tier and a weak model through OpenRouter, a small model on this computer through
Ollama, Claude Code and Codex CLI. Each lists model ids in order of preference; the first the
provider lists is used, so a renamed model falls through instead of failing the run. A model
whose key, program or local model isn't here is skipped with the reason, never an error.

### Results and the report

Each run writes `runs/<id>.json`, `latest.json`, `report.md` and `report.html` (to `.evals/` by
default). The report puts the models side by side (pass or fail, steps, tokens, cost, time), lists
why each miss missed, and compares with the run before: regressions first, then a task that got
a quarter costlier or slower, then fixes. In CI the Markdown is the job's summary.

### CI

`.github/workflows/evals.yml` runs the full suite nightly and on demand (`workflow_dispatch`,
with a choice of models and tasks), using repository secrets for the keys, and compares with the
last full run's results (downloaded as an artifact). Pushes to `main` run the smoke subset (the
cheap tasks on the cheap smoke model) when the repository variable `EVALS_SMOKE` is `true`; a
missing key skips the model, and the summary says so. A run stops starting tasks once it has
spent `--max-usd` (10 dollars by default).

The workflow holds real keys, so it is held tighter than the others: it never runs for pull
requests (no `pull_request`, no `pull_request_target`), so a fork's code never sees a key, and
only in this repository; every action is pinned to a full commit with its version beside it; the
secrets reach only the step that runs `pnpm eval`, never a job's or the workflow's environment;
checkout keeps no credentials; and the token can only read.

The suite is never part of `pnpm check`: it spends money and depends on outside services. Its
own logic — the checkers, the approver, the matrix, the fixture site, the report — is tested
there like any other code (`evals/*.test.ts`).

## Consequences

- "Works on every model" becomes a number per model and task, with a history. A change that
  helps weak models (tool-call repair, a describer for screenshots, a higher step limit) shows up
  as cells turning green; a change that breaks one shows up red the next morning.
- Real runs cost money and are not perfectly repeatable: a model can pass one night and fail the
  next. The report shows reasons, so a flaky cell reads as such; repeated runs per cell are a
  later step if noise hides real changes.
- Adding a model is a row in `models.ts`; adding a task is an entry in `tasks.ts`, with its
  fixture and a checker that code can run, and a unit test for the checker.
- The approver refuses whole classes of tools (shell, unknown tools, unknown fields). A model that
  reaches for them fails the task even when it would have been harmless; that is the point.
