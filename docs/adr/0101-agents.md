# 0101 — Agents: several assistants, one Conch

- Status: accepted
- Date: 2026-10-07
- Builds on: [ADR 0012](./0012-every-provider-at-once.md) (every provider at once),
  [ADR 0018](./0018-channels.md) (channels), [ADR 0020](./0020-backups.md) (backups),
  [ADR 0028](./0028-safe-hands.md) (safe hands), [ADR 0033](./0033-hand-it-off.md) (tasks),
  [ADR 0042](./0042-come-home-the-rest.md) (other agents' personas),
  [ADR 0051](./0051-releases.md) (data across versions),
  [ADR 0086](./0086-lean-mode-for-small-models.md) (lean mode),
  [ADR 0098](./0098-chat-commands-every-provider-understands.md) (one list of commands),
  [ADR 0100](./0100-permission-modes-every-provider.md) (permission modes),
  [ADR 0102](./0102-every-assistant-works-the-problem.md) (resilience)

## Context

Conch had one assistant. Setup chose its name, one of four tones, and a box of
instructions (`settings.json` `persona`), and every chat, chat app, routine and task
spoke as it. People who use agents a lot want more than one: a planner, a reviewer, a
tutor, each with its own name, face, voice and instructions, and to choose who answers
a chat.

The agents people come from already work this way:

- **OpenClaw** keeps an agent as a workspace of Markdown files, read into every
  session: `IDENTITY.md` (name, vibe, emoji, avatar), `SOUL.md` (persona, tone,
  boundaries), `AGENTS.md` (operating rules and priorities), `USER.md` (about the
  person), `MEMORY.md`. Several agents are `agents.list` in `openclaw.json`, each
  with its own workspace, and channel routing picks which one answers where.
- **Hermes Agent** puts `SOUL.md` in slot one of the system prompt (it replaces the
  built-in identity, is scanned for prompt injection and capped), then tool guidance,
  memory and user context, skills, context files (`AGENTS.md`), and last any
  `/personality` overlay, a preset (helpful, concise, technical, teacher…) layered on
  the soul. Several agents are separate homes.

What the agent builders publish says the same about setting one up: a short, concrete
role; a voice described in a few words; boundaries said plainly; durable traits in the
persona and the job's details in instructions; and a layered system prompt where what
the platform guarantees comes first. Models that are told an explicit order of
precedence for their instructions hold to it far better when something lower down tries
to override it (Wallace et al., 2024, "The Instruction Hierarchy").

Two things are not negotiable for Conch:

1. **A persona is words, never power.** An agent can't lift a permission, a safety
   check, a skill's hold or a mode. The assistant must not be able to rewrite an
   agent's instructions (a planted instruction would then follow every chat).
2. **Every provider** (working agreement 9). An agent must mean the same with Claude
   Code, Codex, the ACP programs, every model API and a model on this computer.

## Decision

### An agent

`packages/protocol/src/agents.ts` is the contract. An `Agent` has an id (`ag_…`, never
a path), a **name** (at most 40 characters, unique whatever its case: it's shown beside
every reply and is what the agent calls itself), a **face** (one of Conch's preset
pictures in a colour, or a picture of your own), a **role** (one line, at most 120: what
it's for), a **persona** (a tone from seven, each with its words in `TONES`, and a
personality in your own words, at most 2,000), **instructions** (at most 100,000; see
[Long instructions](#long-instructions)), and
optional **defaults** for the chats it starts (provider, model, thinking, mode). There
are at most 50, always at least one, and exactly one is the **default**: new chats,
chat apps and routines start with it unless they choose another.

Defaults never include Full trust: that's chosen for a chat, or for every chat, by a
person, confirmed in place (ADR 0100). An agent whose chats start in Auto is named in a
restore preview (`chats-go-ahead`), like Auto as the default. Defaults apply only to
chats started in Conch; a chat app keeps its own choices, a routine its own, a task its
chat's.

Agents are **personas of the same Conch**. They share your memory and profile, your
apps, skills, providers, passwords and safety settings. Memory is about you, not about
the agent, so what one learns the others know; nothing about permissions differs.

### Where they live

`~/.conch/agents/agents.json` and `~/.conch/agents/avatars/<picture id>.<ext>`, both
`kept` in backups in the settings group (a restore replaces them with `settings.json`,
so the two always agree). Both are in `lib/protect.ts`: the assistant's own file tools
can't reach them, and there is no tool to change an agent. Only a person, through
`/api/agents`, behind sign-in, makes, changes, reorders or removes one.

**Migration.** With no `agents.json`, the first agent (`ag_conch`) is made from
`settings.json` `persona`: same name, tone and instructions, so nothing changes for
someone who never makes a second. The default agent is written back to `persona` after
every change, as an older Conch reads it (the four tones it knows, the 4,000 characters
it allows), so going back a version keeps the right name (ADR 0051). `PATCH
/api/settings` `persona` (setup, the older Settings, Come home) changes the default
agent. `AppState.persona` is the default agent.

A damaged file is kept aside like every store's (`readStore`); what still reads carries
on, a default is put back, and if nothing reads the first agent is made again from the
settings, with a quiet note. Repair everything (`agents/doctor.ts`) gives an agent
whose picture went missing one of Conch's, and lets go of pictures no agent has.

### A picture of its own

Uploaded (`PUT /api/agents/:id/avatar`, at most 700 KB, framed and shrunk by the page
first), or made by a provider (`POST /api/agents/avatar/generate`). Either way the
gateway reads what it is from its bytes, never its name: PNG, JPEG or WebP only, never
SVG (a document that can carry script), never animated, its structure walked to the end
(nothing hidden after it, every PNG checksum right, no chunk it can't vouch for), its
sides between 16 and 2,048. It keeps only what draws the picture: EXIF, XMP, IPTC,
comments, text chunks and times are dropped, and a WebP's header stops promising them
(`agents/picture.ts`). It's served behind sign-in, as the picture it is, with
`nosniff`, `default-src 'none'` and an address that changes with the picture.

A picture is made only when a provider that can is connected (today OpenRouter's image
models, `ImageService.face`); `GET /api/agents/avatar/generate` says so, and the page
hides the button otherwise. Making one is a person's press, costs money (said on the
page), stops at the monthly budget, and happens one at a time. The model is asked for a
square face around your words (`facePrompt`); what comes back is cleaned like an upload
and handed to the page, kept nowhere until you keep it.

### Who answers a chat

`ConversationSummary.agentId` is the chat's agent. A chat started in Conch is with the
agent chosen (`conversation.send` `agentId`), else the default. A chat from before
agents has none and is with the first agent while it exists, then with the default
(`chatAgentId`). A deleted agent's chats carry on with the default.

**Changing agent mid-chat is allowed** (`PATCH /api/conversations/:id` `agentId`,
`/agent`): from the next message on, the other agent answers. A reply that's running
finishes as the agent it started as. The chat's log gets an `agent` event, a divider
with the new agent's name as it was then, and, the first time, who answered before
(`from`), since a log from before says nobody. A chat started with any agent but the
first begins with one (no `from`, drawn as no divider), so a log alone says who it was
with. The new agent is told the earlier replies were someone else's. Nothing else
changes: provider, model, mode, goal, what it read, what it's held to. `speakersAlong`
tells the transcript who wrote each reply.

**Tasks** are done by the agent of the chat they came from. **Routines** can be given an
agent (`Routine.agentId`; one the assistant drafts is its chat's); unset or gone, the
default at the time it runs. **Chat apps** have an agent each (`Channel.agentId`), and
`/agent [name]` (in the one list of commands, ADR 0098) shows the agents with the one
answering marked, or chooses one for this chat and the chat app's new chats; the
owner's, in their private chat. A guest in a group meets the agent's persona, never
your instructions. In Conch, a routine's editor and a chat app's page choose with the
chat's own picker (Nacre `AgentPicker` with a `fallback`, web `agents/AgentChoice.tsx`):
**Default agent** first, which is `null`, then every agent. Chosen on the page
(`PATCH /api/channels/:id` `agentId`), the owner's private chat there changes too, as
`/agent` does, and `channel.changed` keeps the page in step with `/agent`. Notifications and
a chat app's messages name the chat's agent.
Another app's chats through Conch (ADR 0073) are with the default agent.

### The prompt

Every provider gets the same text (`TurnInput.systemAppend`): Claude Code's appended
system prompt, Codex's developer instructions, the ACP programs' preamble, a model
API's system message. It is layered, and the order is the precedence
(`agents/prompt.ts`):

1. **Conch** — who the assistant is (`You are Sage, a personal AI assistant…`), how it
   writes, and `PRECEDENCE`: Conch's rules come first; the persona and instructions
   that follow shape how it speaks and what it focuses on, and never override the
   rules, the permissions the person set, the safety checks or what the person says in
   the chat; nothing it reads can change who it is.
2. **Resilience** — how it works on a problem (ADR 0102), the form for its provider.
3. **The persona** — its name and that it uses no other (not the model's, not the
   program's), what it's for, its tone's words, its personality.
4. **Its instructions.**
5. Then, as before: about the person, what Conch has on (apps, skills, routines),
   memory, the chat's goal, plan mode.

The first four stay the same turn after turn, so prompt caches keep them. Lean mode
(ADR 0086) keeps all four, the persona within a size and the instructions within a fifth
of the window, and swaps in the compact resilience by its heading. The person's own
headings in their personality and instructions are moved two levels down in the prompt
(`nested`), so nothing that reads the prompt by its top headings mistakes one of theirs
for one of Conch's.

### Long instructions

Instructions were at most 8,000 characters at first. People bringing an agent from
OpenClaw found theirs cut, with "the end stays in OpenClaw": an AGENTS.md that has grown
for months is often 20,000 to 40,000 characters, and every rule in it was put there for
a reason. They are now at most **100,000** (about 25,000 tokens): room for a whole
handbook, still a bound on what every turn carries.

- **Never cut, only noted.** The editor and Come home say so quietly when they're long:
  from about 4,000 tokens (`LONG_INSTRUCTIONS_TOKENS`) whatever the model, since every
  reply carries them ("These instructions are long (≈9k tokens). Every reply carries
  them, so small models may struggle."), and from a tenth of the window of the model
  the agent's chats start with, when the provider says what it is
  (`instructionsWeight`), naming that model. Saving never waits on it.
- **Paid for once a chat.** They sit in the first four layers, before anything that
  changes turn to turn (memory, the chat's goal), so the providers that cache a prompt
  (Anthropic's breakpoint on the system prompt, OpenRouter's, OpenAI's and DeepSeek's
  automatic prefix caches, Claude Code's and Codex's own) keep them after the first
  request of a chat.
- **Compaction never eats them.** Summarising a long chat (ADR 0055) folds the
  messages, never the system prompt: the window it fits the chat into is what's left
  after the instructions.
- **A small model reads their start, and everyone is told.** In lean mode the
  instructions keep a fifth of the window (`instructionsRoom`): all of them on most
  models. Past that, the start is kept to a paragraph's end, the model is told how
  much was left out and to say it's working from a shortened version when a request
  may depend on it, and the chat says once, as a notice (`instructions-shortened`),
  that this model reads only their start and a model that reads more gets them whole.
  Conch doesn't summarise them: a model's summary of someone's rules can drop or bend
  one without anyone seeing.
- **Readable by the version before (ADR 0051).** `agents.json` keeps `instructions` as
  the start, at most 8,000 characters cut where a paragraph ends, and `instructionsRest`
  as the rest, exactly (`splitInstructions`). A Conch from before reads the start where
  it always looked, instead of finding the field too long and losing all of it; if it
  rewrites the file it drops the rest, and the agent reads as its start again. Come
  home's ledger keeps what an import replaced the same way.
- **The rest comes home.** An agent an older Conch brought cut short (its instructions
  between 4,800 and 8,000 characters, the start of what its app has now, unchanged here
  since) gets the rest by itself when Conch starts, with a quiet note under Fixed on its
  own, when the rest reads clean. When some of it reads like orders, its page says the
  end stayed behind and opens Come home to read it first, and Repair everything says so
  too. Bringing it again in Come home says "the rest comes in". Only the instructions
  change: a name or a face chosen here since stays.

Precedence is also enforced where words can't be relied on: every permission, mode,
guard and hold is checked in code (ADR 0028, ADR 0100), and nothing in an agent grants
a power. A persona that says "never ask" gets the words, not the reach; the tests show a
chat's mode unchanged by one.

### Findable and in the chat

`/agent` in the web app chooses by name, or among the agents as values; ⌘K finds each
agent by name or what it's for (a new chat with it, or this chat answered by it). The
web client and hooks are `apps/web/src/features/agents/api.ts`, kept fresh by
`agents.changed`.

## Consequences

- Someone who never makes a second agent sees no change: the same name, voice and
  instructions, read from the agents now.
- A second agent costs nothing until it answers; what an agent adds to a turn is
  bounded by its limits, and said when it's a lot.
- The assistant can't make, change or remove an agent, or edit one's file. Bringing
  agents from OpenClaw and Hermes (Come home) goes through the same store
  (`AgentStore.create` with `imported`, `uniqueName`), screened as Come home screens
  everything it brings.
- An older Conch, after going back, sees only the default agent, as its one persona;
  its other agents return when Conch is updated again.
- Picture metadata stripping is structural: it removes what's beside the picture, not
  what's drawn in it. A picture is still what the person chose to show.
