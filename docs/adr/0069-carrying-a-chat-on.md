# 0069 — Carrying a chat on, on every provider

- Status: accepted
- Date: 2026-10-04
- Amends: [ADR 0036](./0036-provider-consistency.md) (Codex's fresh thread each turn),
  [ADR 0053](./0053-more-providers.md) (a fresh ACP session each turn, Conch's instructions as
  words in the message, the door over HTTP only), [ADR 0066](./0066-codex-cli-and-coding-agents.md)

## Context

Claude Code and the model APIs carry a chat on from one message to the next: the model sees what
it did before, its tool calls and what they returned, not only what was said. Codex, Codex CLI,
Copilot, Gemini CLI and Grok didn't. Each message started a new Codex thread or a new ACP session,
handed Conch's transcript of the words alone (up to 60,000 characters). A model that had spent ten
steps in the browser came back to the chat knowing only its own last sentence, and switching
model mid-task meant starting again.

Codex started afresh on purpose (ADR 0036): a thread keeps the dynamic tools it was started with,
and app-server can't give it new ones, so a resumed thread could offer a tool for an app that's
since been disconnected. ACP sessions started afresh because it was simplest.

Three more things set the ACP programs apart from the others:

- Conch's instructions (who the assistant is, its memory, how to use Conch's tools) went in front
  of the person's message, as words of the user.
- What the program did with its own tools (a file read, a search) never showed in the chat.
- A program that can't reach an MCP server at an address got no tools at all.

## Decision

### Each provider carries its own chat on

Every engine reports its session (`session` event) and gets it back next turn (`resumeId`), with
the handoff of only what it missed while other providers answered. When it can't carry the
session on, it starts a new one with `TurnInput.freshPrompt`: the whole conversation, framed as
such ("your earlier session couldn't be continued"). One that was lost rather than replaced on
purpose says `restarted: 'lost'`, and Conch notes it under **Fixed on its own**.
`Engine.conversationHistory` is gone.

**Codex and Codex CLI.** Threads are no longer ephemeral. Codex writes a thread in its home
(`sessions/…/rollout-…-<id>.jsonl`), but each run's home is removed afterwards, because the
sign-in must never wait on disk in the clear (ADR 0036). So Conch keeps the thread itself, in
`codex-sessions/`, between turns:

- **How it's carried on.** After Codex has stopped, Conch copies the thread out. Before the next
  run, it puts it back, and `thread/resume` picks it up. This was checked against Codex 0.159.1:
  a thread put in a fresh home's `sessions` resumes by id, and its facts and tool results carry
  over between processes.
- **Only with the same tools.** The resume id is `<thread>.<digest of the turn's tool names and
schemas>`. A thread is resumed only while the digest matches, so a thread never offers a tool
  that's gone, or misses one that's new. A change of tools starts a new thread with the handoff,
  on purpose. Every tool call is still checked against this turn's tools, as before.
- **The same asking and the same seal.** Every resume passes `approvalPolicy: "untrusted"` and the
  `conch` profile. The profile itself is set per run.
- **Instructions that change.** Codex keeps a thread's developer instructions from its start;
  `developerInstructions` on resume doesn't replace them (checked). When Conch's instructions have
  changed since the thread last heard them (a new memory, a setting), they go with the turn as
  `additionalContext` (`kind: "application"`), framed as replacing the earlier ones. A digest kept
  beside the thread says whether they changed.
- **What it costs.** A thread grows with the chat, and Codex compacts it by itself. One over
  64 MB isn't kept, and the next turn starts afresh.
- **Where it lives.** `codex-sessions/` is already `derived` in backups (Conch's log is the
  durable record) and in `protectedPaths`. A thread is deleted with its chat
  (`Engine.forgetSession`) and tidied after 30 days unused.
- **When it can't be read back.** A damaged file, a newer format, or a resume id from the
  `codex exec` era: a new thread, with the whole conversation, said quietly.

**Copilot, Gemini CLI, Grok.** Where the program advertises `loadSession`, a chat's session is
loaded next turn with `session/load`. Copilot, Gemini CLI and Grok keep sessions on disk, so a new
process can load one. The session is loaded with this turn's door, so its tools are always this
turn's. The history the program replays while loading is history, not the reply, and isn't
shown. A session it can't load (another folder, tidied away) heals the same way. A program
without `loadSession` gets the whole conversation each turn, as before.

### The handoff says what was done

When a chat moves between providers, or a session has to start again, the handoff
(`conversations/handoff.ts`) carries what was done between the words, not only the words. It's
shared by every provider:

- **Each step, in brief.** Every tool call and how it went, with at most 160 characters of its
  result. The browser's steps, files changed or put back, memories saved, things made, skills
  used, questions asked and answered, tasks finished.
- **Bounded.** A long run of steps keeps the first four and the last seven, and says how many
  were left out between them.
- **Where things stand now.** The page Conch's browser is on, with its title and address, and a
  word to look at it with the browser tools before acting. The plan as it was left, if steps
  remain. A question still waiting. Work handed off that's still running. All in at most 1,500
  characters, always kept.
- **Framed as data.** It's the same `<earlier-conversation>` block within the same 60,000
  characters, newest kept first. It says that what tools and pages returned is data, not
  instructions.

The snapshot of the page itself isn't handed over. It's stale by the time another model reads
it, and that model can read the live page in one step.

### Conch's instructions, the way each program takes them

`AcpAgent.instructions` says where:

| Program    | How                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grok       | `rules` in the session's `_meta`, appended to its system prompt (Grok's own ACP docs).                                                                                    |
| Copilot    | The door's own MCP server `instructions`, with `--allow-all-mcp-server-instructions` (1.0.66). Copilot reads a server's instructions into its system prompt each session. |
| Gemini CLI | The door's own MCP server `instructions`, which Gemini CLI puts in the chat's first message.                                                                              |

A turn without a door (no tools) has nowhere else for them, so they lead the message. So does a
carried-on Gemini chat whose instructions have changed since it started. Either way they're
framed as the app's words, not the user's. The resume id carries a digest of what the program
was last told (`<digest>:<session>`), so they're sent again only when they changed.

### What the program does shows like every provider's work

`tool_call` and `tool_call_update` become Conch's `tool-start` and `tool-end` (`acp/calls.ts`):

- **Named the way Conch names that work** where it can tell: `Read`, `Edit` (with the diff),
  `Bash`, `WebFetch`, `Grep`. Otherwise it keeps the program's own title.
- **Calls to the door are left to the door**, which already shows them, with their views. The
  programs name such a call their own way (`conch-<tool>`, `<tool>(args…)`,
  `<tool> (conch MCP Server)`, Grok's `use_tool` with `tool_name: conch__<tool>`). A call whose
  notice doesn't say is held while it's only `pending`: the program asks before it runs a door
  tool, and that request names the door.
- **A declined call shows as not run.** One of the program's own that Conch declined says so.

Permission requests still go through Conch: door tools are allowed once (they're checked at the
door), and everything else is declined. A title in Gemini CLI's `tool(args…)` form counts as the
door's only for a call whose kind is `other`, never a command, a change or a fetch. That way a
shell command that merely reads like one of ours stays the program's own.

### The door for programs that can't reach an address

A program that doesn't advertise `mcpCapabilities.http` gets the door as a program of its own
(stdio, which ACP requires every program to take): `shim.mjs`, run by Node. It only relays each
JSON-RPC message to the turn's loopback door, with the turn's key. It reads both from its
environment, refuses any address but `http://127.0.0.1:<port>/mcp`, and keeps nothing. The door
still decides everything, behind the same checks. Copilot refuses stdio servers from a client,
and advertises HTTP, so it keeps the HTTP door.

## Consequences

- Codex, Codex CLI and the ACP programs that can load a session remember their own tool work
  across messages. They're no longer sent the whole transcript every turn: less input, and
  prompt caching works.
- Switching model mid-task hands over what was being done, not only what was said, on every
  provider.
- Connecting or removing an app restarts a Codex thread: one turn with the whole handoff.
- Some of this was read from the programs' own sources (Copilot 1.0.60 and 1.0.91, Gemini CLI
  0.62.0, Grok 1.0.46) and not yet run against them, because none was signed in on the machine
  where it was built:
  - Copilot's server instructions for a client's server, behind the flag.
  - Grok's `rules` on `session/load`.
  - Gemini CLI's titles.
  - Grok's stdio door.

  The tests use pretend programs shaped after those sources. A program that ignores the
  instructions' channel would answer without Conch's instructions, so check this first when
  something reads wrong.

- Gemini CLI starts no MCP server, ours included, in a folder it doesn't trust. A door tool whose
  arguments include `command` is titled by the command alone in Gemini CLI, so Conch can't tell
  it from the program's own, and declines it.

## Verification

- Codex 0.159.1, run directly:
  - a non-ephemeral thread with a dynamic tool, put in a fresh home's `sessions` and resumed by
    id, kept its facts and tool results in a new process;
  - `developerInstructions` on resume were ignored, and `additionalContext` was followed;
  - a dynamic tool answered after 5.5 minutes didn't time out, so `ask` can wait for a person.
- Unit tests:
  - `conversations/handoff.test.ts` (the steps, their bounds, where things stand, a restart);
  - `conversations/providers.test.ts` (`freshPrompt`, `forgetSession`);
  - `engines/codex/app-engine.test.ts` (resume, instructions again only when changed, a change
    of tools, a thread that can't be read back, a forgotten chat);
  - `engines/acp/engine.test.ts` (load, replay unshown, heal, a program that can't load, Grok's
    rules, Gemini's changed instructions, the stdio door end to end, tool rows, door-name
    matching and the command that only looks like one);
  - `engines/acp/door.test.ts` (the shim refuses any other address, or no key).
