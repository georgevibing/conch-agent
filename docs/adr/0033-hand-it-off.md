# 0033 — Hand it off: background tasks and helpers side by side

- Status: accepted
- Date: 2026-10-01
- Amended: 2026-10-04 (a part can go to another provider, below)
- Builds on: [ADR 0005](./0005-usage-limits.md) (budgets that never block),
  [ADR 0006](./0006-routines.md) (a run is a conversation),
  [ADR 0023](./0023-offline-and-limits.md) (carrying on at a limit),
  [ADR 0027](./0027-in-your-pocket.md) (notifications),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading)

## Context

Today a chat does one thing at a time, and you watch it. Real work doesn't
look like that. You ask for the README to be tidied while you think about
something else, or a job falls into three parts that don't need each other.

Related projects take different approaches: OpenClaw runs sub-agents inside one
session, and Hermes runs background jobs as shell processes. Conch needs tasks
you can see, stop and answer, that survive a crash, ask before acting the way
their chat does, say when they finish, and share the guard.

Conch already has the right building block. A routine's run is a real
conversation (ADR 0006): you can open it, it asks in the open, it's backed up,
and it shows in Activity. Hand it off uses the same block.

## Decision

### 1. A task is a conversation with a card

A **task** is a conversation with origin `{ kind: 'task', taskId }`, started by
`ConversationManager.start`, as a routine's run is. It has two kinds:

- **background:** you sent it away.
- **helper:** the assistant split its work and runs this part side by side.

The list of tasks, `~/.conch/tasks.json`, records only where each one stands.
The work itself lives in each task's chat.

`Task` carries:

- `status`, one of:
  - `queued`
  - `running`
  - `needs-you`
  - `done`
  - `failed`
  - `stopped`
  - `interrupted`
- `current`: what it's doing now, e.g. "Running `npm test`".
- `steps`: the last 12 things it did, in the past tense.
- `summary`
- `error`
- `note`: one sentence when another provider carried on.
- `worktree`: for helpers.
- `rev`: goes up with every change, so the page always keeps the newest copy.

The chat it was sent from gets a `task` event each time the status changes.
The transcript folds these into **one card per task**, kept current where it
first appeared. When the task finishes, its summary comes back into that chat.

### 2. Sending something away

**Ways to start one.**

- **The composer.** "Do it in the background" (⌘⇧↩) appears as soon as
  something is written.
- **⌘K.** "Do it in the background" sends what's written. "Tasks" opens the
  list.
- **The assistant.** The host tool `start_background_task` does it when you
  say "in the background".

**How it runs.** A task runs as its own conversation, in the chat's mode, with
the chat's provider and model. It reports its result with `report_result`, a
tool only a task has. If a turn ends without one, its last reply becomes the
summary.

**Limits.** At most 3 background tasks and 4 helpers run at once; the rest wait
their turn (`queued`).

**Where you see it.**

- Tasks has a place in the sidebar. Its badge counts what's working, and shows
  "need your OK" first.
- The `/tasks` page lists needs-you, then working, then waiting, then finished.
- Task chats stay out of the chat list, like routine runs. A banner at the top
  of one says what it is and links back to the chat it came from.

**When it's done.** You're told in the app, unless you're already looking at
that chat. A Web Push notification comes under the new **tasks** topic ("When
a background task finishes", on by default). Its tag is `task-<id>`, so the
notification is sent once per finish, and it opens the chat the task came from.

### 3. Helpers side by side (`delegate`)

The host tool `delegate` takes 1–6 parts. Each part has:

- a title;
- instructions;
- `model`: `fast` (the provider's small model, the default) or `same`;
- `worktree`: whether it gets its own copy of the folder.

The tool waits for all the parts and returns their results merged as
`## title` blocks. A part that didn't finish says so: "Stopped before it
finished." or "Didn't finish: …". Each helper is a card in the chat as it
works. All of them share a `group`.

**Helpers can't be used to get around anything:**

- **Mode.** A helper runs in the parent turn's permission mode. The tool runs
  inside that turn, so it can't widen its own powers.
- **The guard.** A helper starts with its parent's taint. Whatever it reads
  comes back into the parent when it finishes. A helper that read a page
  leaves its parent as wary as if the parent had read it.
- **Budget.** Over the monthly budget, `delegate` refuses and says why. It
  never multiplies spending past what you set. Every task and helper spends as
  part of the chat it came from, and stops at that chat's limit or the monthly
  budget, saying why (ADR 0079).
- **Stop.** Stopping the parent turn aborts the tool, and that stops every
  helper.

**Worktrees.** A code part can ask for its own **git worktree** at
`~/.conch/worktrees/<taskId>`, on branch `conch/<taskId>`. If it changed
nothing (no edits, no commits), the worktree and branch are removed. If it
did, they're kept, and the card and the merged result name the branch. A
folder that isn't a git repository simply shares the work folder.

### 4. Asking you, without holding anyone up

A task's permission question waits in its own chat, with the unattended
one-hour timeout (as routines have). While it waits:

- The task is `needs-you`, and its card says "See what it's asking".
- The approvals notification (ADR 0027) comes as for any chat.
- Other tasks carry on, because each runs in its own conversation.

When you answer, the task goes back to `running`.

### 5. Healing

- **A restart.** Conch stopped while a task was `running` or `needs-you`: it is
  marked `interrupted` ("Conch stopped while this was running."), never left
  "running" for ever. **Try again** runs it from the start.
- **A provider limit.** A task that hits a limit runs again once on
  `preferences.limitFallback` (ADR 0023), and says so in `note`: "Claude Code
  reached its limit, so OpenRouter carried on." With no fallback set, it fails
  and says why.
- **A provider that isn't ready.** The task fails at once with that provider's
  own reason. It doesn't sit queued.
- **The page was away.** When the socket reconnects, the page reloads the task
  list, so a task that finished meanwhile shows as finished.
- **Doctor.** The `tasks` check warns about interrupted tasks and reports the
  ones that need you. It opens the Tasks page.

### 6. API

| Method   | Path                   | Does                                          |
| -------- | ---------------------- | --------------------------------------------- |
| `GET`    | `/api/tasks`           | `{ tasks, concurrent }`                       |
| `POST`   | `/api/tasks`           | `{ text, conversationId?, title?, options? }` |
| `POST`   | `/api/tasks/:id/stop`  | stop it, whether waiting or working           |
| `POST`   | `/api/tasks/:id/retry` | run a finished one again                      |
| `DELETE` | `/api/tasks/:id`       | remove it from the list (its chat stays)      |

These sit behind the gateway's host, origin and sign-in checks. A task has
exactly the powers of the chat it came from, so nothing here grants more.

Live updates come as `task.changed` and `task.deleted`.

**Backup.** `tasks.json` is `derived`: a restore has nothing running. The
tasks' chats are backed up with your other chats. Worktrees are `outside`.

## Consequences

- Long jobs no longer tie up the chat. You keep talking while they work, and
  their results come back to where you asked.
- The assistant can split a job and run the parts at once on a cheaper model,
  without new risk: same mode, same guard, same budget, and stop means stop.
- Every task is a normal chat. It is searchable, backed up, shows in Activity,
  and can be opened and continued.
- Tasks don't take attachments yet. The composer says so instead of dropping
  them.
- A helper's worktree branch is left for you to merge. Conch never merges on
  its own.

## Amended 2026-10-04: a part can go to another provider

People connect several providers (ADR 0012) and want to use them together: "have Codex
write the tests while you fix the bug". OpenClaw runs Claude Code, Codex and Gemini CLI as
workers; Conch's helpers could only use the chat's own provider.

- `delegate` parts and `start_background_task` take an optional `provider` (an engine id
  or its name) and a `model`: `fast` (that provider's small model), `same` (the chat's
  model on its own provider, the provider's default elsewhere) or one of that provider's
  model ids, checked against its list.
- Only providers that are connected and ready now (`providers.ready()`, so a pin still
  means only that one) can take a part. One unknown name starts nothing, and the tool
  says who can. A provider that can't ask before each step is never handed anything.
- The assistant's prompt lists the other connected providers, each with what kind it is
  (a coding agent, a model on this computer, one that can only chat). It hands a part over
  when the person asks or when it plainly suits the part, and otherwise keeps its own.
- **Powers don't change with the provider.** The part runs in the chat's mode, through
  `honouredMode` (a provider that can't honour it runs its safest), starts with the chat's
  taint and skill holds, gives back what it read, counts against the same budget, and
  stops with the chat. The chat's own model is never carried to a provider it isn't from.
- `Task.by` (and the chat's `task` event) names the provider when it isn't the chat's
  own, and the card says "by Codex CLI".

## Superseded completion and resumption semantics

[ADR 0038 — Durable verified tasks](./0038-durable-verified-tasks.md) replaces the
original retry-from-start, derived-backup and model-completion semantics.
