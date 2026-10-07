# 0033 — Hand it off: background tasks and helpers side by side

- Status: accepted
- Date: 2026-10-01
- Amended: 2026-10-04 (a part can go to another provider, below)
- Amended: 2026-10-06 (every provider hands off through Conch's tasks; what a task
  inherits; tasks under their chat, below)
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

## Amended 2026-10-06: every provider hands off through Conch's tasks

Providers grew sub-agents of their own: Claude Code's `Agent` tool (`Task` before it
was renamed) and its multi-agent `Workflow`, Codex's `multi_agent` (and
`multi_agent_v2`), and whatever the ACP programs offer. Work run that way is
invisible to Conch: no card, no Stop, no approval in the open, no spending against
the chat, and no record in Activity. Conch already has the right shape for it.

- **Native sub-agents are off wherever Conch can turn them off.** Claude Code gets
  them in `disallowedTools` in every mode, Full trust included (`OWN_SUBAGENTS` in
  `engines/claude-code/engine.ts`); Codex gets `features.multi_agent=false` and
  `features.multi_agent_v2=false` in both of its shapes. Its to-do tools
  (`TaskCreate`…) and plan updates stay: those are a checklist, not a second agent.
  A program Conch can only talk to over ACP is told in its instructions not to start
  sub-agents or tasks of its own, beside Conch's own tools.
- **Every chat is told how to hand work off** (`TASKS_PROMPT`): `delegate` for parts
  side by side, `start_background_task` for a long job — never the provider's own.
  Providers without Conch's host tools (chat-only models) simply can't hand off.
- **One level.** A task gets Conch's own tools as its chat has them, but not
  `delegate` or `start_background_task`: nothing multiplies out of sight, and its
  brief says to do the work itself.
- **What a task found comes back to the model too.** The chat's handover (`handoff.ts`)
  carries a finished task's summary, not only its state, so the next turn can act on it.

## Amended 2026-10-06: a task inherits its chat's powers, and never more

A task that asks for an approval its chat would not have needed is stuck for nothing;
one that may do more than its chat is an escalation. Both are bugs.

- **The mode is the chat's**, through `noMoreThan`: a mode asked for that allows more
  than the chat's becomes the chat's; one that allows less is honoured (a scoped
  workflow task still runs in `default`). A helper takes the mode of the turn that
  started it. Then `honouredMode` applies per provider, as before.
- **Full trust is the person's**, wherever they gave it: `TurnExtras.attended` says
  the task came from a chat someone is in, so what that chat read doesn't make it
  stop, and a command may leave the sealed box exactly as the chat's would
  (`trustsFully`, used by every Conch tool that asks). Nothing else about being
  watched carries over: a task still can't put a question to somebody with `ask`,
  and an unanswered permission still expires after an hour.
- **"Always allow" carries, nothing more**: `TurnExtras.grants` copies the chat's
  `alwaysAllow` and waived reasons at the moment the task starts
  (`ConversationManager.grantsOf`). A task from another chat has been told nothing.
  A scoped task (ADR 0038) takes no grants at all.
- **It follows its chat.** Changing the mode in the chat changes its going tasks
  (`TaskService.#follow` on `conversation.updated`): Full trust lets one waiting for
  an OK carry on at once; Ask first makes it ask again from its next step. A scoped
  task keeps the mode its contract set.
- Taint, skill holds, the budget and Stop are unchanged (above, and ADR 0079).

## Amended 2026-10-06: tasks are where their chat is

- **Under their chat in the list.** A chat with tasks keeps its one line: a badge on
  it (Nacre `ChatTasksToggle`, `ChatRow`'s `disclosure`) says how many and how
  they're going — a turning ring while one works, a hand when one needs you, a tint
  when one didn't finish — and opens a row per task under it (`ChatTasks`), on the
  chat's own grid (folders too): its status in a word and a mark, what it's doing
  now or why it didn't finish, how long it took, a press to open its own chat, and
  Stop while it works. It opens itself
  while something is going, and a person's press wins from then on. Finished tasks
  stay under the chat for half a day, then only on Tasks and in the chat.
- **Answered where you are.** `Task.asking` carries what a task is waiting for, so
  its card in the chat it came from asks it with Allow and Deny
  (`TaskCard.asking`), answered over the same socket message as any permission. A
  question with a screen of its own (a site, Passwords, a draft to read) keeps
  **See what it's asking** and opens the task's chat. Only one thing asks per task:
  the toast is dropped when the chat is already in front of you.
- **It says what it may do.** A card on the Tasks page names the mode it runs in and
  the chat it came from; the banner in a task's own chat says it may do what that
  mode allows and never more than its chat.
- The sidebar's Tasks badge and ⌘K count helpers too: each is a chat of its own, and
  one waiting for an OK holds up the chat that started it.

## Amended 2026-10-07: told once, in the same words everywhere

- **One decision, two places.** `taskFinishNotice` (`@conch/protocol`) decides what
  a finished task says, and both the phone's notification and the app's toast use
  it: **Done: …**, **Done, worth a look: …** (something it did couldn't be
  confirmed), or **Didn't finish: …** with the first line of why. Stopping a task
  says nothing; a helper's result still goes back to its chat.
- **Started together, told together.** Tasks that share a batch (`batchId`, else
  `group`) wait for the last of them, then say so once: "3 tasks done · 1 didn't
  finish", tag `tasks-<batch>`. A tap opens the one that didn't finish when it's
  the only one, else the chat they came from.
- **A tap opens the task where it lives.** Notifications and toasts link to the
  chat it came from with `?task=<id>`, not to the task's own chat. A task waiting
  for an OK says **A task needs your OK**, with the task's title; Deny still
  answers from the notification and Allow still opens Conch (ADR 0027).
- The switch reads **When a task finishes**.
