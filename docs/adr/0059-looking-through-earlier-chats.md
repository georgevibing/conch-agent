# 0059 — Looking through earlier chats

- Status: accepted
- Date: 2026-10-03
- Builds on: [ADR 0007](./0007-search.md) (search), [ADR 0028](./0028-safe-hands.md)
  (the guard after reading), [ADR 0032](./0032-it-learns-you.md) (it learns you),
  [ADR 0018](./0018-channels.md) and [ADR 0043](./0043-whatsapp-and-signal.md)
  (chat apps, other people), [ADR 0033](./0033-hand-it-off.md) and
  [ADR 0038](./0038-durable-verified-tasks.md) (tasks), [ADR 0047](./0047-skill-scope.md) (skill scope)

## Context

Every chat is already in a full-text index (ADR 0007): ranked, typo-forgiving,
on this computer. Only people could use it, through ⌘K. The assistant couldn't.
"What did we decide about the venue last week?" or "use the same plan as in the
Lisbon chat" failed unless the answer happened to be a memory.

Other agents look back too. Hermes Agent has a session search over its own state
database. OpenClaw has session search, and a helper that digs through history when
memory comes up empty. Both treat history as one more thing the agent can read.

History is not one more thing. It holds everything a person said to their
assistant, and some of what other people said to it. Three risks come with
reading it from a chat:

- **Someone else asks.** A stranger let in on Telegram talks to the same
  assistant. If they can make it search, they can read the owner's history
  (OWASP Top 10 for LLM Applications 2025, LLM02 Sensitive Information
  Disclosure).
- **Old words steer.** A chat that read a web page, an email or a stranger's
  message holds text written to steer a model (Greshake et al., 2023, indirect
  prompt injection; OWASP LLM01). Searching brings that text into a fresh chat
  that never read anything from outside.
- **Secrets turn up.** A key pasted months ago, a command that carried a token,
  a value Passwords handed out.

## Decision

Two read-only tools, `search_chats` and `read_chat` (`search/past.ts`), for every
provider by the same path as Conch's other tools: host tools for model APIs and
the programs Conch drives over ACP, the `mcp__conch__` bridge for Claude Code and
Codex.

### 1. The same search

`search_chats` asks `SearchService.search` and keeps its ranking, grouping, fuzzy
fallback and snippets as they are, so the assistant finds what ⌘K finds, in the
same order. `read_chat` reads a stretch of one chat from the same index
(`SearchIndex.slice`): twelve messages around a line, or before or after it to
read on, or how the chat ended. Both answer in compact JSON whose shapes are in
`@conch/protocol` (`PastChatsFound`, `PastChatRead`): each chat's id, title, when
it was last active, whether it's archived, where it happened, and for each line
who said it (`you`, `assistant`, `them`, `step`), when, and the words.

- **The chat it's asked from is left out.** It already has it.
- **Archived chats are included** and marked `archived`. Archiving puts a chat
  out of the list, not out of reach; ⌘K finds them the same way.
- **Small.** At most eight chats and three lines each, snippets of about 150
  characters, 8,000 characters in all; a read keeps each message to 1,200
  characters (4,000 for the one asked for) and 12,000 in all, dropping what's
  farthest from the line first and saying there's more. A result never floods
  the context.
- **A broken index says so** in words the model can pass on, instead of failing
  the turn.

### 2. Only for you

The tools don't exist in a chat with someone else's words in it: a chat app's
other people, or a message the owner forwarded in. Both are a `person` taint
(ADR 0028), set by the channel before the turn starts. `ToolContext` now
carries `taints()` (everything the chat read, whatever the guard setting), and
`pastChatTools` returns nothing when one is a `person`. The tools check again
when they run, in case someone came in mid-turn. A turn that can't say what its
chat read gets nothing.

A forward costs the owner the tools in that chat. That's deliberate: a forwarded
email is someone else's words, which is why It learns you (ADR 0032) skips
those chats too, and **New chat** brings them back.

Routine runs and background tasks never get them. Unattended runs don't get
Conch's own tools at all (`ConversationManager`), and a task held to a list of
tools (`toolScope`) only gets the tools on its list, which never name these.
The prompt section follows the tools: only for a chat that has them.

They need nothing a skill must declare (`skills/permissions.ts`): reading is
never limited, like `recall`. What a held chat could _do_ with what it read
stays held to the skill's list.

### 3. What it reads comes with what it read

A chat that read something from outside, or has someone else's words, could be
trying to steer whoever reads it. When a search or a read brings back lines from
such a chat, the chat asking is tainted too, with one source per chat: `app`,
labelled `your chat “<title>”`. So the card that asks before a command or a send
says "This chat read things in your chat “Venue research”". The chat isn't left
out: what the owner can read in Conch, the assistant can read, and the guard
does its part. The source is `app`, never `person`, so carrying it in doesn't
take the tools away; and the answer marks such chats `untrusted`, with a
sentence telling the model to treat them as information, never instructions.

Lines a chat app's other people wrote come back as `them`, never `you`, and the
chat names who (`others: "Ana on Telegram"`).

### 4. Never a secret

The index holds what was said, not what tools returned, and assistant text is
redacted as it's logged. But a person's own message isn't, and neither is a
command the assistant ran. So everything the tools return passes two filters:
Passwords' redactor (every value it has handed out, in the forms values travel
in) and `scrubSecrets`, which replaces shapes that are keys whatever surrounds
them (`sk-…`, `ghp_…`, `xoxb-…`, `AKIA…`, private keys, JWTs, bot tokens,
`Bearer …`, `user:password@`) and the value after `password:`, `token=`,
"my PIN is". The same filtered words are what the chat logs. A password that
looks like a word, written with no label, can't be told from a word; the prompt
tells the model never to pass one on.

### 5. Seen in the chat and in Activity

Conch's own tools aren't tool rows in the transcript. A look is a `chats.looked`
event: what it looked for, and the chats and lines it found. The chat shows it
with Nacre `PastChatsLook`, a quiet row ("Looked through your chats · “venue” ·
2 chats") that opens to `PastChatsList`; each line opens its chat at that line,
lit, as a search result does. Activity lists it with what Conch remembers:
"Looked through your chats for “venue”", "Read your chat “Wedding planning”".

### 6. When to use it

The prompt (`PAST_CHATS_PROMPT`) says: when the person refers to an earlier
conversation or a decision, a plan or a file from before, look before saying you
don't know; `recall` first for facts about the person; say which chat it was in.

## Consequences

- "Like last time" works, with every provider, with nothing to set up.
- A stranger on a chat app can't reach the owner's history, and old words can't
  steer a new chat without the guard knowing.
- A tainted look marks the chat for good, like any other read: the next command
  asks. That's the cost of reading.
- **Known limits:**
  - Words, not meaning: the index matches spelling (ADR 0007). "Our honeymoon"
    won't find "the trip to Bali" unless one of those words was said.
  - A forward takes the tools away from that chat until **New chat**.
  - Secrets are caught by shape and by Passwords; a bare password with no label
    can't be.
