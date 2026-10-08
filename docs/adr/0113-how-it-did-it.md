# 0113 — How it did it: a run's timeline, and saving it as a trajectory

- Status: accepted
- Date: 2026-10-08
- Builds on: [ADR 0028](./0028-safe-hands.md) (Activity, read from the chats' own logs),
  [ADR 0030](./0030-undo.md) (change sets), [ADR 0079](./0079-what-a-chat-costs.md)
  (what each reply costs), [ADR 0103](./0103-the-chat-tells-what-the-assistant-is-doing.md)
  (each tool call in plain words), [ADR 0071](./0071-evals-on-every-model.md) (evals),
  [ADR 0059](./0059-looking-through-earlier-chats.md) (secret shapes),
  [ADR 0025](./0025-passwords.md) (the vault's redactor)

## Context

A chat already tells what the assistant is doing while it works (ADR 0103), and
Activity lists everything it did across every chat (ADR 0028). Neither answers the
question people ask afterwards: _how did it get there?_ That means the whole run in
order and at its own pace: what it read, what it changed, where it waited for you,
what failed and what that cost. The same goes for a routine's run at 7 a.m. or a task
that ran in the background while nobody watched.

People who work on models want the same run as a file. Two agents Conch is often
compared with already offer one:

- **Hermes Agent** saves trajectories in ShareGPT form for training. Each record is
  `conversations` with `from` set to `system`, `human`, `gpt` or `tool`. A `gpt` turn
  carries `<think>…</think>` and `<tool_call>{"name","arguments"}</tool_call>`. Results
  come back as `<tool_response>{"tool_call_id","name","content"}</tool_response>`
  in one `tool` turn. Records also have `timestamp`, `model` and `completed`.
  `hermes sessions export` adds Markdown, HTML and a redacted trace.
- **OpenClaw** writes `/export-trajectory` bundles. Its export is
  redacted on a best-effort basis: credentials and state paths come out, and the
  workspace and home folders are replaced.

Two wider formats exist too. OpenAI's chat fine-tuning JSONL has `messages` with
`tool_calls` (`arguments` as a JSON string), `tools` and `parallel_tool_calls`.
**ATIF**, Harbor's Agent Trajectory Interchange Format, is at `ATIF-v1.8`. It has
`schema_version`, `session_id`, `agent{name,version,model_name}`, and `steps[]`. Each
step has `step_id`, `timestamp`, `source`, `message`, `reasoning_content`,
`tool_calls[{tool_call_id,function_name,arguments}]`,
`observation.results[{source_call_id,content}]` and
`metrics{prompt_tokens,completion_tokens,cached_tokens,cost_usd}`. The file ends with
`final_metrics`.

Conch keeps no telemetry and sends nothing anywhere. So the timeline and the file
have to come from what is already on the computer: each chat's
`conversations/<id>.jsonl`. Every provider's turns reach that log as the same events.

## Decision

### One timeline, read from the log

`trajectory/timeline.ts` (`timelineOf`) turns a chat's events into `RunStep`s
(`@conch/protocol` `trajectory.ts`). A step is what you asked, a thought, words it
wrote, a tool call, a question it asked you, files changed, a browser step, a task
handed off, something it made or remembered, or a turn that stopped with a problem.
Each step has its time and how long it took. A tool call's words come from
`ToolLabel` or `describeTool`, the same words the chat uses. A step also carries
where it is in the chat (`anchor`, the same `data-anchor` that Activity and search
land on), a clipped look at what came back, and the change as `+`/`-` lines for the
file tools every provider shares (`Edit`, `MultiEdit`, `Write`).

The time spent waiting for your answer is a step of its own (`approval`), so a run
that sat for an hour shows where. Each turn's tokens and cost come from
`turn.completed` (ADR 0079), and totals add them up. Routine runs and tasks are
chats, so they get the same timeline with nothing extra. `GET
/api/conversations/:id/timeline` serves it. The chat is read, never written, and
nothing new is stored.

### The replay (Nacre `RunReplay`)

One time axis, scrubbed with the pointer or the keys: arrows step, Page Up and Page
Down go a turn at a time, Home and End go to either end. Radix's slider gives the
behaviour; its value is a point in time at work, snapped to the nearest step. Long
waits between steps fold to 20 seconds and show a break mark, so the work reads at
its own pace instead of disappearing beside a lunch break.

The step at the scrubber opens below: its words morph in (`MorphText`), with what it
changed (`Diff`), what came back, the page as it was (the browser's own thumbnail),
and **Show in chat**. The tally above follows the scrubber ("By here: 1m 12s · 6 of
23 steps · 4.1k tokens · $0.02"). The list below fills in up to it, and later steps
are dimmed. **Replay** plays it back calmly, one step at a time, with the pearl
riding the scrubber. Reduced motion keeps every step and drops the glide.

It opens as a `Sheet` from the chat's header (**How it did it**), the phone's
**More** menu and ⌘K. A sheet carries the panel glint. Because a routine run or a
task opens as its chat, both reach the same sheet.

### Saving it as a file

`POST /api/trajectories/preview` and `/export` take a format, which chats, whether
to redact, and a folder:

- **Which chats.** One chat, or a batch filtered by time, agent and provider, with
  routine runs and tasks included unless you turn them off. A batch takes at most
  500 chats.
- **Formats.** `report` is a page to read. `markdown`. `openai` is OpenAI chat
  JSONL. `sharegpt` is ShareGPT as Hermes writes it. `atif` is ATIF-v1.8: one JSON
  file for one chat, JSONL for a batch.
- **Format details.** `trajectory/formats.ts` first builds the messages: user, then
  assistant with thinking, words and calls, then tool. Every call is answered, so a
  call cut off by Stop gets a "No result" turn and the file stays valid. The log
  keeps each call but not the schema it was offered with, so OpenAI's `tools` list
  each tool by name with a generic object schema.
- **The page.** It is self-contained with no script. Its own CSP is `default-src
'none'`, and every word is escaped. A browser step's picture stays out of it, so
  nothing needs loading.

### Redaction is on, and shown first

`trajectory/redact.ts` takes out:

- every secret Conch knows, through the vault's redactor
- key shapes, from the same list as `search/past.ts`
- email addresses and phone numbers
- card numbers that pass the Luhn check
- public IP addresses (home networks and loopback stay)
- the home folder, which becomes `~`
- the names in About you: yours and the people you added

Before anything is written, the preview counts what came out by kind ("2 keys and
tokens, 1 email address"). It also shows a few places it came from, as they read
afterwards (`OPENAI_API_KEY=[key]`), never the value itself. Like OpenClaw's, this
is best effort, and the guide says so. Turning it off is one switch, and the next
dialog opens with it on again.

### Saved on this computer, never typed

The folder is Downloads, or the home folder when there is no Downloads. **Change**
opens `chooseOnComputer` with a new purpose, `export-folder`. The gateway resolves
the folder, links included, and checks it against the rules the folder browser
uses (`isDenied`). That keeps out Conch's own folder (all but its workspace) and the
places keys and sign-ins live, under both their written and their real names. It
writes with `O_EXCL` and mode `0600`, so it never replaces a file or writes through
a link: an existing name gets " 2". The file's name is the gateway's own (`Conch –
<title> – <date>.<ext>`), with the title redacted and cleaned for every file system.

Saving is a person's act: an access key (a script, the assistant's own shell) gets 403. Nothing leaves the computer. There is no upload, share link or telemetry, and
no tool lets the assistant save a trajectory.

## Consequences

- A run is understandable after the fact without reading the whole chat, for every
  provider and for unattended runs.
- Datasets come from what already happened, in formats existing tools read. Nothing
  is collected unless the person presses Save.
- Redaction can miss a secret in an unusual shape, or a name that isn't in About you.
  The preview and the guide say so. A file is saved only where the person chose, and
  only readable by them.
- The timeline is worked out on every open. Long chats stop at 2000 steps and say
  so.
- No new state: nothing under `CONCH_HOME`, no backup rule, no doctor check. The
  routes join the reference by themselves.
