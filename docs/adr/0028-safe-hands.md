# 0028 — Safe hands: checking after reading, sealed commands, activity, skills read first

- Status: accepted
- Date: 2026-10-01
- Builds on: [ADR 0008](./0008-access-and-hardening.md) (the agent is untrusted input),
  [ADR 0013](./0013-skills.md) (skills from other agents' folders),
  [ADR 0014](./0014-browser.md) (`<page-content>`),
  [ADR 0025](./0025-passwords.md) (protected paths)

## Context

An assistant that reads the web, your email and your chat apps, and that can
also run commands and send things, is one prompt injection away from doing
what a stranger wrote. Three sources describe the risk:

- **Greshake et al. (2023):** indirect prompt injection.
- **Willison's "lethal trifecta":** private data, untrusted content, and a way
  out.
- **The ClawHavoc campaign (reported February 2026):** malicious skills
  uploaded to the ClawHub registry, most hiding info-stealers behind
  "prerequisite" steps.

Related projects document different trade-offs. OpenClaw runs tools on the host
unless sandboxing is turned on; Hermes treats the operating system as its
security boundary. Conch needs a guard that holds in every mode, without a
sandbox having to be set up first.

**A gap Conch had too.** Conch's only gate on Claude Code's own tools was
`canUseTool`, and the SDK doesn't call it when a mode allows by itself. This
was verified for real (the SDK even warns `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`).
So in Full trust and Accept edits, the protected-path check (ADR 0025) and
integrations turned "off" didn't hold.

## Decision

### 1. Check before acting on what it read (the guard)

A chat becomes **tainted** the first time it takes something in from outside:

- a page (`WebFetch`, `WebSearch`, Conch's browser);
- a download (`Bash` with `curl`/`wget`/a URL);
- an integration's tool (email, Slack, Notion…);
- a message from someone other than the owner on a chat app.

Each source is a `taint` event in the chat's own log. The guard survives a
restart, and the transcript says it once, quietly: "Read news.example. From
here on, I'll check with you before running commands or sending anything."

Once tainted, these **ask**, whatever the mode:

- any command;
- a file change outside the work folder;
- a `WebFetch` whose address could carry data (a long query, or a long opaque
  path segment);
- an integration tool that isn't read-only.

Reading on stays free. The card adds a `GuardNote` ("This chat read
news.example, which could be trying to steer me. So I'm checking before I run
a command."). It offers no "always", and even an "always" answer counts as
this once. Earlier "always allow" answers and integrations set to "Don't ask"
don't skip it.

**How it holds in every mode.**

- **Claude Code.** Every tool call passes through a **PreToolUse hook**. The
  hook denies protected paths and tools turned off on the Integrations page,
  and returns `ask` from `TurnInput.guard`. That reaches `canUseTool` even in
  bypass mode: verified against the real SDK, and through Conch's own engine
  with a real Claude Code turn.
- **Codex** can't ask before a step. A tainted chat runs `workspace-write`
  (no network) instead of `danger-full-access`.
- **API engines** have no shell. Their bridged integration tools go through
  the manager's permission broker, which applies the same rule.
- **The browser** asks once per site in a tainted chat, even for a trusted
  site or in Full trust.

**Chat apps.** A guard question in someone else's chat (Telegram, Discord,
Slack) goes to the owner, in Conch and as a notification (ADR 0027). The
person who wrote the message can't approve their own request. Their chat
says, "I've asked Ada to OK it."

### 2. Sealed commands

Claude Code runs commands in the computer's own sandbox: Seatbelt on macOS,
bubblewrap on Linux. Measured before choosing: with no lists, a sealed command
can write only to its working folder (not `/tmp`, not `~/.npm`), while reading
and the network stay open. Conch sets:

- **`allowWrite`:** the work folder, temp, and the caches installs and builds
  use (npm, pnpm, yarn, bun, cargo, go, gradle, maven, NuGet, deno, Library
  caches).
- **`denyRead`:** where keys live. SSH, GPG, AWS, Azure, Google Cloud,
  Kubernetes, Docker, `.netrc`, Git credentials, the GitHub CLI, pass,
  keychains, cookies, Safari, Mail, Messages, browser profiles, 1Password and
  Bitwarden data, Conch's vault and keys, and Conch's own browser profile.
- **`allowUnsandboxedCommands`:** on. A command that needs out
  (`dangerouslyDisableSandbox`) always asks, tainted or not.
- **`failIfUnavailable`:** off. Conch reports availability itself (Settings,
  Repair everything).

On Linux it needs bubblewrap and socat; Conch shows the command. Windows can't
yet. Verified on macOS:

- reading `~/.ssh` fails with "Operation not permitted";
- writing outside the folder fails;
- writing inside the folder works;
- the network is open.

### 3. Settings → Security → Safety

Both checks start on, and both are `preferences`:

- **Check before acting on what it read** (`checkAfterReading`).
- **Seal commands** (`sealedCommands`).

Turning either off:

- says what could happen;
- needs a recent password or key (the server refuses `false` without it);
- shows in the security checkup with a one-press fix (`check-after-reading`,
  `sealed-commands`);
- shows in Repair everything.

### 4. Activity

`/activity`, in the sidebar and in ⌘K, is everything the assistant did across
every chat and routine, newest first, a day at a time:

- commands, file changes, pages, apps;
- what it asked and what you said, and what's still waiting;
- what untrusted things it read;
- memories.

It filters by kind and pages back in time. Each row opens the chat at that
moment (the find bar's target). It is read from the chats' own logs, so it's
complete, can't drift, and stores nothing extra. Looking around (`Read`,
`Grep`, `Glob`) is left out: doing is what counts.

### 5. Skills read before they steer anything

`skills/scan.ts` reads every text file in a skill's folder (no links
followed, at most 60 files) and says in plain words what could hurt you:

- downloading and running something (`curl | sh`, `iex (iwr …)`, decoded
  payloads, turning off quarantine);
- reaching for keys, saved passwords and wallets;
- sending to drop boxes (webhook.site, ngrok, Discord webhooks…);
- telling the assistant to ignore its rules or hide things;
- fake "prerequisites";
- long encoded blobs;
- invisible characters that smuggle instructions (tag characters, bidi
  overrides; zero-width spaces only as a warning);
- bundled Mac, Linux or Windows programs.

It's a careful reader, not an antivirus, and the permission prompts still
stand. The verdict is `clean`, `caution` or `danger`.

- **A `danger` skill is off, wherever it came from.** It is never offered to a
  model and not usable as a slash command until someone looks
  (`SkillReview`). They then turn it on with the review's hash
  (`acknowledged`). The OK is for exactly that version: any change means
  looking again.
- **Another app's skill is pinned when turned on** (OpenClaw, Hermes, Claude
  Code's folders). If any file in it changes later — the supply-chain update
  ClawHavoc relied on — it's off again ("It changed in OpenClaw since you
  turned it on").

## Consequences

- Prompt injection is now a question, not an incident. The page can say
  anything; the command it wants still needs your yes, with the reason in
  front of you. Ordinary work — reading, editing the project, Full trust
  before anything untrusted — doesn't ask more than before.
- **The gap is closed.** Protected paths and turned-off tools hold in every
  mode. Mode-independent checks belong in `TurnInput.guard`, never only in
  `canUseTool` (AGENTS.md).
- **Known limits:**
  - A file inside the work folder that someone else wrote (a cloned repo's
    README) doesn't taint the chat. Doing that would make every coding chat
    ask for everything.
  - The scanner can be evaded by a determined author. The pin, the prompts and
    the sealed box are the other layers.
  - Codex chats can't be asked mid-step, so they run tighter instead.

## Later changes

- **2026-10-04: `git fetch` isn't a download.** It matched `fetch` and marked
  coding chats as "downloaded something", so in Full trust every command asked.
  `git fetch` and `npm`/`pnpm`/`yarn fetch` are taken out before the rule looks;
  the rule is otherwise as broad as before. A mark made by a command is checked
  again each time the chat's marks are read (`heldTaints`), so chats marked by
  `git fetch` come free. Because the only change is that short list, nothing
  else an older rule caught comes free. Marks now name the tool call that made
  them; in older logs, it's the call that finishes right after. Either way it's
  the call with that id started last *before* the mark, since ids can repeat.
  Pages, apps, people, and marks carried in from another chat are never looked
  at again.
- **2026-10-04: a mode picked mid-turn holds from the next step.** It used to wait
  for the next message. The running turn's `options.permissionMode` changes in
  place. Asks still waiting that Full trust would have allowed are allowed. Claude
  Code switches with `setPermissionMode`. Full trust picked mid-turn runs there as
  Ask, with Conch answering each ask itself, so the SDK's skip-permissions flag is
  only ever set for turns that start in Full trust. What asks whatever the mode
  still asks.
