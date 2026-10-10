# 0100 — Permission modes that mean the same with every provider

- Status: accepted; Claude Code's row amended by [ADR 0118](./0118-auto-judges-every-app-step.md)
  (Auto runs as `default`, answered by Conch); the modes amended by
  [ADR 0119](./0119-four-modes-auto-by-default.md) (four modes: Edit freely gone, Plan only
  called Read only; new chats start in Auto); the score, the second look and four tiers amended
  by [ADR 0128](./0128-auto-reads-what-you-asked-for.md) (a step the person asked for scores
  two at most; the look lifts a question; non-production infrastructure, a new remote, a pushed
  image and an assistant's permission files ask before reading)
- Date: 2026-10-07
- Builds on: [ADR 0028](./0028-safe-hands.md) (the guard after reading, the sealed box),
  [ADR 0031](./0031-skill-trust.md) (skill holds), [ADR 0033](./0033-hand-it-off.md)
  (a task has its chat's powers), [ADR 0036](./0036-provider-consistency.md),
  [ADR 0066](./0066-codex-cli-and-coding-agents.md) (Codex CLI asks through Conch),
  [ADR 0098](./0098-chat-commands-every-provider-understands.md)

## Context

Conch offered five modes: Ask first, Auto, Edit freely, Plan only and Full trust. An
audit found that they didn't mean one thing:

- **Auto was Claude Code's alone.** Only a Claude Code model with its own auto-mode
  classifier offered it, so the chat's picker usually didn't show it, and every other
  provider fell back to Ask first.
- **Full trust still asked a lot.** Codex CLI ran sealed with no network even in Full
  trust, so `git push` and `npm install` failed with nothing to ask. A Gmail draft, a
  Slack message or a calendar change always showed its preview card. A browser upload
  always asked.
- **The modes weren't a ladder.** Auto and Edit freely each let different things through,
  so a task's "never more than its chat" had two incomparable answers.
- **The words lived in two places.** The chat apps' `/mode` menu had its own copy, and
  Settings → Models was a plain radio list unlike the chat's picker.

People asked for two things. **Full trust** should be what every agent calls YOLO: it
never stops, except for a tiny, justified list. **Auto** should be very permissive and
never ask about routine work, yet notice something serious and stop for that alone.

## Decision

### The ladder

One definition, `MODE_WORDS` in `@conch/protocol` (`modes.ts`): the chat's picker,
Settings → Models (Nacre `ModeChoice`), the chat apps' `/mode`, the documentation and
the restore preview all read it, with the same icons from `features/models/catalog.tsx`.
From the least the assistant does alone to the most (`MODE_POWER`):

| Mode            | Goes ahead without asking                                    | Stops for                                                                          |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **Plan only**   | Reading and planning                                         | Everything that changes something is refused; **Start** ends planning              |
| **Ask first**   | Reading                                                      | Every change, command and app write                                                |
| **Edit freely** | Changing files in the work folder                            | Commands, app writes, files elsewhere                                              |
| **Auto**        | Routine work: edits, commands, installs, pushes, app actions | Something serious (the risk policy), and the ways out once the chat read something |
| **Full trust**  | Everything                                                   | Only the circuit breaker and what no mode lifts (below)                            |

It maps onto what other agents offer: Claude Code's `default` / `acceptEdits` / `plan` /
`auto` / `bypassPermissions`; Gemini CLI's `plan < default < autoEdit < yolo`; Codex's
read-only, auto (workspace) and full access; VS Code's Manual, Assisted (an LLM judge)
and Allow all. A task's mode is never more than its chat's, now on one ladder
(`noMoreThan`).

### Auto: a risk policy, scored

`conversations/risk.ts` reads each step — a command (inside `bash -c`, `$(…)`, `sudo`,
`env`, chains and pipes), a file path, an app's tool — and finds what it could do at its
worst. Each rule has a **harm** (severe: your keys, someone else's systems, a disk,
production, code from a stranger; moderate: data leaving, a new dependency) and says
whether it is **lasting** (Conch can't put it back). Undo (ADR 0030) puts back anything
a file tool changed and anything in the work folder, so those aren't lasting; a push, a
message, a deletion elsewhere, a secret read, are. The chat adds **provenance**: whether
it read something untrusted (ADR 0028).

> score = harm (severe 2, moderate 1) + lasting (1) + untrusted (1). Three or more asks.

So something severe that can't be put back always asks; severe-but-undoable and
moderate-but-lasting ask only once the chat read something; the rest never asks.

> **Amended by [ADR 0128](./0128-auto-reads-what-you-asked-for.md).** A boundary the person
> stated adds a point; a step they asked for in their own words scores two at most, so it goes
> ahead before and after reading. Only the kinds no words ask for (keys, a stranger's code
> decoded from a blob, money, an assistant's own permission files, the circuit breaker) keep
> their score whatever is said. Non-production infrastructure, a new remote and a pushed image
> moved to the left column; `git reset --hard` on a clean tree asks nowhere.

| Severe and lasting: always asks                                                                                   | Asks only after reading something                                                        |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Running downloaded or decoded code (`curl … \| sh`, `iex (iwr …)`, `base64 -d \| sh`), installing from an address | Pushing; a new dependency (`npm i x`, `pip install x`, `npx x`)                          |
| Reading keys and sign-ins (`~/.ssh/id_*`, `~/.aws/credentials`, the keychain, `gh auth token`, cloud metadata)    | Sending data out (`curl -d`, `scp`, `rsync host:`, `ssh host`, a script with `requests`) |
| Drop boxes (webhook.site, ngrok, pastebin…), reverse shells                                                       | Throwing away uncommitted work (`git reset --hard`, `git clean -fdx`)                    |
| Deleting outside the work folder; force-pushing or deleting a shared branch                                       | Shell start-up files, LaunchAgents, cron, systemd; git hooks, CI workflows               |
| `sudo`, setuid, adding users, `authorized_keys`, sudoers                                                          | Applying or deploying to non-production infrastructure                                   |
| Turning off Gatekeeper, SIP, quarantine, SELinux, the firewall, Defender                                          | Tunnels to this computer; another agent with its checks off                              |
| Destroying infrastructure, production deploys and migrations, granting IAM, secrets and DNS, wiping databases     | Changing an assistant's own permission files                                             |
| Publishing a package or a release, making a repository public; an app's tool that deletes                         |                                                                                          |

Built from Claude Code's auto-mode defaults (what its classifier blocks and allows),
Codex's sandbox presets, Gemini CLI's policy engine, VS Code's terminal auto-approve
rules, Cursor's auto-run lists, and the OWASP Top 10 for LLM applications (LLM01 prompt
injection, LLM02 sensitive information disclosure, LLM06 excessive agency) and its
agentic threats (tool misuse, privilege compromise). Two places differ from Claude Code
on purpose: pushing to the default branch is fine (Claude Code agrees since v2.1.211),
and throwing away uncommitted work asks only after reading, because Conch's Undo can put
the work folder back.

`risk.test.ts` measures it against a corpus (`test/riskCorpus.ts`): over 200 everyday
steps of a coding and personal assistant must pass silently before and after reading
the web (false positives: 0.0%, asserted), over 40 classic ways out must pass before
reading and ask after, and over 100 serious steps must ask either way. A list is a
careful reader, not a boundary ("obfuscated commands can evade matching", as VS Code
says of its own): it only ever adds a question. The sealed box, protected paths and
Conch's own powers hold whatever it says.

**After reading, in Auto** (a person here, only things read in the chat), the guard
after reading asks for what the risk policy marks, plus an app's write and an address
that could carry what was read; it doesn't ask for every command any more. Commands
stay sealed (no network, no secrets) from the first read, so a routine one is safe to
run. With someone else's words in the chat, or nobody there (a routine, a chat app),
Auto checks every way out as before.

**Where Auto is decided.** In Conch's layer, so it holds for every provider: the guard
(`mustAsk`) asks for anything serious in every mode but Full trust, with the reason on
the card and no "Always allow"; `requestPermission` and Conch's own tools (`hostAsk`)
let the rest through in Auto. An app tool the person set to **Ask** in Apps keeps asking
in Auto (Full trust skips it); an app tool that deletes asks unless the person set it to
**Allow**, or the app to **Don't ask**. Leaving the sealed box is free in Auto until the
chat reads something.

### Auto, revisited (2026-10-08): permissive outside the box, judged after reading

People still met questions about routine work in Auto. Two cases showed why:

- **"Pull the latest code" with Codex.** Each step (`git -C … status; git remote -v`,
  `git pull --ff-only origin main`, `git log/rev-list`) asked. Codex runs Conch's tools,
  so a command that needs the network or a folder elsewhere leaves the sealed box
  (`dangerouslyDisableSandbox`), and on a computer that can't seal every command does.
  `mustAsk` let a command out of the box in Auto only while the chat had read nothing
  and a person was there; once it had read anything, every such command asked "wants to
  run outside the sealed box", whatever it was. The risk policy found nothing in them.
- **A picture on the ChatGPT plan.** Conch's own `image_models` marked the chat as having
  read "OpenRouter image service", and `image_generate` asks whenever the chat is marked,
  so the next picture on the person's own plan asked.

So:

- **Leaving the box in Auto** is free until the chat reads something, whoever's there.
  After reading, with a person here and only things read, the risk policy decides as
  for any command (`riskAsks(risk, true)`): `git pull` runs, `git push` and `curl -d`
  ask. Someone else's words in the chat, or nobody there, still ask as before. Codex
  CLI's own sandbox keeps the network on the same terms (`reach: 'network'`), since
  every command it asks about meets the same policy.
- **Conch's own steps after reading** (`hostAsk`): a managed command, input to one, a
  picture and carrying on a task go ahead in Auto unless the risk policy marks them.
  Words to other people and app writes keep asking. A skill's list still asks.
- **Spending money asks in Auto** (a request with a `cost`), with Always allow for the
  chat; the person's own plan (no extra charge) never does.
- **First-party catalogs don't taint.** `image_models` and `image_generate` bring no one
  else's words in; old marks under their label stop holding the chat (`heldTaints`).
- **More rules, both ways.** Severe and lasting now also: every setting or a project's
  `.env` piped or attached to a network program, a key file or key folder handed to
  `scp`/`rsync`/`tar`/`cp`, code from `$(curl …)` given to `python -c`, deleting `.git`,
  stopping PID 1, every process or the processes a computer runs on (`launchd`,
  `WindowServer`, `explorer.exe`…), shutting down or restarting, writing or changing
  ownership of the computer's own files (`/etc`, `/usr` but `/usr/local`, `/System`,
  `/Library`, `C:\Windows`). Moderate and lasting (asks after reading): a network
  program given a command's output (`$(…)`, backticks) or an address that carries a
  long query, and deleting a container's volumes. The corpus grew to 327 everyday
  steps (including the git above), 56 ways out and 135 serious ones.
- **A second look.** After reading, a command the rules found nothing in, that isn't
  only everyday programs and could reach out (it leaves the box, names an address or
  runs a network program: `wantsSecondLook`), goes past the person's own cheapest model
  (`risk-look.ts`, `riskLook` = `cheapModel`), fenced and datamarked like the memory
  check's (ADR 0087), once per command per turn, six seconds at most. It picks a kind;
  Conch says it in its own words. It can only add a question: no model, a timeout or an
  unreadable answer leaves the rules' verdict, and the command runs. (Since ADR 0128 it also
  lifts a question the rules asked only for what the chat read, when it sees routine work in
  service of the request.)

Ask first, Edit freely, Plan only and Full trust are unchanged, as are the circuit
breaker, protected paths, Conch's powers, tools turned Off and skill holds.

Revisited again in [ADR 0117](./0117-auto-asks-about-what-matters.md): the person's own
Conch apps read and change things in Auto after reading (asking before paying, speaking for
them, deleting or sending pages of text), reading pages and acting on a site go ahead until
the order or the message, **Always allow** holds after a restart, and a behaviour guard
watches for spam-sized sends, runs of deletes, big payments and loops, in Full trust too for
the largest.

### Full trust: never asks, but for what no mode lifts

Full trust lets everything through — commands, the sealed box, app approvals, the
words going to other people (Gmail, Slack, Calendar), a paid picture, a browser
download or upload — with every provider. The only things left are irreducible, each
because the person's trust can't reach it:

1. **The circuit breaker.** Deleting a whole folder like your home, the work folder or
   a disk (`rm -rf ~`, `rm -rf .`, `rm -rf "$DIR"/*`, `diskutil eraseDisk`) asks. One
   slip there can't be put back by anyone. Claude Code asks for these in bypass mode
   too (its "critical paths").
2. **Conch's own keys and powers** are refused, not asked: Passwords, Conch's keys and
   sign-ins (protected paths), and changing who may reach Conch or whose skills it
   trusts (`runsConchPower`). The agent can't raise its own privileges (AGENTS.md).
3. **Tools turned Off** in Apps stay off.
4. **A spam-sized send** (ADR 0117): one message to 500 people or more, or a chat's 500th
   message in a day, is refused with the reason and a next step; one to 100 or more, the
   50th delete in a turn, a payment of 1,000 or more and a loop of the same change ask.
5. **Someone else's words.** A message from someone who isn't you (a group, a chat
   app's guest) can't borrow your trust: its steps ask you.
6. **Nobody there after reading.** A routine or a chat-app chat that read something
   untrusted asks you, by notification, because no one is watching.
7. **A skill's list.** A chat held to a skill (ADR 0031, ADR 0047) asks for what the
   skill didn't say it needs; the skill's author isn't you.
8. **Paying or deleting on a website** (`high-stakes` in the browser), and each site in
   your own signed-in Chrome (ADR 0080).

Spending limits (ADR 0079) stop a reply; they never ask.

### Per provider

Every provider now offers all five modes (`ALL_MODES`); `honouredMode` still turns one
a provider can't do into its first.

| Provider                                                                                 | Plan only                                      | Ask first / Edit freely                       | Auto                                                                                                                                                                   | Full trust                                                                                                               |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Claude Code**                                                                          | `plan`                                         | `default` / `acceptEdits`                     | `default`, with Conch answering each question by its own risk policy and second look (ADR 0118; its own classifier isn't used)                                         | `bypassPermissions`; the hook keeps the irreducible list; commands sealed, leaving the box free                          |
| **Codex CLI** (its own tools)                                                            | approvals declined                             | approvals asked / changes accepted            | approvals accepted after the guard; its sandbox: the work folder **with the network**, sealed with someone else's words, nobody there after reading, or a skill's hold | approvals accepted after the guard; its sandbox: **your folders and the network** (`reach: 'open'`), Conch's keys denied |
| **Codex**, **Copilot**, **Gemini CLI**, **Grok** (ACP), **model APIs**, **local models** | Conch's tools refuse changes                   | Conch's tools ask (`authorizeTool`)           | Conch's tools go ahead after the guard; commands leave the box for the network, after reading only where the risk policy and second look see nothing                   | Conch's tools go ahead; commands needing the network or your folders run unsealed                                        |
| **Tasks and helpers**                                                                    | their chat's mode, never more (ADR 0033)       |                                               |                                                                                                                                                                        |                                                                                                                          |
| **Chat apps**                                                                            | `/mode` lists the ladder; a raise asks to save | the owner answers in Conch or by notification | as in Conch; someone else's words check every way out                                                                                                                  | its own warning before saving; the restore preview names it                                                              |

ACP programs' own tools are declined in every mode, as before: the door's tools do the
work, under these rules, so every ACP program behaves the same. Codex CLI's sandbox is
set once per turn (`TurnInput.reach`); a mode picked mid-turn changes what's asked from
the next step, and its reach from the next message. Codex never gets more than its
profile, in any mode (ADR 0066), which in Full trust is only Conch's own keys.

### Settings and the restore preview

Settings → Models shows the choice as `ModeChoice`: the chat picker's options, as calm
cards with their icons, Plan only to Full trust, Full trust confirmed in place. Auto as
the default is a power a backup brings back (`chats-go-ahead`), named in the restore
preview like Full trust.

## Consequences

- Auto is in every chat, with every provider, and asks about one thing in dozens.
- Full trust is what people expect from YOLO. The security checkup still warns about it
  and offers Ask first or Auto.
- The risk policy's lists need care as tools change. A step it misses is still sealed,
  still undoable and still behind protected paths; one it flags wrongly is a single
  question with its reason. The corpus test keeps both honest.
- Codex CLI in Full trust can read your SSH keys, as you can (a push needs them); Conch's
  own keys stay denied.

## Sources

Read 2026-10-07:

- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes): auto
  mode's classifier, what it blocks and allows by default, critical paths in bypass mode.
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference):
  permission profiles (`:workspace`, `:danger-full-access`), network, approval policies.
- [Gemini CLI policy engine](https://geminicli.com/docs/reference/policy-engine/): the
  approval modes and their order.
- [VS Code: manage approvals and permissions](https://code.visualstudio.com/docs/agents/run/approvals):
  Manual, Assisted (an LLM judge) and Allow all; terminal auto-approve rules; "a
  best-effort convenience, not a security boundary".
- [OWASP Top 10 for LLM applications 2025](https://genai.owasp.org/llm-top-10/) and
  [Agentic AI threats and mitigations](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/).
- Greshake et al. (2023), indirect prompt injection; Willison's lethal trifecta (ADR 0028).
