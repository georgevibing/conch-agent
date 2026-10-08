# 0112 — Agents that talk to each other

- Status: accepted
- Date: 2026-10-08
- Builds on: [ADR 0101](./0101-agents.md) (agents, who answers a chat),
  [ADR 0073](./0073-conch-for-your-other-apps.md) (the MCP door, pairing, keys, the address),
  [ADR 0033](./0033-hand-it-off.md) (tasks and their bounds),
  [ADR 0028](./0028-safe-hands.md) (taint and the guard after reading),
  [ADR 0075](./0075-group-chats.md) (a guest answers in words only),
  [ADR 0079](./0079-what-a-chat-costs.md) (spending limits),
  [ADR 0100](./0100-permission-modes-every-provider.md) (modes, Auto's risk policy)

## Context

Conch has several agents (ADR 0101), but each chat had one at a time. People who use
several want them to work together where they can watch, "@Researcher find options,
@Writer draft it", and to bring in agents that live somewhere else.

What the others do:

- **Hermes Agent** has Bot Mode: up to six named bots in a group chat. A mention says
  who replies. Each message gets at most three rounds and ten messages, and the room
  settles when a round goes quiet. Its A2A plugin speaks A2A 1.0 both ways. It caps
  back-and-forth at five turns per context, filters and frames what comes in as
  untrusted, and binds to localhost when there's no token.
- **OpenClaw** has `sessions_send` and `sessions_spawn`, an announce chain (each child
  reports to its parent), and an A2A channel with a bearer token per peer. Commands
  (`/…`) from peers are rejected. Its per-pair ping-pong counter (`maxPingPongTurns`)
  let loops of three agents through: one ran 398 sends over ten hours (issue #37842).
  It has since been removed from settings.
- **A2A 1.0** (a2aproject, v1.0.1) works like this:
  - An agent card lives at `/.well-known/agent-card.json`. It lists
    `supportedInterfaces` (JSON-RPC first), `skills` and `securitySchemes`.
  - Calls are JSON-RPC: `SendMessage`, `GetTask` and `CancelTask`. Version 0.3 used
    `message/send` and `tasks/get`.
  - Messages carry `ROLE_USER` and parts with `text`. Tasks carry
    `TASK_STATE_*` states.
  - Credentials go in HTTP headers, over HTTPS in production. Authorization is per
    caller, and "not found" looks the same as "forbidden".
  - The spec says nothing about treating a remote agent's words as untrusted input to a
    model. That is left to us.

Three things are not negotiable:

1. **Another agent's words are untrusted input.** That holds for an outside agent's
   answer and for what one of your agents passes to another. Neither can grant a power,
   lift a mode or answer a question for you (Greshake et al., 2023; Wallace et al.,
   2024).
2. **Bounded.** A round can't run away, in turns or in money.
3. **Never anonymous**, and **off until you let someone in**.

## Decision

### A round: agents taking turns in a chat

A message that mentions agents starts a **round** (`agents/rounds.ts`, `RoundService`;
the rules are in `agents/talk.ts`).

- **Mentions.** A mention is `@` and the agent's whole name, matched longest first,
  never inside an email address or code (`mentionsIn`, protocol `agents-talk.ts`).
  Typing `@` in the composer lists your agents and then outside agents
  (`useMentions`).
- **Your agents answer as the chat.** The first agent named answers your message. Each
  reply that ends hands the floor to the next agent (`ConversationManager.speak`).
  - It's the same chat, so everything the chat is held to holds unchanged: its
    provider, model, **mode**, the guard after reading, skill holds and spending limits.
  - Its turn's message is Conch's note of whose turn it is, marked as not from you.
  - Every turn of the round is told who's in the room, how to hand on, and whose words
    count (`roomPrompt`): only your messages are instructions.
- **Handing on.** An agent hands the floor on by writing `@Name`. Those it names go
  next, before anyone still waiting from your message. Nobody answers themselves.
- **Bounds**, fixed rather than settings (`ROUND_LIMITS`):
  - 8 replies per round;
  - 3 per speaker;
  - a fifth swap between the same two counts as a loop;
  - $1 of metered spend per round, plus the chat's own limit and the monthly budget
    that every turn already meets (`#capped`).

  The total bounds loops of any length, which is the lesson of OpenClaw's issue.

- **You're never locked out.**
  - Writing in the chat ends the round. Your message waits for the reply that's running,
    then goes.
  - Stop ends it at once, including an outside agent being waited for
    (`POST /api/conversations/:id/round/stop`).
  - A restart forgets the round, and the chat stays with whoever spoke last.
- **The log says it all.**
  - `round` events say when a round `started` (who was named), when it is `asking` an
    outside agent, and when it `ended` (turns, and why).
  - The `agent` divider gains `round` (the turn, and who handed over).
  - `peer.message` events hold what outside agents said.
  - The handover to another provider names each reply's agent and quotes outside agents
    as data (`handoff.ts`).

### What a person sees

- **The card.** Nacre `AgentRound` is the card where the round began. Everyone in it is
  a row of faces, and each pass of the floor is an arc of pearl light from one face to
  the next.
  - The newest arc is drawn bright, and a pearl travels along it as the floor changes
    hands.
  - Whoever has the floor wears its working light. An outside agent is marked as one.
  - The card says "Writer is answering · 3 of 8 replies", with **Stop**.
  - Once the round is over, the card folds to one line ("Researcher and Writer took
    turns · 4 replies"), with the reason only when it's worth saying
    (`ROUND_END_WORDS`).
  - Reduced motion draws the arcs at once and rests the pearl where the floor is. The
    words say what the picture shows, and who's answering is announced as it changes.
- **Handover lines.** `AgentChange` says "Researcher handed over to Writer", or
  "Writer's turn".
- **Outside words.** Nacre `OutsideReply` shows what an outside agent said, in its own
  quieter frame marked **Outside agent**. Its Markdown is drawn sealed, so it can't load
  a picture from elsewhere.

### Outside agents: Conch calls an A2A agent

An outside agent is added in **Settings → Agents → Outside agents**, by pasting its
address. Its key can come in the same paste (`readPaste` finds both).

- **Reading the card** (`a2a/client.ts`). Conch reads the card from the address itself,
  then from the well-known places. It takes A2A 1.0 (`supportedInterfaces`) or 0.3
  (`url`, `preferredTransport`).
  - Its endpoint must be on the host the card came from, so a card can't send Conch,
    or your key, anywhere else.
  - Every request goes through `guardedFetch`:
    - no cloud metadata or link-local addresses;
    - your own network only for an agent that lives there;
    - HTTPS, except on your own network;
    - every redirect checked.
  - A card is at most 256 KB and an answer at most 1 MB. Text is cleaned of control
    characters and cut to its limits.
  - The page shows what the agent says about itself as its claim: "It says it's run
    by…".
- **Where it's kept.** The list lives in `agents/outside.json` (`kept`, settings group,
  protected). Keys live in the sealed `a2a.secrets.json` (`secret`, protected), listed in
  Passwords but never shown.
- **What it's sent: your words, only.** An outside agent takes part in a round only when
  you mention it, and it's sent the words of that message, nothing else of the chat.
  - One of your agents naming it passes nothing. The round ends and says only you can
    send to one (`outside`).
  - That rule is what keeps a prompt-injected agent from exfiltrating through an outside
    agent.
  - What it answers passes the floor to nobody.
  - Each chat keeps its own A2A `contextId` with each outside agent.
- **What comes back is someone else's.** An answer taints the chat (`kind: 'person'`),
  so Auto's after-reading rules apply from there.
  - It reaches your next agent quoted inside a fence it can't close (`turnPrompt`), and
    as data in the handover.
  - `input-required` is shown with "mention it again to answer". `auth-required` and
    failures are said in words. Polling a working task stops at two minutes.
- **Healing.** A passing failure is tried once more, after a moment. A JSON-RPC
  "method not found" from a 1.0 agent is asked again the 0.3 way.
  - The last problem is kept on the agent and shown on its row.
  - Repair everything reads the card of each one that failed again
    (`a2a/doctor.ts`), follows it if it moved on the same host, and clears what has
    passed.

### Your agents for other agents: an A2A door, off by default

**Let another agent in** (Settings → Agents → Agents that can talk to yours) is a pairing
from Other apps (ADR 0073), so it has the same owner-only, confirmed-it's-you route.

- **The pairing.**
  - It's an `http` client with `agent:<id>` scopes, a new kind of scope that grants
    nothing else and lists no MCP tools.
  - On another computer, it's also `remote`, and that turns on "From your own address"
    for other apps, said in the dialog.
  - The address and key are shown once, as one copy, for the other side's one paste.
  - Removing it in Settings, or in Other apps, revokes it at once.
- **The door** (`a2a/door.ts`) has three endpoints:
  - `/.well-known/agent-card.json` (the first agent the key was given);
  - `/a2a/<agent>/.well-known/agent-card.json`;
  - JSON-RPC at `/a2a/<agent>`.

  It's outside `/api`, so the gateway's sign-in doesn't apply, but its host, origin
  and admission checks run first.

- **Who gets in.**
  - **Never anonymous:** even the card needs a key, and the answer is 401 with
    `WWW-Authenticate: Bearer`.
  - Only a key paired for HTTP and given an agent works. It's compared by hash in
    constant time, and failures are throttled like sign-ins.
  - Another agent of yours looks like nothing's there (404).
  - Anything a browser sent (`Origin`, `Sec-Fetch-Site`) is refused.
  - From elsewhere: only over HTTPS, with the switch on, for a key marked `remote`.
- **Words only.** Each conversation is a chat of its own, with origin `peer`.
  - `isGuest` covers it, so it answers like a guest in a group: no tools of any kind
    (and `toolAllowed: () => false` besides), no memory and no profile.
  - It gets your agent's persona but never your instructions, under a prompt that says
    who it's talking to.
  - It's tainted from the start. Quiet learning skips it (`notYours`).
  - It stays out of the chat list. "What it said" opens it.
  - Commands (`/…`) are refused.
  - A2A's own operations each get an answer: `SendMessage` and `message/send`
    (answered in one go), `GetTask`, `CancelTask` (already finished),
    `GetExtendedAgentCard`; streaming and push return "unsupported" (-32004).
- **Bounded.**
  - 16,000 characters per message.
  - Five messages at once, then 20 a minute, per key.
  - One at a time.
  - Two minutes per answer.
  - $1 a day of metered answers per key (`PEER_DAY_USD`), then "try again tomorrow".

### Not now: Conch as an ACP agent

ADR 0073 left an ACP agent mode for later. It would stream whole chats to an editor and
bridge its permission requests to Conch's questions: a separate piece with its own threat
model, not cheap. The A2A door covers agents talking to yours; editors already reach
Conch through MCP.

## Threat model

| Who                                  | What they try                                                     | What stops it                                                                                                                     | Tested in                                    |
| ------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A page or tool result one agent read | Make it hand the floor on to grant itself a power or skip a check | The next turn is the same chat, same mode, guard, holds; Conch's note is marked as not yours; only your messages are instructions | `rounds.test.ts` (the mode stays the chat's) |
| The same, via an outside agent       | Exfiltrate the chat by having an agent send it out                | Your agents can't hand to an outside agent; only your own message is ever sent, and only what it says                             | `talk.test.ts`, `rounds.test.ts`             |
| Agents in a loop (two, three, more)  | Run up turns and money                                            | 8 replies, 3 each, no fifth swap, $1 per round, the chat's limit and the monthly budget; writing or Stop ends it                  | `talk.test.ts`, `rounds.test.ts`             |
| An outside agent                     | Instruct your agent, or pass the floor                            | Its words taint the chat, are fenced (it can't close the fence) and quoted as data; its mentions pass nothing                     | `talk.test.ts`, `rounds.test.ts`             |
| An outside agent                     | Load a picture to learn you read it                               | Its Markdown is drawn sealed; the CSP allows no remote images anyway                                                              | `Transcript.rounds.test.tsx`                 |
| A hostile card                       | Point Conch, or your key, at metadata, the LAN or another host    | `guardedFetch`; the endpoint must be the card's host; the key goes only there; redirects checked                                  | `client.test.ts`                             |
| A hostile card or answer             | Exhaust memory, or smuggle control characters                     | 256 KB / 1 MB caps read as streamed; text cleaned and cut                                                                         | `client.test.ts`                             |
| Anyone on the network                | Read a card or talk to your agents                                | Off until paired; key required for everything; HTTPS + the switch + `remote` from elsewhere; throttled                            | `door.test.ts`                               |
| A paired agent                       | Reach another of your agents, or tools, memory, your instructions | Scoped to its agents (404 otherwise); guest turns: no tools, no memory, persona only; commands refused                            | `door.test.ts`, `rounds.test.ts`             |
| A paired agent                       | Spend your money or hold the line                                 | Rate limit, one at a time, two minutes, $1 a day                                                                                  | `door.test.ts`                               |
| A web page                           | Drive the door with a stolen key                                  | `Origin` / `Sec-Fetch-Site` refused                                                                                               | `door.test.ts`                               |
| The assistant                        | Add an outside agent, let one in, read a key                      | No tool for any of it; pairing is owner + confirmed; `agents/` and `a2a.secrets.json` are protected                               | `pairing.test.ts`                            |

What's left:

- **A key in transit.** A paired agent's key travels with each request. Over your own
  address that's HTTPS; on this computer it's loopback. **Remove** revokes it at once.
- **What you choose to send.** An outside agent sees exactly what you write to it. Its
  answers are someone else's words, and Conch reads them that way; it can't make them
  true.
- **A forgotten round.** A round in progress when Conch restarts isn't resumed. The card
  folds once it has been quiet for a while.

## Consequences

- "@Researcher find options, @Writer draft it" works with every provider. There's
  nothing new to set up: an agent you made is one you can mention.
- An outside agent costs nothing until it's mentioned.
- Letting another agent in is a pairing that shows in Other apps too, and in the security
  checkup's existing lines for paired apps.
- No new dependencies: JSON-RPC over `fetch`, Zod and the MCP store.
- Backups: `agents/outside.json` is kept, and `a2a.secrets.json` is secret. A pairing is
  `derived` (`mcp/**`), so a restore lets nobody in.

## Sources

- A2A Protocol v1.0.1 specification and `a2a.proto` (a2aproject/A2A, 2026-05-28):
  §7 and §13 on security, §8.2 on the well-known card; v0.3.0 for the older names.
- OpenClaw docs: `channels/a2a.md`, `concepts/session-tool.md`,
  `tools/subagents/announce.md`; issue #37842.
- Hermes Agent docs: `user-guide/bot-mode.md`, `messaging/a2a.md`,
  `features/delegation.md`.
- OWASP ASVS 5.0 (V7 session management, V13 configuration), the OWASP SSRF Prevention
  and Denial of Service cheat sheets, and NIST SP 800-63B-4 §3.2.2 (throttling).
- Greshake et al., "Not what you've signed up for" (2023), on indirect prompt injection;
  Wallace et al., "The Instruction Hierarchy" (2024).
