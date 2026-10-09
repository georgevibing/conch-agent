# 0125 — Waiting without polling: Conch watches, the model sleeps

- Status: accepted
- Date: 2026-10-09
- Builds on: [ADR 0072](./0072-every-model-gets-its-tools.md) (every model gets its tools),
  [ADR 0033](./0033-hand-it-off.md) (tasks come back to their chat),
  [ADR 0094](./0094-staying-responsive.md) (managed commands),
  [ADR 0102](./0102-every-assistant-works-the-problem.md) (how every assistant works a problem),
  [ADR 0103](./0103-the-chat-tells-what-the-assistant-is-doing.md) (stories and the "going round in circles" line),
  [ADR 0060](./0060-the-chat-knows-conch.md) (the chat's manners)

## Context

"Monitor CI and fix it if it fails." The assistant pushed, then waited the only way it had:
it checked. The chat showed "Checking on a command · 2m 20s", an amber line "Checked on it 4
times in 2 minutes and nothing changed", "5m 16s · 2 steps" in the footer, and "Conch is
working…" in the box. Every check was a model step that re-read the whole chat to learn
"still running", and the chat was held for as long as CI took.

How other agents wait:

| Prior art                                         | What it does                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code                                       | Background Bash (`run_in_background`), read with `TaskOutput`. `Monitor` turns a script's output lines into events (5 min deadline by default, 30 at most). Self-paced `/loop` ends each pass with `ScheduleWakeup` (1 min to 1 h), which fires only between turns.                |
| Codex                                             | "Unified exec": `exec_command` and `write_stdin`. An empty `write_stdin` is a poll that may block for up to 5 minutes (`background_terminal_max_timeout`). The model still polls, but rarely.                                                                                      |
| Cursor cloud agents                               | Subscriptions: subscribe to an event, end the turn, and resume in the same conversation when it arrives. A CI subscription waits for every check on a commit and delivers one result, with the failed checks' names. Events close together wake it once. Timer and cron kinds too. |
| Devin, GitHub Copilot coding agent                | Event driven: PR comments and a "Fix with Copilot" press start or reach a session. Nothing sits waiting.                                                                                                                                                                           |
| `gh run watch`, `gh pr checks --watch`            | Blocking watchers that poll every 3 s and 10 s. `--exit-status` and `--fail-fast` exist. Good primitives, but far too frequent to leave running for an hour.                                                                                                                       |
| GitHub `workflow_run`, `check_suite`, `check_run` | Webhooks need an address GitHub can reach. Conch usually has none. The REST API allows 5,000 requests an hour with a sign-in and 60 without. A conditional request answered 304 doesn't count. `x-poll-interval` and `retry-after` say when to ask again.                          |
| Exponential backoff and jitter                    | Backoff without jitter does worst. Jitter spreads the callers. Reset the backoff when something changes.                                                                                                                                                                           |

The lesson is Cursor's: subscribe, end the turn, let the harness watch, wake once with what
changed, and re-read before acting. A model call per look is the waste.

## Decision

### 1. `wait_for`, a host tool for every provider

`wait_for` is one of Conch's own tools, so every provider with tools has it (ADR 0072). It
takes a `kind`:

- `ci`: GitHub checks for one commit, pull request or run. Give a `url` (a run or PR on
  github.com), or a `ref` (a PR number, branch or commit) with `repo`. With neither, it
  uses the work folder's checked-out commit and its `origin`. `fail_fast` wakes at the
  first failure.
- `process`: a command this chat started with `process_start`. It waits until the command
  exits, or until it prints a line matching `pattern`.
- `url`: a public page, until it changes, or until it `contains` some text.
- `time`: `minutes` from now, or `until` an ISO time.

Watchers are cheap looks (`waits/watchers.ts`), and none calls a model. CI reads only states
and names: a run and its jobs (`/actions/runs/{id}` and `/jobs`), or a commit's check runs
(`/commits/{sha}/check-runs`). The logs are left for the model, and the summary tells it how
to read them (`gh run view <id> --log-failed`). GitHub is read the cheapest way available
(`waits/github.ts`):

1. GitHub's own program, `gh api -i`, when it's installed and signed in. That's the person's
   sign-in, and Conch never sees the token.
2. Otherwise the token of the GitHub app connected in Apps (`IntegrationService.tokenOf`). It
   goes only to `api.github.com`, through the guarded fetch, and is never shown to the model
   or a log.
3. Otherwise nobody's sign-in, for a public repository, with a slow pace (60 an hour).

Every look sends the last `ETag`, so an unchanged answer is a free 304. A server's hint
(`x-poll-interval`, `retry-after`, or the limit's reset) always wins over Conch's own pace.

**The pace** (`waits/pace.ts`) starts soon (15 s for CI, 30 s for a page). Each unchanged look
multiplies the gap by 1.6, up to 2 minutes for CI and 5 for a page. The gap goes back to soon
when something changes (a job finishing counts), and each one gets ±15% jitter. A command is
watched live instead: `ProcessService.onChange` tells the wait when the command prints or
ends, so there's no clock. A time sleeps until it comes.

**A deadline** ends every wait: 60 minutes by default for CI and pages, up to 6 hours for CI
and a day for a page or a time. A command's wait ends with the command's own 30-minute limit.
When a commit still has no checks after ten minutes, the wait ends with "No CI ran for this
commit".

### 2. Let go of the turn, unless it can't be

Two choices: keep the turn open while Conch sleeps inside the tool call, or end the turn and
wake the chat later. Each fits a different case:

- **In a chat someone is in, a wait for CI, a page, or a time more than two minutes away lets
  go.** The tool looks once (if it's already over, it answers at once) and then returns: "End
  your turn now". The assistant says in one line what it's waiting for, and the chat is free.
  The wait is saved in `waits.json` and carries on after a restart. When it ends,
  `ConversationManager.wake` starts the next turn with "[Conch] A wait you started has
  ended: …" and the summary. That turn starts at once if the chat is free, or when the running
  turn ends. It's never a message of the person's. This is ADR 0033's "tasks come back to their
  chat", for waiting. We chose it over holding the turn for four reasons:
  - The chat isn't held for an hour.
  - No provider's tool-call timeout comes into it.
  - It survives a restart.
  - It costs nothing extra: after five minutes the provider's prompt cache has gone cold either
    way, so a long tool call saves nothing.
- **A command, a short time, or a run nobody watches holds the turn.** A managed command stops
  with its turn (ADR 0094), so its wait can't outlive the turn. The same goes for a task, a
  routine, or a chat app, because waking them would answer nobody, or end a task early. The
  call stays open while Conch sleeps. It returns what changed, and stops when the turn stops.
  Queued messages and steer still work.

A chat has at most 4 waits at a time, and Conch 32 in all. The same thing asked again is the
same wait. Stop on a running turn doesn't end a wait that let go: the row has its own Stop
waiting. A deleted chat takes its waits with it, and Repair everything stops orphaned waits
("Waiting for things").

### 3. One calm row

A `wait` event (`@conch/protocol` `WaitNote`) is appended when the wait starts and each time
it changes. A clocked wait also appends one at each look, because its next look moved. The
web folds them into one row (Nacre `WaitingRow`). The row shows:

- what it waits for;
- how it stands now. A CI run's jobs are small dots that fill in green or red;
- how long it's been, and "next look in 40 s" or "watching live";
- "you can keep chatting" when the turn let go, and "you'll be told" when asked;
- **Open on GitHub**, **Check now** (at most every 5 s) and **Stop waiting**.

Once over, the row says how it went in words ("CI finished: 2 failed — e2e, server unit; 5
passed"), then the assistant's reply follows. While a wait that let go is open, the box says
"Waiting for CI for conch #482 · you can keep chatting". `tell_me` ("tell me when CI is
green") sends the end to the person's devices and chat app, as a finished task does. Stop
waiting tells nobody and wakes nobody.

### 4. Every model is taught, and native waiting is mapped

- The working-a-problem prompt (ADR 0102) has one line about waiting: call `wait_for` once,
  end the turn when it says so, and never loop `sleep` or check again and again. Lean mode
  gets the same in a sentence.
- The tool's own description says to use it "instead of `sleep`, `gh run watch`, or checking
  a command again and again".
- Claude Code's own `ScheduleWakeup`, `Monitor` and session crons are turned off, like its
  sub-agents (`OWN_WAITS`). In Conch a turn ends with its reply, so a wake-up scheduled inside
  the session would never come where anyone sees it. Its background Bash stays: that's a
  command, not a wait.
- Codex's long `write_stdin` poll stays as it is. It's already a sleeping wait inside one call.

### 5. The fallback guard stays, and is calm

A provider that checks on a command again and again anyway is still noticed (`stuck.ts`). It
now says "Still running · checked 4 times in 2 minutes, nothing new yet" in the row's own ink
(`stuckTone: 'calm'`). Failing or undoing the same change stays amber.

## Threat model

- **The model's arguments are untrusted.**
  - A `url` goes through the same guarded fetch as web reads, which refuses this computer and
    the person's network, and is rate-limited per chat.
  - CI addresses must be github.com. `repo` must look like `owner/name`.
  - A `pattern` is compiled as a regular expression over the command's kept output (at most 64
    KB), and an invalid one is refused in words.
- **The GitHub token never leaves the gateway** except to `api.github.com`. `gh` runs with its
  prompts off.
- **What comes back is someone else's words.**
  - Check names are cut to 120 characters, with control characters removed.
  - A page's text taints the chat (`web`), and a command's output does too (`download`), as
    `process_read` already did.
  - The wake prompt quotes these as data.
- **Waking a chat grants nothing.** The turn runs with the chat's own mode, budget and holds,
  exactly as if the person had sent a message.
- **No power to act unattended is added.** Waits only let go in a chat someone is in.
  Routines are still the way to do something later on a schedule.

## Consequences

- CI that takes 20 minutes costs one model call when it ends, plus one for the line before.
  Before, it cost 10 to 40.
- The chat is free while it waits. A wait that let go outlives a restart. A held one is gone
  with its turn, as its command is.
- New state: `waits.json` (derived in backups: it's about this run), a Repair everything check,
  and `POST /api/conversations/:id/waits/:waitId` (`check` or `stop`).
- Not done yet: GitHub webhooks through the public door (ADR 0045). Conch rarely has an
  address GitHub can reach, so conditional polling stays the default. GitLab and Buildkite
  could be more `ci` sources behind the same watcher. Several waits in one chat ending close
  together each wake it. Coalescing them is left for when it's seen.

## Sources

- Claude Code docs: tools reference (Bash `run_in_background`, `Monitor`), scheduled tasks
  (`/loop`, `ScheduleWakeup`), interactive mode (background commands' limits):
  https://code.claude.com/docs/en/tools-reference, https://code.claude.com/docs/en/scheduled-tasks
- Anthropic prompt caching (5-minute TTL): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- OpenAI Codex unified exec (`yield_time_ms`, `background_terminal_max_timeout`):
  https://github.com/openai/codex/blob/main/codex-rs/core/src/unified_exec/mod.rs
- Cursor cloud agent capabilities (subscriptions, CI waits): https://cursor.com/docs/cloud-agent/capabilities
- Devin and GitHub: https://docs.devin.ai/integrations/gh
- GitHub Copilot coding agent: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- `gh run watch`, `gh pr checks`: https://cli.github.com/manual/gh_run_watch, https://cli.github.com/manual/gh_pr_checks
- GitHub webhook events and best practices; REST rate limits and best practices (conditional
  requests, `x-poll-interval`): https://docs.github.com/en/webhooks/webhook-events-and-payloads,
  https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api,
  https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- Marc Brooker, "Exponential Backoff And Jitter", AWS Architecture Blog:
  https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- RFC 6202, long polling: https://www.rfc-editor.org/rfc/rfc6202.html
